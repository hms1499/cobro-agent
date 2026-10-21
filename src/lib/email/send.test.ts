import { afterEach, describe, expect, it, vi } from "vitest";
import { liveEmailSender, resendSender } from "./send";

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

  it("throws on a refusal without leaking, and releases the body", async () => {
    const res = new Response(`bad ${KEY} ana@example.com`, { status: 422 });
    const cancel = vi.spyOn(res.body!, "cancel");
    const fetchMock = vi.fn(async () => res);
    const send = resendSender({ apiKey: KEY, from: "x@example.com", fetch: fetchMock as unknown as typeof fetch });
    const err = await send({ to: "ana@example.com", subject: "s", text: "t" }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Resend answered 422");
    expect((err as Error).message).not.toContain(KEY);
    expect(cancel).toHaveBeenCalled();
  });

  it("gives up after ten seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
      await resendSender({ apiKey: KEY, from: "x@example.com", fetch: fetchMock as unknown as typeof fetch })({ to: "a@example.com", subject: "s", text: "t" });
      expect(timeout).toHaveBeenCalledWith(10_000);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.signal).toBe(timeout.mock.results[0].value);
    } finally {
      timeout.mockRestore();
    }
  });
});

describe("liveEmailSender", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects, rather than throwing, when the key is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "x@example.com");
    let pending: Promise<void> | undefined;
    expect(() => {
      pending = liveEmailSender()({ to: "a@example.com", subject: "s", text: "t" });
    }).not.toThrow();
    await expect(pending).rejects.toThrow("RESEND_API_KEY is not set");
  });
});
