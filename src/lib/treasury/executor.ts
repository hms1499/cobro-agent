// src/lib/treasury/executor.ts
import { randomBytes } from "node:crypto";
import { isAddressEqual, type Address, type Hex } from "viem";
import { TOKENS } from "@/lib/chain/tokens";
import {
  encodeTreasuryCall,
  pickGasToken,
  type GasToken,
  type GuardedCall,
  type SignedTreasuryTx,
  type TreasuryPolicy,
} from "@/lib/chain/treasury-tx";
import type { Db } from "@/lib/db/client";
import type { FxIntentRow, RulesRow, TreasuryTxRow, treasuryTxs, TxKind } from "@/lib/db/schema";
import type { ReferenceRates } from "@/lib/fx/rates";
import {
  CELO_CHAIN_ID,
  takerControlTypedData,
  TextileError,
  type FirmQuote,
  type RfqOutcome,
  type TextileRfqClient,
} from "@/lib/fx/rfq";
import type { PayAsset } from "@/lib/money/currencies";
import type { TreasurySigner } from "@/lib/signer/treasury-signer";
import { spendableBalances, type TreasuryBalances } from "./balances";
import {
  acceptQuote,
  decide,
  planIntent,
  slippageBps,
  type ConvertDecision,
  type EngineInput,
  type EngineRules,
  type IntentPlan,
} from "./engine";
import { claimDrip, DRIP_AMOUNT_ATOMIC, type Dripper } from "./gas";
import {
  acquireWalletLock,
  cancelIntent,
  filledUsdWad24h,
  insertTrade,
  intentById,
  lastEvent,
  loadTreasuryContext,
  logEvent,
  openIntent,
  pendingTreasuryTxs,
  recordTreasuryTx,
  releaseWalletLock,
  saveIntent,
  settleTreasuryTx,
  tradeBySwapHash,
  updateIntent,
  updateTrade,
  type TreasuryContext,
} from "./repo";
import { atomicForUsdWad, dollarsToWad, usdWad } from "./value";

export interface ExecutorChain {
  readBalances(owner: Address): Promise<TreasuryBalances>;
  allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  /** The receipt's status, or null while the node has none. */
  receipt(hash: Hex): Promise<"success" | "reverted" | null>;
  /** How many transactions from `owner` are mined (the next nonce). */
  confirmedNonce(owner: Address): Promise<number>;
  /** Sends signed bytes; bytes the node already knows are not an error. */
  sendRaw(raw: Hex): Promise<void>;
  /** Waits a bounded time; null when no receipt arrived. */
  waitForReceipt(hash: Hex): Promise<"success" | "reverted" | null>;
}

export interface ExecutorDeps {
  db: Db;
  now(): Date;
  flags: { enabled: boolean; dryRun: boolean };
  rates(): Promise<ReferenceRates>;
  chain: ExecutorChain;
  signer(ctx: TreasuryContext): TreasurySigner;
  /** Only calls built by encodeTreasuryCall can be signed (spec §6.1). */
  signTx(signer: TreasurySigner, call: GuardedCall, feeToken: GasToken): Promise<SignedTreasuryTx>;
  rfq: Pick<TextileRfqClient, "request" | "cancel" | "submit">;
  drip: Dripper;
  allowedSpenders: readonly Address[];
}

export type RunOutcome =
  | "disabled"
  | "locked"
  | "pending_tx"
  | "no_rates"
  | "idle"
  | "dry_run"
  | "needs_gas"
  | "waiting"
  | "no_quote"
  | "expired"
  | "blocked"
  | "converted"
  | "failed";

export interface RunResult {
  userId: string;
  outcome: RunOutcome;
  detail?: string;
}

/** A quote this close to its expiry is not broadcast. */
const EXPIRY_MARGIN_MS = 5_000;
/** Back-off after an RFQ error with no retry hint, or after a refused quote. */
const RETRY_AFTER_ERROR_MS = 10 * 60_000;

