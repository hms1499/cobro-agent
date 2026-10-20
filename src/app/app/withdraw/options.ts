import { t } from "@/i18n";
import type { ReferenceRates } from "@/lib/fx/rates";
import { PAY_ASSETS, type LocalCurrency } from "@/lib/money/currencies";
import { displayAmount, type DisplayAmount } from "@/lib/money/display";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import { tokenFiatAmount } from "@/lib/treasury/value";
import { withdrawableAmount } from "@/lib/treasury/withdraw";

export interface WithdrawOption {
  asset: (typeof PAY_ASSETS)[number];
  label: string;
  available: DisplayAmount;
}

/**
 * The assets with something to withdraw, each with the amount available. The amount leads in the token's
 * own currency and keeps its cents: the freelancer types it into a field in that currency, so it must
 * never be rounded above what can actually be withdrawn.
 */
export function withdrawOptions(balances: TreasuryBalances, local: LocalCurrency | null, rates: ReferenceRates | null): WithdrawOption[] {
  return PAY_ASSETS.filter((asset) => withdrawableAmount(asset, balances) > 0n).map((asset) => {
    const { amount, currency } = tokenFiatAmount(asset, withdrawableAmount(asset, balances));
    return { asset, label: t(`asset.${asset}.name` as const), available: displayAmount(amount, currency, local, rates, "billed") };
  });
}
