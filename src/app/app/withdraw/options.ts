import type { Address } from "viem";
import { t } from "@/i18n";
import { isUsable, type SavedAddress } from "@/lib/addresses/repo";
import type { ReferenceRates } from "@/lib/fx/rates";
import { PAY_ASSETS, type HomeCurrency } from "@/lib/money/currencies";
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
export function withdrawOptions(balances: TreasuryBalances, local: HomeCurrency | null, rates: ReferenceRates | null): WithdrawOption[] {
  return PAY_ASSETS.filter((asset) => withdrawableAmount(asset, balances) > 0n).map((asset) => {
    const { amount, currency } = tokenFiatAmount(asset, withdrawableAmount(asset, balances));
    return { asset, label: t(`asset.${asset}.name` as const), available: displayAmount(amount, currency, local, rates, "billed") };
  });
}

export interface WithdrawDestination {
  /** "personal" or a saved-address id: exactly what the withdraw form posts as `to`. */
  value: string;
  label: string;
  address: Address;
  /** Null when usable now, else whole hours left (rounded up). */
  usableInHours: number | null;
}

/** Your own wallet first (when known), then the saved addresses, oldest first. */
export function withdrawDestinations(personalWallet: Address | null, saved: readonly SavedAddress[], now: Date): WithdrawDestination[] {
  const rows: WithdrawDestination[] = saved.map((a) => ({
    value: a.id,
    label: a.label,
    address: a.address,
    usableInHours: isUsable(a, now) ? null : Math.ceil((a.usableAt.getTime() - now.getTime()) / 3_600_000),
  }));
  if (!personalWallet) return rows;
  return [{ value: "personal", label: t("withdraw.personalLabel"), address: personalWallet, usableInHours: null }, ...rows];
}

/** The destination as it reads mid-sentence: "your Cobro wallet" or the saved address's name. */
export function destinationName(destinations: readonly WithdrawDestination[], to: string | undefined): string {
  const found = destinations.find((d) => d.value === to);
  return !found || found.value === "personal" ? t("withdraw.yourWallet") : found.label;
}