const cents = (wad: bigint) => Number(wad / 10n ** 16n);
const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function engineRules(rules: RulesRow): EngineRules {
  return {
    localCurrency: rules.localCurrency,
    reserveAmount: rules.reserveAmount,
    autoTopUp: rules.autoTopUp,
    perTradeMaxUsd: rules.perTradeMaxUsd,
    dailyMaxUsd: rules.dailyMaxUsd,
  };
}

function decisionData(d: ConvertDecision) {
  return { from: d.from, to: d.to, amount: d.amount.toString(), usdCents: cents(d.usdWad), reason: d.reason };
}

/** JSON with object keys sorted, so data read back from jsonb (which reorders keys) compares equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The engine's input for this wallet (spec §10.2). The engine trusts its balances, so they are the
 * spendable ones: the gas reserve is held back in the dollar token that pays for gas. Every caller of
 * decide() builds its input here (the run below, and the rules preview).
 */
export async function engineInput(
  db: Db,
  ctx: Pick<TreasuryContext, "userId" | "rules">,
  balances: TreasuryBalances,
  rates: ReferenceRates,
  now: Date,
): Promise<EngineInput> {
  return {
    balances: spendableBalances(balances, pickGasToken(balances)),
    rules: engineRules(ctx.rules),
    rates,
    filledUsdWad24h: await filledUsdWad24h(db, ctx.userId, now),
  };
}

/**
 * Gas (spec §8.6, decided 2026-10-09): CIP-64 in a dollar token the wallet holds, else one operator drip
 * a day. `spend` is what the next transactions take out of the wallet, so a token being sold still
 * leaves enough to pay with. A failed drip keeps the day's claim (controller ruling, Task 7): it is
 * logged and the caller records needs_gas. Shared with withdrawals.
 */
export async function ensureFeeToken(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "drip">,
  ctx: Pick<TreasuryContext, "userId" | "walletId" | "address">,
  balances: TreasuryBalances,
  spend?: { asset: PayAsset; amount: bigint },
): Promise<{ feeToken: GasToken | null; balances: TreasuryBalances }> {
  const feeToken = pickGasToken(balances, spend);
  if (feeToken || !(await claimDrip(deps.db, ctx.walletId, deps.now()))) return { feeToken, balances };
  try {
    await deps.drip(ctx.address, DRIP_AMOUNT_ATOMIC);
    await logEvent(deps.db, ctx.userId, "gas_dripped", { amount: DRIP_AMOUNT_ATOMIC.toString() }, deps.now());
    const after = await deps.chain.readBalances(ctx.address);
    return { feeToken: pickGasToken(after, spend), balances: after };
  } catch (error) {
    console.error(`Gas drip to ${ctx.address} failed:`, error);
    return { feeToken: null, balances };
  }
}

/** Spec §10.4 for one freelancer. Never throws for an expected condition; the outcome says what happened. */
export async function runTreasuryForUser(deps: ExecutorDeps, userId: string): Promise<RunResult> {
  const result = (outcome: RunOutcome, detail?: string): RunResult => (detail ? { userId, outcome, detail } : { userId, outcome });
  if (!deps.flags.enabled) return result("disabled");
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx || !ctx.rules.enabled) return result("disabled");
  const holder = crypto.randomUUID();
  if (!(await acquireWalletLock(deps.db, ctx.walletId, holder, deps.now()))) return result("locked");
  try {
    return await runLocked(deps, ctx, result);
  } finally {
    await releaseWalletLock(deps.db, ctx.walletId, holder);
  }
}

type Result = (outcome: RunOutcome, detail?: string) => RunResult;

