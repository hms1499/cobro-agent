import { TOKENS } from "@/lib/chain/tokens";
import { fiatPerUsd } from "@/lib/fx/convert";
import type { ReferenceRates } from "@/lib/fx/rates";
import { ASSET_DENOMINATION, type FiatCurrency, type PayAsset } from "@/lib/money/currencies";
import { ceilDiv, formatDecimal, parseDecimal, RATE_DECIMALS, RATE_ONE } from "@/lib/money/decimal";

export interface InvoiceQuote {
  amountAtomic: bigint;
  /** Tokens per one unit of the invoice currency, as a decimal string. */
  rate: string;
}

/** True when pricing this invoice in `asset` needs Textile reference rates. */
export function needsRates(currency: FiatCurrency, asset: PayAsset): boolean {
  return ASSET_DENOMINATION[asset] !== currency;
}

/** Spec §9: the invoice amount in `asset` at the reference mid, rounded up to the token's smallest unit. */
export function quoteInvoice(input: {
  amount: string;
  currency: FiatCurrency;
  asset: PayAsset;
  rates: ReferenceRates | null;
}): InvoiceQuote {
  const cents = parseDecimal(input.amount, 2);
  if (cents <= 0n) throw new Error("Invoice amount must be positive");
  const decimals = TOKENS[input.asset].decimals;
  const same = !needsRates(input.currency, input.asset);
  const targetPerUsd = same ? RATE_ONE : fiatPerUsd(input.rates, ASSET_DENOMINATION[input.asset]);
  const sourcePerUsd = same ? RATE_ONE : fiatPerUsd(input.rates, input.currency);
  return {
    amountAtomic: ceilDiv(cents * targetPerUsd * 10n ** BigInt(decimals), 100n * sourcePerUsd),
    rate: formatDecimal((targetPerUsd * RATE_ONE) / sourcePerUsd, RATE_DECIMALS),
  };
}
