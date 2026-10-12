// src/lib/treasury/engine.ts
import type { ReferenceRates } from "@/lib/fx/rates";
import type { LocalCurrency, PayAsset } from "@/lib/money/currencies";
import { atomicForUsdWad, dollarsToWad, fiatToAtomic, LOCAL_ASSET, usdWad, WAD } from "./value";

/** Spendable balances: the gas reserve has already been taken out (see spendableBalances). */
export type Balances = Record<PayAsset, bigint>;
export type ConvertReason = "save_excess" | "save_other" | "top_up" | "hub_route";
export type IdleReason = "within_band" | "daily_cap" | "below_minimum" | "no_dollars";

export interface EngineRules {
  localCurrency: LocalCurrency;
  reserveAmount: string;
  autoTopUp: boolean;
  perTradeMaxUsd: number;
  dailyMaxUsd: number;
}

export interface EngineInput {
  balances: Balances;
  rules: EngineRules;
  rates: ReferenceRates;
  /** Notional of swaps broadcast or filled in the last 24 hours. */
  filledUsdWad24h: bigint;
}

export type ConvertDecision = {
  kind: "convert";
  from: PayAsset;
  to: PayAsset;
  amount: bigint;
  usdWad: bigint;
  reason: ConvertReason;
};
export type Decision = { kind: "none"; reason: IdleReason } | ConvertDecision;

/** Textile refuses RFQs below $1 of notional (spec §8.3). */
export const MIN_NOTIONAL_WAD = WAD;

const none = (reason: IdleReason): Decision => ({ kind: "none", reason });
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Spec §10.2: balances and rules in, one decision out, no I/O. LOCAL is the spending token, USD is
 * USD₮ + USA₮, band = max(5% of the reserve, $1). Each trade is capped by perTradeMaxUsd and by what
 * is left of dailyMaxUsd; larger needs are split across runs.
 */
export function decide(input: EngineInput): Decision {
  const { balances, rules, rates } = input;
  const local = LOCAL_ASSET[rules.localCurrency];
  const other = local === "WARS" ? "WBRL" : "WARS";
  const capLeft = min(dollarsToWad(rules.perTradeMaxUsd), max(0n, dollarsToWad(rules.dailyMaxUsd) - input.filledUsdWad24h));

  const sized = (from: PayAsset, to: PayAsset, wanted: bigint, reason: ConvertReason): Decision => {
    if (capLeft < MIN_NOTIONAL_WAD) return none("daily_cap");
    let amount = wanted;
    let usd = usdWad(from, amount, rates);
    if (usd > capLeft) {
      amount = atomicForUsdWad(from, capLeft, rates);
      usd = usdWad(from, amount, rates);
    }
    if (usd < MIN_NOTIONAL_WAD) return none("below_minimum");
    return { kind: "convert", from, to, amount, usdWad: usd, reason };
  };

  // Paid in the other local currency: not spendable for this freelancer, so it is saved in dollars.
  if (usdWad(other, balances[other], rates) >= MIN_NOTIONAL_WAD) {
    return sized(other, "USDT", balances[other], "save_other");
  }

  const reserve = fiatToAtomic(rules.reserveAmount, local);
  const band = max(reserve / 20n, atomicForUsdWad(local, WAD, rates));
  const held = balances[local];
  if (held > reserve + band) return sized(local, "USDT", held - reserve, "save_excess");

  if (rules.autoTopUp && reserve > held + band) {
    const needed = usdWad(local, reserve - held, rates);
    if (usdWad("USDT", balances.USDT, rates) >= MIN_NOTIONAL_WAD) {
      return sized("USDT", local, min(balances.USDT, atomicForUsdWad("USDT", needed, rates)), "top_up");
    }
    // Textile has no USA₮ → peso corridor: move USA₮ to USD₮ first; the USD₮ leg follows next run.
    if (usdWad("USAT", balances.USAT, rates) >= MIN_NOTIONAL_WAD) {
      return sized("USAT", "USDT", min(balances.USAT, atomicForUsdWad("USAT", needed, rates)), "hub_route");
    }
    return none("no_dollars");
  }
  return none("within_band");
}

export interface OpenIntent {
  id: string;
  fromAsset: PayAsset;
  toAsset: PayAsset;
}

export type IntentPlan =
  | { action: "none"; cancel: string | null }
  | { action: "convert"; keep: string | null; cancel: string | null; decision: ConvertDecision };

/** Spec §10.2: the same pair keeps the open intent (and its age, for the wait deadline); anything else cancels it. */
export function planIntent(open: OpenIntent | null, decision: Decision): IntentPlan {
  if (decision.kind === "none") return { action: "none", cancel: open?.id ?? null };
  if (open && open.fromAsset === decision.from && open.toAsset === decision.to) {
    return { action: "convert", keep: open.id, cancel: null, decision };
  }
  return { action: "convert", keep: null, cancel: open?.id ?? null, decision };
}

export type Acceptance = "accept" | "wait" | "block";

/** Spec §10.3. */
export function acceptQuote(input: {
  slippageBps: number;
  intentCreatedAt: Date;
  now: Date;
  maxSlippageBps: number;
  hardMaxSlippageBps: number;
  maxWaitMinutes: number;
}): Acceptance {
  if (input.slippageBps <= input.maxSlippageBps) return "accept";
  const waited = input.now.getTime() - input.intentCreatedAt.getTime() >= input.maxWaitMinutes * 60_000;
  if (!waited) return "wait";
  return input.slippageBps <= input.hardMaxSlippageBps ? "accept" : "block";
}

/**
 * How much worse than the reference mid the quote is, in basis points of what we pay: positive is
 * worse, negative is better. Both legs are valued in USD at the reference rates; a loss is rounded up.
 */
export function slippageBps(
  sellAsset: PayAsset,
  sellAtomic: bigint,
  buyAsset: PayAsset,
  buyAtomic: bigint,
  rates: ReferenceRates,
): number {
  const paid = usdWad(sellAsset, sellAtomic, rates);
  if (paid <= 0n) throw new Error("A quote must sell a positive amount");
  const loss = (paid - usdWad(buyAsset, buyAtomic, rates)) * 10_000n;
  return Number(loss > 0n ? (loss + paid - 1n) / paid : loss / paid);
}