async function runLocked(deps: ExecutorDeps, ctx: TreasuryContext, result: Result): Promise<RunResult> {
  // Nothing new until every earlier transaction from this wallet has an outcome (spec §12).
  if ((await reconcilePending(deps, ctx)) > 0) return result("pending_tx");

  let rates: ReferenceRates;
  try {
    rates = await deps.rates();
  } catch (error) {
    return result("no_rates", messageOf(error));
  }

  const balances = await deps.chain.readBalances(ctx.address);
  const decision = decide(await engineInput(deps.db, ctx, balances, rates, deps.now()));
  const open = await openIntent(deps.db, ctx.userId);
  const plan = planIntent(open && { id: open.id, fromAsset: open.fromAsset, toAsset: open.toAsset }, decision);
  if (plan.action === "none") {
    if (plan.cancel) await cancelIntent(deps.db, plan.cancel, deps.now());
    return result("idle", decision.kind === "none" ? decision.reason : undefined);
  }
  if (deps.flags.dryRun) return dryRun(deps, ctx, plan, result);

  const d = plan.decision;
  const intent = await saveIntent(deps.db, ctx.userId, plan, deps.now());
  if (intent.retryAfter && intent.retryAfter > deps.now()) return result("waiting", "retry_after");

  const { feeToken } = await ensureFeeToken(deps, ctx, balances, { asset: d.from, amount: d.amount });
  if (!feeToken) {
    if (intent.attempts === 0) await logEvent(deps.db, ctx.userId, "needs_gas", {}, deps.now());
    await updateIntent(deps.db, intent.id, { attempts: intent.attempts + 1 }, deps.now());
    return result("needs_gas");
  }
  return trade(deps, ctx, intent, d, feeToken, rates, result);
}

/**
 * Spec §10.3 in dry run: record what would be done, once per distinct decision, and keep no intent.
 * A stored intent would age while nothing trades, and the first live run would then treat it as past
 * the wait deadline and accept a price up to the hard limit at once.
 */
async function dryRun(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  plan: Extract<IntentPlan, { action: "convert" }>,
  result: Result,
): Promise<RunResult> {
  for (const id of [plan.cancel, plan.keep]) if (id) await cancelIntent(deps.db, id, deps.now());
  const data = decisionData(plan.decision);
  const last = await lastEvent(deps.db, ctx.userId, "dry_run");
  if (!last || stableJson(last.data) !== stableJson(data)) await logEvent(deps.db, ctx.userId, "dry_run", data, deps.now());
  return result("dry_run");
}

/** Spec §6.1: bound to this wallet, within the intent, on an allowed contract, on Celo, moving no CELO. */
function quoteMatches(q: FirmQuote, taker: Address, maxSell: bigint, allowed: readonly Address[]): boolean {
  return (
    isAddressEqual(q.taker, taker) &&
    q.takerPays > 0n &&
    q.takerPays <= maxSell &&
    isAddressEqual(q.swap.to, q.spender) &&
    q.swap.chainId === CELO_CHAIN_ID &&
    q.swap.value === 0n &&
    allowed.some((spender) => isAddressEqual(spender, q.spender))
  );
}

