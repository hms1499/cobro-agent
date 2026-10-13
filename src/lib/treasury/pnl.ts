// src/lib/treasury/pnl.ts
import type { ReferenceRates } from "@/lib/fx/rates";
import { LOCAL_CURRENCIES, type LocalCurrency, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal, RATE_DECIMALS } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { atomicForUsdWad, LOCAL_ASSET, usdWad } from "./value";

export interface PaymentForPnl {
  asset: PayAsset;
  amountAtomic: bigint;
  ratesSnapshot: Record<string, string> | null;
}

/** The reference rates when a payment arrived; today's for any currency the snapshot lacks. */
export function ratesAtPayment(snapshot: Record<string, string> | null, now: ReferenceRates): ReferenceRates {
  const perUsd = { ...now.perUsd };
  for (const currency of LOCAL_CURRENCIES) {
    const value = snapshot?.[currency];
    if (!value) continue;
    try {
      perUsd[currency] = parseDecimal(value, RATE_DECIMALS);
    } catch {
      // a malformed snapshot falls back to today's rate
    }
  }
  return { perUsd, fetchedAt: now.fetchedAt };
}

/** What the payment would be worth today had it been turned into `local` on arrival and held (spec §10.5). */
export function heldInLocalUsdWad(payment: PaymentForPnl, local: LocalCurrency, now: ReferenceRates): bigint {
  const localAsset = LOCAL_ASSET[local];
  if (payment.asset === localAsset) return usdWad(localAsset, payment.amountAtomic, now);
  const then = ratesAtPayment(payment.ratesSnapshot, now);
  const localAtomic = atomicForUsdWad(localAsset, usdWad(payment.asset, payment.amountAtomic, then), then);
  return usdWad(localAsset, localAtomic, now);
}

const BUCKET_ASSETS = ["USDT", "USAT", "WARS", "WBRL"] as const;

/** The pay assets only: USDC in a treasury is gas money, not savings. */
export function treasuryUsdWad(balances: TreasuryBalances, rates: ReferenceRates): bigint {
  return BUCKET_ASSETS.reduce((sum, asset) => sum + usdWad(asset, balances[asset], rates), 0n);
}

export interface ProtectedValue {
  actualUsdWad: bigint;
  heldUsdWad: bigint;
  protectedUsdWad: bigint;
}

export function protectedValue(input: {
  balances: TreasuryBalances;
  withdrawnUsdWad: bigint;
  payments: PaymentForPnl[];
  local: LocalCurrency;
  rates: ReferenceRates;
}): ProtectedValue {
  const actualUsdWad = treasuryUsdWad(input.balances, input.rates) + input.withdrawnUsdWad;
  const heldUsdWad = input.payments.reduce((sum, p) => sum + heldInLocalUsdWad(p, input.local, input.rates), 0n);
  return { actualUsdWad, heldUsdWad, protectedUsdWad: actualUsdWad - heldUsdWad };
}
