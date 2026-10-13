// src/lib/treasury/view.ts
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { getReferenceRates, type ReferenceRates } from "@/lib/fx/rates";
import type { LocalCurrency } from "@/lib/money/currencies";
import type { AppUser } from "@/lib/users/queries";
import type { TreasuryBalances } from "./balances";
import { liveExecutorDeps } from "./live";
import { protectedValue, treasuryUsdWad, type PaymentForPnl } from "./pnl";
import { paymentsForPnl, withdrawnUsdWad } from "./stats";
import { fiatToAtomic, LOCAL_ASSET, tokenFiatAmount, usdWad, usdWadToDollars } from "./value";

/** Dashboard figures as decimal strings ready for displayAmount (spec §17.2 Dashboard). */
export interface TreasuryView {
  local: LocalCurrency;
  /** Pay assets in USD; USDC gas money is left out. */
  totalUsd: string;
  /** Local-currency balance (the "Spending" bucket), in the local currency. */
  spending: string;
  reserve: string;
  /** How full the spending reserve is, 0-100; null when no reserve is set. */
  reservePercent: number | null;
  /** USD₮ + USA₮ (the "Savings" bucket). */
  savingsUsd: string;
  /** Absolute value; protectedNegative says whether holding pesos would have been better. */
  protectedUsd: string;
  protectedNegative: boolean;
}

export function buildTreasuryView(input: {
  balances: TreasuryBalances;
  rates: ReferenceRates;
  rules: { localCurrency: LocalCurrency; reserveAmount: string };
  payments: PaymentForPnl[];
  withdrawnUsdWad: bigint;
}): TreasuryView {
  const { balances, rates } = input;
  const local = input.rules.localCurrency;
  const asset = LOCAL_ASSET[local];
  const reserveAtomic = fiatToAtomic(input.rules.reserveAmount, asset);
  const pnl = protectedValue({ balances, withdrawnUsdWad: input.withdrawnUsdWad, payments: input.payments, local, rates });
  const filled = reserveAtomic === 0n ? null : (balances[asset] * 100n) / reserveAtomic;
  return {
    local,
    totalUsd: usdWadToDollars(treasuryUsdWad(balances, rates)),
    spending: tokenFiatAmount(asset, balances[asset]).amount,
    reserve: input.rules.reserveAmount,
    reservePercent: filled === null ? null : Number(filled > 100n ? 100n : filled),
    savingsUsd: usdWadToDollars(usdWad("USDT", balances.USDT, rates) + usdWad("USAT", balances.USAT, rates)),
    protectedUsd: usdWadToDollars(pnl.protectedUsdWad < 0n ? -pnl.protectedUsdWad : pnl.protectedUsdWad),
    protectedNegative: pnl.protectedUsdWad < 0n,
  };
}

/** Live: chain balances, Textile rates and the P&L inputs. Null until the wallet and rules exist; throws if a read fails. */
export async function loadTreasuryView(user: AppUser): Promise<{ view: TreasuryView; rates: ReferenceRates } | null> {
  if (!user.treasuryAddress || !user.localCurrency) return null;
  const db = getDb();
  const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
  if (!row) return null;
  const [balances, rates, payments, withdrawn] = await Promise.all([
    liveExecutorDeps().chain.readBalances(user.treasuryAddress),
    getReferenceRates(),
    paymentsForPnl(db, user.id),
    withdrawnUsdWad(db, user.id),
  ]);
  return { view: buildTreasuryView({ balances, rates, rules: row, payments, withdrawnUsdWad: withdrawn }), rates };
}

export type AgentState = "off" | "paused" | "dry_run" | "active";

/** Spec §17.1 principle 4: Active / Paused / Dry run is always visible ("off" = the global switch). */
export function agentState(input: { globalEnabled: boolean; dryRun: boolean; userEnabled: boolean }): AgentState {
  if (!input.globalEnabled) return "off";
  if (!input.userEnabled) return "paused";
  return input.dryRun ? "dry_run" : "active";
}