async function trade(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  intent: FxIntentRow,
  d: ConvertDecision,
  feeToken: GasToken,
  rates: ReferenceRates,
  result: Result,
): Promise<RunResult> {
  const signer = deps.signer(ctx);
  const attempts = intent.attempts + 1;
  const firstAttempt = intent.attempts === 0;

  // Spec §10.4 step 3, with a fresh taker proof each time (Textile accepts one for 60 s).
  let outcome: RfqOutcome;
  try {
    const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
    const issuedAt = deps.now().getTime();
    const signature = await signer.signTypedData(takerControlTypedData(ctx.address, nonce, issuedAt));
    outcome = await deps.rfq.request({
      sellToken: TOKENS[d.from].address,
      buyToken: TOKENS[d.to].address,
      sellAmount: d.amount,
      taker: ctx.address,
      takerProof: { nonce, issuedAt, signature },
    });
  } catch (error) {
    // Textile errors (insufficient_funds, 429, 5xx, network) and Para errors alike: wait and retry (spec §12).
    if (!(error instanceof TextileError)) console.error(`RFQ for ${ctx.userId} failed:`, error);
    const reason = error instanceof TextileError ? (error.reason ?? `http_${error.status}`) : "error";
    return noQuote(deps, ctx, intent, d, reason, RETRY_AFTER_ERROR_MS, result);
  }
  if (outcome.status === "no_quote") return noQuote(deps, ctx, intent, d, outcome.reason, outcome.retryAfterMs, result);

  const q = outcome.quote;
  const quotedTrade = {
    userId: ctx.userId,
    intentId: intent.id,
    rfqId: q.rfqId,
    sellAsset: d.from,
    buyAsset: d.to,
    sellAmount: q.takerPays.toString(),
    buyAmount: q.buyAmount.toString(),
    feeAmount: q.feeAmount.toString(),
  };
  const refuse = async (status: "rejected" | "expired", detail: string, slippage: number | null) => {
    await deps.rfq.cancel(q.rfqId, q.claimToken).catch((error) => console.error(`Textile cancel ${q.rfqId} failed:`, error));
    await insertTrade(deps.db, { ...quotedTrade, status, detail, slippageBps: slippage });
  };

  // The quote must be what we asked for: bound to this wallet, within the intent, on an allowed contract.
  if (!quoteMatches(q, ctx.address, d.amount, deps.allowedSpenders)) {
    await refuse("rejected", "policy", null);
    await updateIntent(deps.db, intent.id, { attempts, retryAfter: new Date(deps.now().getTime() + RETRY_AFTER_ERROR_MS) }, deps.now());
    await logEvent(deps.db, ctx.userId, "policy_rejected", { ...decisionData(d), spender: q.spender }, deps.now());
    return result("failed", "policy");
  }

  // Spec §10.3.
  const slippage = slippageBps(d.from, q.takerPays, d.to, q.buyAmount, rates);
  const verdict = acceptQuote({
    slippageBps: slippage,
    intentCreatedAt: intent.createdAt,
    now: deps.now(),
    maxSlippageBps: ctx.rules.maxSlippageBps,
    hardMaxSlippageBps: ctx.rules.hardMaxSlippageBps,
    maxWaitMinutes: ctx.rules.maxWaitMinutes,
  });
  if (verdict === "block") {
    await refuse("rejected", "price_blocked", slippage);
    await updateIntent(deps.db, intent.id, { status: "blocked", attempts, lastSlippageBps: slippage }, deps.now());
    await logEvent(
      deps.db,
      ctx.userId,
      "blocked",
      { ...decisionData(d), slippageBps: slippage, limitBps: ctx.rules.hardMaxSlippageBps },
      deps.now(),
    );
    return result("blocked");
  }
  if (verdict === "wait") {
    await refuse("rejected", "price", slippage);
    await updateIntent(deps.db, intent.id, { attempts, lastSlippageBps: slippage }, deps.now());
    if (firstAttempt) {
      await logEvent(
        deps.db,
        ctx.userId,
        "waiting",
        { ...decisionData(d), slippageBps: slippage, limitBps: ctx.rules.maxSlippageBps },
        deps.now(),
      );
    }
    return result("waiting", "price");
  }

  await updateIntent(deps.db, intent.id, { status: "executing", attempts, lastSlippageBps: slippage }, deps.now());
  const policy: TreasuryPolicy = { allowedSpenders: deps.allowedSpenders, personalWallet: ctx.personalWallet };

  // Spec §10.4 step 5: approve up to what is left of the daily cap; USD₮ needs a reset to 0 first.
  const allowance = await deps.chain.allowance(TOKENS[d.from].address, ctx.address, q.spender);
  if (allowance < q.takerPays) {
    const dailyLeft = dollarsToWad(ctx.rules.dailyMaxUsd) - (await filledUsdWad24h(deps.db, ctx.userId, deps.now()));
    const target = maxBig(q.takerPays, atomicForUsdWad(d.from, dailyLeft, rates));
    for (const amount of d.from === "USDT" && allowance > 0n ? [0n, target] : [target]) {
      const call = encodeTreasuryCall({ kind: "approve", asset: d.from, spender: q.spender, amount }, policy);
      const sent = await sendTreasuryTx(deps, ctx, signer, "approve", call, feeToken);
      if (sent.status !== "success") {
        await refuse("rejected", `approve_${sent.status ?? "pending"}`, slippage);
        await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
        return sent.status === null ? result("pending_tx", "approve") : result("failed", "approve");
      }
    }
  }
  if (deps.now().getTime() >= q.expiresAt.getTime() - EXPIRY_MARGIN_MS) {
    // Spec §12: an expired quote is discarded, never sent. The allowance stays for the next run.
    await refuse("expired", "quote_expired", slippage);
    await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
    return result("expired");
  }

  // Store the signed bytes and the trade before broadcasting, so a crash right after is reconcilable.
  const signed = await deps.signTx(signer, encodeTreasuryCall({ kind: "swap", ...q.swap }, policy), feeToken);
  await deps.db.transaction(async (tx) => {
    await recordTreasuryTx(tx, { userId: ctx.userId, kind: "swap", nonce: signed.nonce, hash: signed.hash, raw: signed.raw, feeToken });
    await insertTrade(tx, {
      ...quotedTrade,
      claimToken: q.claimToken,
      slippageBps: slippage,
      notionalUsdCents: cents(usdWad(d.from, q.takerPays, rates)),
      status: "broadcast",
      swapTxHash: signed.hash,
    });
  });
  await deps.chain.sendRaw(signed.raw);
  const status = await deps.chain.waitForReceipt(signed.hash);
  if (status === null) return result("pending_tx", "swap");
  await settleSwap(deps, ctx.userId, signed.hash, status);
  return status === "success" ? result("converted") : result("failed", "swap_reverted");
}

