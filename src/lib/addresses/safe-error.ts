/**
 * A log-safe description of an error: its class name and, for Postgres errors, the SQLSTATE code.
 * Never the message: drizzle's message embeds the SQL parameters (label, address, code hash) and
 * a mail provider's can carry the recipient.
 */
export function safeErrorTag(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const name = error instanceof Error ? error.name : typeof error;
  const code = [e?.code, e?.cause?.code].find((c) => typeof c === "string" && /^[0-9A-Z]{5}$/.test(c));
  return code ? `${name} (${code})` : name;
}
