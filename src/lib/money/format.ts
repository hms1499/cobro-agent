import { TOKENS } from "@/lib/chain/tokens";
import { t } from "@/i18n";
import type { FiatCurrency, PayAsset } from "./currencies";
import { ceilDiv, formatDecimal } from "./decimal";

/**
 * The only fiat formatter in the app (MASTER.md "Money formatting"). Display only.
 * `whole` drops the cents, for large peso and real figures that are not exact billed amounts.
 */
export function formatMoney(amount: string, currency: FiatCurrency, locale = "en-US", options?: { whole?: boolean }): string {
  const value = Number(amount);
  const digits = options?.whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {};
  if (currency === "USD") {
    // en-US renders "$300.00"; the "US" prefix keeps dollars distinct from pesos.
    return `US${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", ...digits }).format(value)}`;
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    trailingZeroDisplay: "stripIfInteger",
    ...digits,
  }).format(value);
}

/** "481,648.50 wARS". Rounded up to cents so a payer never sees less than what is charged. */
export function formatTokenAmount(atomic: bigint, asset: PayAsset, locale = "en-US"): string {
  const decimals = TOKENS[asset].decimals;
  const cents = ceilDiv(atomic, 10n ** BigInt(decimals - 2));
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(formatDecimal(cents, 2)),
  );
  return `${number} ${t(`asset.${asset}.symbol` as const)}`;
}
