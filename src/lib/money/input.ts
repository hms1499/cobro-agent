import { parseDecimal } from "./decimal";

export const MAX_FIAT_AMOUNT = "1000000000";
export type FiatInputError = "required" | "format" | "decimals" | "range";

const PLAIN = /^\d+(\.\d+)?$/;

/**
 * Reads an amount typed into a form. Only digits and one dot are accepted: "1.500,50" (Argentina)
 * and "1,500.50" (US) mean the same number, while "1.500" means different numbers in each, so any
 * comma or space is refused instead of guessed.
 */
export function parseFiatInput(
  raw: string,
  opts: { allowZero?: boolean } = {},
): { ok: true; value: string } | { ok: false; error: FiatInputError } {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "required" };
  if (!PLAIN.test(text)) return { ok: false, error: "format" };
  if ((text.split(".")[1] ?? "").length > 2) return { ok: false, error: "decimals" };
  const cents = parseDecimal(text, 2);
  if ((cents === 0n && !opts.allowZero) || cents > parseDecimal(MAX_FIAT_AMOUNT, 2)) {
    return { ok: false, error: "range" };
  }
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return { ok: true, value: `${whole}.${fraction}` };
}
