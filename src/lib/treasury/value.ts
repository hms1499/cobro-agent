import { TOKENS } from "@/lib/chain/tokens";
import type { ReferenceRates } from "@/lib/fx/rates";
import { ASSET_DENOMINATION, type FiatCurrency, type LocalCurrency, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal, RATE_ONE } from "@/lib/money/decimal";

/** USD amounts in the treasury code are "wads": 18-decimal fixed point. */
export const WAD = 10n ** 18n;

/** The spending token of each local currency (rules store ARS or BRL). */
export const LOCAL_ASSET: Record<LocalCurrency, "WARS" | "WBRL"> = { ARS: "WARS", BRL: "WBRL" };

const toEighteen = (asset: PayAsset) => 10n ** BigInt(18 - TOKENS[asset].decimals);

/** USD value with 18 decimals. USD₮ and USA₮ count one to one (spec §9); local tokens use the reference mid. */
export function usdWad(asset: PayAsset, atomic: bigint, rates: ReferenceRates): bigint {
  const units = atomic * toEighteen(asset);
  const currency = ASSET_DENOMINATION[asset];
  return currency === "USD" ? units : (units * RATE_ONE) / rates.perUsd[currency];
}

/** Atomic units of `asset` worth `usd` (18 decimals), rounded down. */
export function atomicForUsdWad(asset: PayAsset, usd: bigint, rates: ReferenceRates): bigint {
  const currency = ASSET_DENOMINATION[asset];
  const units = currency === "USD" ? usd : (usd * rates.perUsd[currency]) / RATE_ONE;
  return units / toEighteen(asset);
}

/** Rules hold whole dollars (perTradeMaxUsd, dailyMaxUsd). */
export function dollarsToWad(dollars: number): bigint {
  return BigInt(dollars) * WAD;
}

/** A fiat string such as "300000.00" as atomic units of the token that tracks it. */
export function fiatToAtomic(amount: string, asset: PayAsset): bigint {
  return parseDecimal(amount, TOKENS[asset].decimals);
}

export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** A USD wad as dollars with cents, truncated toward zero, ready for formatMoney. */
export function usdWadToDollars(wad: bigint): string {
  return formatCents(wad / 10n ** 16n);
}

/** A token balance as the fiat amount it tracks, rounded down to cents (USD₮ → USD, wARS → ARS). */
export function tokenFiatAmount(asset: PayAsset, atomic: bigint): { amount: string; currency: FiatCurrency } {
  return { amount: formatCents(atomic / 10n ** BigInt(TOKENS[asset].decimals - 2)), currency: ASSET_DENOMINATION[asset] };
}
