// src/lib/treasury/chat-rules.ts
import { pickGasToken } from "@/lib/chain/treasury-tx";
import type { ReferenceRates } from "@/lib/fx/rates";
import type { PayAsset } from "@/lib/money/currencies";
import { spendableBalances, type TreasuryBalances } from "./balances";
import { decide, MIN_NOTIONAL_WAD, type EngineRules } from "./engine";
import { atomicForUsdWad, dollarsToWad, LOCAL_ASSET, usdWad } from "./value";

/** Spec §4.2: every direction chat may swap directly. Anything else is explained as two steps. */
export const DIRECT_PAIRS: readonly (readonly [PayAsset, PayAsset])[] = [
  ["USDT", "WARS"],
  ["WARS", "USDT"],
  ["USDT", "WBRL"],
  ["WBRL", "USDT"],
  ["USDT", "USAT"],
  ["USAT", "USDT"],
];

export function isDirectPair(from: PayAsset, to: PayAsset): boolean {
  return DIRECT_PAIRS.some(([a, b]) => a === from && b === to);
}

/** What chat may sell of one asset: the balance, less the gas reserve in the dollar token that pays gas. */
export function chatAvailable(asset: PayAsset, balances: TreasuryBalances): bigint {
  return spendableBalances(balances, pickGasToken(balances))[asset];
}

/** What is left of the daily limit (USD wad), shared with automatic swaps. */
export function dailyLeftWad(dailyMaxUsd: number, filledUsdWad24h: bigint): bigint {
  const left = dollarsToWad(dailyMaxUsd) - filledUsdWad24h;
  return left > 0n ? left : 0n;
}

export type ChatFit =
  | { amount: bigint; limited: "daily" | "balance" | null }
  | { refused: "below_minimum" | "daily_limit" | "insufficient" };

/** Spec §4.3: lower to the balance, then to the daily limit; no per-trade limit; minimum US$1. */
export function fitChatAmount(input: {
  from: PayAsset;
  wanted: bigint | null;
  available: bigint;
  dailyLeft: bigint;
  rates: ReferenceRates;
}): ChatFit {
  const { from, available, dailyLeft, rates } = input;
  if (available <= 0n) return { refused: "insufficient" };
  if (dailyLeft < MIN_NOTIONAL_WAD) return { refused: "daily_limit" };

  let amount = input.wanted ?? available;
  let limited: "daily" | "balance" | null = null;
  if (amount > available) {
    amount = available;
    limited = "balance";
  }
  if (usdWad(from, amount, rates) > dailyLeft) {
    amount = atomicForUsdWad(from, dailyLeft, rates);
    limited = "daily";
  }
  if (usdWad(from, amount, rates) < MIN_NOTIONAL_WAD) return { refused: "below_minimum" };
  return { amount, limited };
}

interface UndoInput {
  balances: TreasuryBalances;
  rules: EngineRules;
  rates: ReferenceRates;
  from: PayAsset;
  to: PayAsset;
  sold: bigint;
  bought: bigint;
}

/**
 * Spec §3.1: would the automatic agent's next decision reverse this swap? Projects the balances after
 * the swap and runs decide(); a conversion that sells what was bought or buys what was sold is a reversal.
 */
export function swapWouldBeUndone({ balances, rules, rates, from, to, sold, bought }: UndoInput): boolean {
  const after = { ...balances, [from]: balances[from] - sold, [to]: balances[to] + bought };
  const local = rules.localCurrency === "USD" ? null : LOCAL_ASSET[rules.localCurrency];
  // decide() returns only its first candidate: a non-local wFiat this swap does not touch must not hide the reversal.
  for (const asset of ["WARS", "WBRL"] as const) if (asset !== from && asset !== to && asset !== local) after[asset] = 0n;
  // No spent cap: a used-up daily limit only delays the reversal until tomorrow.
  const decision = decide({ balances: spendableBalances(after, pickGasToken(after)), rules, rates, filledUsdWad24h: 0n });
  if (decision.kind !== "convert") return false;
  const inverse = decision.from === to && decision.to === from;
  // A hub_route moves USA₮ to USD₮ first; the refill of what was sold follows on the next run.
  return inverse || (decision.reason === "hub_route" && from === local);
}
