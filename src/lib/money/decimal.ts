/** Rates are fixed-point integers with 18 decimals. */
export const RATE_DECIMALS = 18;
export const RATE_ONE = 10n ** 18n;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** "1605.495" with 18 decimals → 1605495000000000000000n. Throws on anything but a plain non-negative decimal. */
export function parseDecimal(value: string, decimals: number): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error(`Not a plain decimal number: "${value}"`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Inverse of parseDecimal, without trailing zeros: 300_000000n with 6 decimals → "300". */
export function formatDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / base}${fraction ? `.${fraction}` : ""}`;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator < 0n) throw new Error("numerator must not be negative");
  return (numerator + denominator - 1n) / denominator;
}
