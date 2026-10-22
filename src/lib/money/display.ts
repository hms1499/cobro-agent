import { convertFiat } from "@/lib/fx/convert";
import type { ReferenceRates } from "@/lib/fx/rates";
import type { FiatCurrency, HomeCurrency } from "./currencies";
import { formatMoney } from "./format";

export interface DisplayAmount {
  primary: string;
  secondary?: string;
}

/** Which figure leads: the local currency (balances) or the amount's own currency (invoices, token amounts). */
export type AmountLead = "local" | "billed";

// Peso and real figures from here up are shown without cents unless they are an exact billed amount.
const WHOLE_FROM = 1000;

function rounded(amount: string, currency: FiatCurrency): string {
  return formatMoney(amount, currency, undefined, { whole: currency !== "USD" && Math.abs(Number(amount)) >= WHOLE_FROM });
}

/** A converted, secondary figure: marked "≈", and never shown as zero when the source is not zero. */
function converted(source: string, amount: string, currency: FiatCurrency): string {
  if (Number(amount) === 0 && Number(source) > 0) return `< ${formatMoney("0.01", currency)}`;
  return `≈ ${rounded(amount, currency)}`;
}

/**
 * MASTER.md "Money formatting": two figures, the lead one large. Balances lead with the local
 * currency; invoices and token amounts lead with their own currency, exact. Only the secondary,
 * converted figure carries "≈".
 */
export function displayAmount(
  amount: string,
  currency: FiatCurrency,
  local: HomeCurrency | null,
  rates: ReferenceRates | null,
  lead: AmountLead = "local",
): DisplayAmount {
  if (!local || !rates) return { primary: formatMoney(amount, currency) };
  // A freelancer who lives in dollars sees dollar amounts alone: there is nothing to convert them to.
  if (local === "USD" && currency === "USD") return { primary: formatMoney(amount, "USD") };
  if (lead === "billed") {
    const other = currency === local ? "USD" : local;
    return { primary: formatMoney(amount, currency), secondary: converted(amount, convertFiat(amount, currency, other, rates), other) };
  }
  if (currency === local) {
    return { primary: rounded(amount, local), secondary: converted(amount, convertFiat(amount, local, "USD", rates), "USD") };
  }
  return { primary: rounded(convertFiat(amount, currency, local, rates), local), secondary: formatMoney(amount, currency) };
}
