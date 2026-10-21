import { parseServerEnv, requireValue } from "@/lib/config/server";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailSender = (message: EmailMessage) => Promise<void>;

/** Resend over plain fetch. A refusal throws the status only, never the body (it can echo the address). */
export function resendSender(opts: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender {
  const doFetch = opts.fetch ?? fetch;
  return async ({ to, subject, text }) => {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: opts.from, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  };
}

/** Reads the env when sending, so a missing key fails the send and not the import. */
export function liveEmailSender(): EmailSender {
  return (message) => {
    const env = parseServerEnv();
    return resendSender({
      apiKey: requireValue(env.RESEND_API_KEY, "RESEND_API_KEY"),
      from: requireValue(env.EMAIL_FROM, "EMAIL_FROM"),
    })(message);
  };
}