async function noQuote(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  intent: FxIntentRow,
  d: ConvertDecision,
  reason: string,
  retryAfterMs: number | null,
  result: Result,
): Promise<RunResult> {
  const now = deps.now();
  await insertTrade(deps.db, {
    userId: ctx.userId,
    intentId: intent.id,
    sellAsset: d.from,
    buyAsset: d.to,
    sellAmount: d.amount.toString(),
    status: "no_quote",
    detail: reason,
  });
  await updateIntent(
    deps.db,
    intent.id,
    { attempts: intent.attempts + 1, retryAfter: retryAfterMs ? new Date(now.getTime() + retryAfterMs) : null },
    now,
  );
  if (intent.attempts === 0) await logEvent(deps.db, ctx.userId, "no_quote", { ...decisionData(d), detail: reason }, now);
  return result("no_quote", reason);
}

/** Signs, stores, broadcasts and waits for one treasury transaction. Shared with withdrawals. */
export async function sendTreasuryTx(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "signTx">,
  ctx: TreasuryContext,
  signer: TreasurySigner,
  kind: TxKind,
  call: GuardedCall,
  feeToken: GasToken,
  extra: Pick<typeof treasuryTxs.$inferInsert, "asset" | "amountAtomic" | "toAddress" | "usdCents"> = {},
): Promise<{ hash: Hex; status: "success" | "reverted" | null }> {
  const signed = await deps.signTx(signer, call, feeToken);
  await recordTreasuryTx(deps.db, {
    userId: ctx.userId,
    kind,
    nonce: signed.nonce,
    hash: signed.hash,
    raw: signed.raw,
    feeToken,
    ...extra,
  });
  await deps.chain.sendRaw(signed.raw);
  const status = await deps.chain.waitForReceipt(signed.hash);
  if (status) await settleTreasuryTx(deps.db, signed.hash, status, deps.now());
  return { hash: signed.hash, status };
}

