// src/lib/fx/rfq.test.ts
import { getAddress, verifyTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { takerControlTypedData, TextileRfqClient } from "./rfq";

const TAKER: Address = "0x1111111111111111111111111111111111111111";
const REACTOR = getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3");
const PROOF = { nonce: `0x${"ab".repeat(32)}` as Hex, issuedAt: 1_760_000_000_000, signature: "0x1234" as Hex };
const WARS_1600 = 1_600n * 10n ** 18n;

function fakeFetch(status: number, body: unknown) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}
const client = (fetchMock: ReturnType<typeof fakeFetch>) =>
  new TextileRfqClient({ baseUrl: "https://api.textilecredit.com/", fetch: fetchMock as unknown as typeof fetch });
const request = (c: TextileRfqClient) =>
  c.request({ sellToken: TOKENS.WARS.address, buyToken: TOKENS.USDT.address, sellAmount: WARS_1600, taker: TAKER, takerProof: PROOF });

const QUOTED = {
  data: {
    rfqId: "rfq_1",
    claimToken: "claim_1",
    status: "quoted",
    quote: {
      sellAmount: "1599840000000000000000",
      buyAmount: "995000",
      feeAmount: "160000000000000000",
      takerPays: "1600000000000000000000",
      rateRay: "621875000000000000000",
      expiresAt: "2026-10-15T12:01:00.000Z",
      orderDeadline: "2026-10-15T12:01:30.000Z",
      reactor: REACTOR,
      taker: TAKER,
      encodedOrder: "0x00",
      signature: "0x00",
    },
    transactions: {
      approval: { to: TOKENS.WARS.address, data: "0x095ea7b3", value: "0", chainId: 42220 },
      swap: { to: REACTOR, data: "0xabcdef", value: "0", chainId: 42220 },
    },
  },
};

describe("TextileRfqClient.request", () => {
  it("asks for a firm quote with the taker proof and reads it", async () => {
    const fetchMock = fakeFetch(200, QUOTED);
    const outcome = await request(client(fetchMock));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.textilecredit.com/v2/rfq/request");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      chainId: 42220,
      sellToken: TOKENS.WARS.address,
      buyToken: TOKENS.USDT.address,
      sellAmount: "1600000000000000000000",
      taker: TAKER,
      takerProof: PROOF,
    });
    expect(outcome).toEqual({
      status: "quoted",
      quote: {
        rfqId: "rfq_1",
        claimToken: "claim_1",
        sellAmount: 1_599_840_000_000_000_000_000n,
        buyAmount: 995_000n,
        feeAmount: 160_000_000_000_000_000n,
        takerPays: WARS_1600,
        expiresAt: new Date("2026-10-15T12:01:00.000Z"),
        spender: REACTOR,
        taker: TAKER,
        swap: { to: REACTOR, data: "0xabcdef", value: 0n, chainId: 42220 },
      },
    });
  });

  it("uses the quote's spender when it names one", async () => {
    const other = "0x2222222222222222222222222222222222222222";
    const body = { data: { ...QUOTED.data, quote: { ...QUOTED.data.quote, spender: other } } };
    const outcome = await request(client(fakeFetch(200, body)));
    expect(outcome.status === "quoted" && outcome.quote.spender).toBe(other);
  });

  it("reads a no-quote with or without a retry hint", async () => {
    expect(
      await request(client(fakeFetch(200, { data: { rfqId: "rfq_2", status: "no_quote", reason: "no_makers_online", retryAfterMs: 30_000 } }))),
    ).toEqual({ status: "no_quote", reason: "no_makers_online", retryAfterMs: 30_000 });
    expect(await request(client(fakeFetch(200, { data: { status: "no_quote" } })))).toEqual({
      status: "no_quote",
      reason: "no_valid_quote",
      retryAfterMs: null,
    });
  });

  it("turns an error envelope into a TextileError with the stable reason", async () => {
    const body = { error: { code: "unauthorized", message: "proof is stale", details: { reason: "proof_of_control_stale" } } };
    await expect(request(client(fakeFetch(401, body)))).rejects.toMatchObject({
      name: "TextileError",
      status: 401,
      reason: "proof_of_control_stale",
    });
  });

  it("reports an unreachable venue and an unreadable answer", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(request(new TextileRfqClient({ baseUrl: "https://x.test", fetch: down as unknown as typeof fetch }))).rejects.toMatchObject({
      status: 0,
      reason: "network",
    });
    await expect(request(client(fakeFetch(200, { data: { status: "quoted" } })))).rejects.toMatchObject({ reason: "malformed_response" });
  });
});

describe("cancel and submit", () => {
  it("prove ownership with the claim token", async () => {
    const fetchMock = fakeFetch(200, { data: { rfqId: "rfq_1", status: "submitted" } });
    const c = client(fetchMock);
    await c.cancel("rfq_1", "claim_1");
    await c.submit("rfq_1", "claim_1", `0x${"12".repeat(32)}`);
    const [cancelUrl, cancelInit] = fetchMock.mock.calls[0];
    expect(cancelUrl).toBe("https://api.textilecredit.com/v2/rfq/rfq_1/cancel");
    expect((cancelInit?.headers as Record<string, string>)["X-Rfq-Claim"]).toBe("claim_1");
    const [submitUrl, submitInit] = fetchMock.mock.calls[1];
    expect(submitUrl).toBe("https://api.textilecredit.com/v2/rfq/rfq_1/submit");
    expect(JSON.parse(submitInit?.body as string)).toEqual({ txHash: `0x${"12".repeat(32)}` });
  });
});

describe("takerControlTypedData", () => {
  it("is what the taker wallet signs (EIP-712 TakerControl on chain 42220)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const data = takerControlTypedData(account.address, PROOF.nonce, PROOF.issuedAt);
    expect(data.domain).toEqual({ name: "Textile Taker Control", version: "1", chainId: 42220 });
    const signature = await account.signTypedData(data);
    expect(await verifyTypedData({ ...data, address: account.address, signature })).toBe(true);
  });
});
