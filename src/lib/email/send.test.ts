import { describe, expect, it, vi } from "vitest";
import { resendSender } from "./send";

const KEY = "re_test_key_123456";

describe("resendSender", () => {
  it("posts to Resend with the key in the header only", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const send = resendSender({ apiKey: KEY, from: "Cobro <no-reply@example.com>", fetch: fetchMock as unknown as typeof fetch });
    await send({ to: "ana@example.com", subject: "Hi", text: "Body" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Cobro <no-reply@example.com>",
      to: ["ana@example.com"],
      subject: "Hi",
      text: "Body",
    });
    expect(init.body as string).not.toContain(KEY);
  });

  it("throws on a refusal without leaking", async () => {
    const fetchMock = vi.fn(async () => new Response(`bad ${KEY} ana@example.com`, { status: 422 }));
    const send = resendSender({ apiKey: KEY, from: "x@example.com", fetch: fetchMock as unknown as typeof fetch });
    const err = await send({ to: "ana@example.com", subject: "s", text: "t" }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Resend answered 422");
    expect((err as Error).message).not.toContain(KEY);
  });
});
