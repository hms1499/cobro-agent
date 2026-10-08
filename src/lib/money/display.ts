import { convertFiat } from "@/lib/fx/convert";
import type { ReferenceRates } from "@/lib/fx/rates";
import type { FiatCurrency, LocalCurrency } from "./currencies";
import { formatMoney } from "./format";

export interface DisplayAmount {
  primary: string;
  secondary?: string;
}

/** Spec §17.1 principle 2: local currency large, USD (or the invoice currency) small. */
export function displayAmount(
  amount: string,
  currency: FiatCurrency,
  local: LocalCurrency | null,
  rates: ReferenceRates | null,
): DisplayAmount {
  const exact = formatMoney(amount, currency);
  if (!local || !rates) return { primary: exact };
  if (currency === local) {
    return { primary: exact, secondary: `≈ ${formatMoney(convertFiat(amount, currency, "USD", rates), "USD")}` };
  }
  return { primary: `≈ ${formatMoney(convertFiat(amount, currency, local, rates), local)}`, secondary: exact };
}
