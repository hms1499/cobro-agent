import { parseDecimal } from "./decimal";

export const MAX_FIAT_AMOUNT = "1000000000";
export type FiatInputError = "required" | "format" | "decimals" | "range";

const PLAIN = /^\d+(\.\d+)?$/;
const COMMA_CENTS = /^(\d+),(\d{1,2})$/;

/**
 * Reads an amount typed into a form. "1.500,50" (Argentina) and "1,500.50" (US) mean the same
 * number, while "1.500" means different numbers in each, so thousands separators and spaces are
 * refused instead of guessed. One comma followed by one or two digits ("1500,50") can only be a
 * cents mark, and it is the only one iOS keypads in Argentina and Brazil offer, so it is accepted.
 */
export function parseFiatInput(
  raw: string,
  opts: { allowZero?: boolean } = {},
): { ok: true; value: string } | { ok: false; error: FiatInputError } {
  const text = raw.trim().replace(COMMA_CENTS, "$1.$2");
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