export async function settleSwap(
  deps: Pick<ExecutorDeps, "db" | "now" | "rfq">,
  userId: string,
  hash: string,
  status: "success" | "reverted",
): Promise<void> {
  await settleTreasuryTx(deps.db, hash, status, deps.now());
  const trade = await tradeBySwapHash(deps.db, hash);
  if (!trade) return;
  const intent = trade.intentId ? await intentById(deps.db, trade.intentId) : null;
  const data = {
    from: trade.sellAsset,
    to: trade.buyAsset,
    amount: trade.sellAmount,
    buyAmount: trade.buyAmount,
    slippageBps: trade.slippageBps,
    reason: intent?.reason ?? null,
    txHash: hash,
  };
  if (status === "success") {
    await updateTrade(deps.db, trade.id, { status: "filled", filledAt: deps.now() });
    if (intent) await updateIntent(deps.db, intent.id, { status: "filled" }, deps.now());
    if (trade.rfqId && trade.claimToken) {
      await deps.rfq
        .submit(trade.rfqId, trade.claimToken, hash as Hex)
        .catch((error) => console.error(`Textile submit ${trade.rfqId} failed:`, error));
    }
    await logEvent(deps.db, userId, "converted", data, deps.now());
  } else {
    await updateTrade(deps.db, trade.id, { status: "failed", detail: "reverted" });
    if (intent?.status === "executing") await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
    await logEvent(deps.db, userId, "swap_failed", data, deps.now());
  }
}

export async function settleWithdrawal(
  deps: Pick<ExecutorDeps, "db" | "now">,
  tx: Pick<TreasuryTxRow, "userId" | "hash" | "asset" | "amountAtomic">,
  status: "success" | "reverted",
): Promise<void> {
  await settleTreasuryTx(deps.db, tx.hash, status, deps.now());
  await logEvent(
    deps.db,
    tx.userId,
    status === "success" ? "withdrawn" : "withdraw_failed",
    { asset: tx.asset, amount: tx.amountAtomic, txHash: tx.hash },
    deps.now(),
  );
}

/**
 * Spec §10.4 step 7: settle every pending transaction by its receipt. One with no receipt whose
 * nonce a later transaction already used can never land and counts as failed; otherwise the
 * identical signed bytes are sent again. Returns how many are still pending.
 */
export async function reconcilePending(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "rfq">,
  ctx: TreasuryContext,
): Promise<number> {
  let stillPending = 0;
  for (const tx of await pendingTreasuryTxs(deps.db, ctx.userId)) {
    let status = await deps.chain.receipt(tx.hash as Hex);
    if (status === null && (await deps.chain.confirmedNonce(ctx.address)) > tx.nonce) {
      // Mined between the two reads, or replaced: ask once more before calling it failed.
      status = (await deps.chain.receipt(tx.hash as Hex)) ?? "reverted";
    }
    if (status === null) {
      await deps.chain.sendRaw(tx.raw as Hex).catch((error) => console.error(`Re-sending ${tx.hash} failed:`, error));
      stillPending += 1;
      continue;
    }
    if (tx.kind === "swap") await settleSwap(deps, ctx.userId, tx.hash, status);
    else if (tx.kind === "withdraw") await settleWithdrawal(deps, tx, status);
    else await settleTreasuryTx(deps.db, tx.hash, status, deps.now());
  }
  return stillPending;
}

/** Runs wallets one after another; a failure never stops the others. Stops starting new ones after `deadline`. */
export async function runTreasuries(
  userIds: string[],
  run: (userId: string) => Promise<RunResult>,
  opts: { deadline?: number; now?: () => number } = {},
): Promise<RunResult[]> {
  const now = opts.now ?? Date.now;
  const results: RunResult[] = [];
  for (const userId of userIds) {
    if (opts.deadline !== undefined && now() > opts.deadline) break;
    try {
      results.push(await run(userId));
    } catch (error) {
      console.error(`Treasury run for ${userId} failed:`, error);
      results.push({ userId, outcome: "failed", detail: messageOf(error) });
    }
  }
  return results;
}

export function summarizeRuns(results: RunResult[]): Partial<Record<RunOutcome, number>> {
  const summary: Partial<Record<RunOutcome, number>> = {};
  for (const { outcome } of results) summary[outcome] = (summary[outcome] ?? 0) + 1;
  return summary;
}
