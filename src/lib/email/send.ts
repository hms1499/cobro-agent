import { parseServerEnv, requireValue } from "@/lib/config/server";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailSender = (message: EmailMessage) => Promise<void>;

/** How long a send may take before it is abandoned (and counted as failed). */
const SEND_TIMEOUT_MS = 10_000;

/** Resend over plain fetch. A refusal throws the status only, never the body (it can echo the address). */
export function resendSender(opts: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender {
  const doFetch = opts.fetch ?? fetch;
  return async ({ to, subject, text }) => {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: opts.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Release the connection without reading the body.
      await res.body?.cancel();
      throw new Error(`Resend answered ${res.status}`);
    }
  };
}

/** Reads the env when sending, so a missing key rejects the send and does not fail the import. */
export function liveEmailSender(): EmailSender {
  return async (message) => {
    const env = parseServerEnv();
    await resendSender({
      apiKey: requireValue(env.RESEND_API_KEY, "RESEND_API_KEY"),
      from: requireValue(env.EMAIL_FROM, "EMAIL_FROM"),
    })(message);
  };
}
