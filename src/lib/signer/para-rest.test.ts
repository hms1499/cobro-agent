import { describe, expect, it, vi } from "vitest";
import { ParaRestClient, ParaRestError } from "./para-rest";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function clientWith(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const client = new ParaRestClient({ apiKey: "sk_test", baseUrl: "https://api.beta.getpara.com", fetch: fetchMock });
  return { client, fetchMock };
}

describe("ParaRestClient", () => {
  it("creates an EVM wallet keyed by a custom id", async () => {
    const { client, fetchMock } = clientWith(
      jsonResponse(201, { id: "w1", type: "EVM", status: "creating", address: "0x9dd3824f045c77bc369485e8f1dd6b452b6be617" }),
    );
    const wallet = await client.createWallet("user-42");
    expect(wallet.id).toBe("w1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.beta.getpara.com/v1/wallets");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ type: "EVM", userIdentifier: "user-42", userIdentifierType: "CUSTOM_ID" });
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("sk_test");
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("finds the wallet created for a custom id", async () => {
    const { client, fetchMock } = clientWith(
      jsonResponse(200, { data: [{ id: "w1", type: "EVM", status: "creating" }], pagination: {} }),
      jsonResponse(200, { data: [], pagination: {} }),
    );
    expect((await client.findWalletByCustomId("user-42"))?.id).toBe("w1");
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v1/wallets");
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      userIdentifier: "user-42",
      userIdentifierType: "CUSTOM_ID",
      type: "EVM",
    });
    expect(init?.method).toBe("GET");
    expect(await client.findWalletByCustomId("nobody")).toBeNull();
  });

  it("polls until the wallet is ready", async () => {
    const { client, fetchMock } = clientWith(
      jsonResponse(200, { id: "w1", type: "EVM", status: "creating" }),
      jsonResponse(200, { id: "w1", type: "EVM", status: "ready", address: "0x9dd3824f045c77bc369485e8f1dd6b452b6be617" }),
    );
    const wallet = await client.waitUntilReady("w1", { intervalMs: 0, timeoutMs: 1000 });
    expect(wallet.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(200, { id: "w1", type: "EVM", status: "creating" }));
    const client = new ParaRestClient({ apiKey: "k", baseUrl: "https://x", fetch: fetchMock });
    await expect(client.waitUntilReady("w1", { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow(/not ready/);
  });

  it("returns a 0x-prefixed signed transaction and forwards the idempotency key", async () => {
    const { client, fetchMock } = clientWith(jsonResponse(200, { signedTransaction: "0x02f8aa" }));
    const signed = await client.signTransaction("w1", { to: "0x000000000000000000000000000000000000dEaD", chainId: 42220, type: 2, value: "0" }, "idem-1");
    expect(signed).toBe("0x02f8aa");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.beta.getpara.com/v1/wallets/w1/sign-transaction");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("idem-1");
    expect(JSON.parse(String(init?.body)).transaction.chainId).toBe(42220);
  });

  it("prefixes typed-data and raw signatures returned without 0x", async () => {
    const { client } = clientWith(jsonResponse(200, { signature: "abcd" }), jsonResponse(200, { signature: "ef01" }));
    expect(await client.signTypedData("w1", { domain: {}, types: {}, primaryType: "X", message: {} })).toBe("0xabcd");
    expect(await client.signRaw("w1", "0x1234")).toBe("0xef01");
  });

  it("surfaces policy denials with their code", async () => {
    const { client } = clientWith(
      jsonResponse(403, { code: "POLICY_DENIED", message: "Transaction denied by policy" }),
    );
    const error = await client
      .signTransaction("w1", { to: "0x000000000000000000000000000000000000dEaD", chainId: 42220, type: 2 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ParaRestError);
    expect((error as ParaRestError).status).toBe(403);
    expect((error as ParaRestError).code).toBe("POLICY_DENIED");
  });

  it("handles a non-JSON error body", async () => {
    const { client } = clientWith(new Response("Bad Gateway", { status: 502 }));
    await expect(client.getWallet("w1")).rejects.toThrow(/502.*Bad Gateway/);
  });
});
