import type { FiatCurrency } from "@/lib/money/currencies";
import { parseDecimal, RATE_ONE } from "@/lib/money/decimal";
import { RatesUnavailableError, type ReferenceRates } from "./rates";

/** Units of `currency` per 1 USD, 18 decimals. Dollars need no rates. */
export function fiatPerUsd(rates: ReferenceRates | null, currency: FiatCurrency): bigint {
  if (currency === "USD") return RATE_ONE;
  if (!rates) throw new RatesUnavailableError(`No reference rate for ${currency}`);
  return rates.perUsd[currency];
}

/** Converts a fiat amount through USD, rounded half up to cents. For display, never for charging. */
export function convertFiat(amount: string, from: FiatCurrency, to: FiatCurrency, rates: ReferenceRates | null): string {
  const cents = parseDecimal(amount, 2);
  const result =
    from === to ? cents : (cents * fiatPerUsd(rates, to) * 2n + fiatPerUsd(rates, from)) / (2n * fiatPerUsd(rates, from));
  return `${result / 100n}.${(result % 100n).toString().padStart(2, "0")}`;
}
