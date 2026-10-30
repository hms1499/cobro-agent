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
import { approvalGroup, GROUP_REASONS, modeNeedsApproval, waitStartedAt } from "./approvals";
import { claimDrip, DRIP_AMOUNT_ATOMIC, type Dripper } from "./gas";
import {
  acquireWalletLock,
  cancelIntent,
  dismissedRecently,
  filledUsdWad24h,
  inheritableApproval,
  insertTrade,
  intentById,
  lastEvent,
  loadTreasuryContext,
  logEvent,
  openIntent,
  pendingTreasuryTxs,
  proposeIntent,
  recordTreasuryTx,
  releaseWalletLock,
  saveIntent,
  settleTreasuryTx,
  tradeBySwapHash,
  updateIntent,
  updateTrade,
  usersWithPendingTxs,
  type SaveApproval,
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
  /** Whether the node knows the transaction at all (in its pool or mined). */
  knownTx(hash: Hex): Promise<boolean>;
  /**
   * Sends signed bytes; bytes the node already knows are not an error. Throws TxRejectedError when the
   * node refused them outright (so they hold no nonce); any other error leaves the outcome unknown.
   */
  sendRaw(raw: Hex): Promise<void>;
  /** Waits a bounded time; null when no receipt arrived. */
  waitForReceipt(hash: Hex): Promise<"success" | "reverted" | null>;
}

/** The node answered and refused the signed bytes (bad signature, nonce already used, …): they can never land as sent. */
export class TxRejectedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TxRejectedError";
  }
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
  | "awaiting_approval"
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
/** A pending transaction the node neither knows nor accepts again is given up after this long. */
const DROP_AFTER_MS = 30 * 60_000;

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

/**
 * What a dry-run event is deduplicated on: the pair and the reason. The amount and its dollar value
 * follow the reference rates (top-ups and capped trades are sized by them), so comparing those would
 * log a new event on nearly every cron run.
 */
function dryRunKey(data: Record<string, unknown>): string {
  return JSON.stringify([data.from, data.to, data.reason]);
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
  if ((await reconcilePending(deps, ctx)).stillPending > 0) return result("pending_tx");

  let rates: ReferenceRates;
  try {
    rates = await deps.rates();
  } catch (error) {
    return result("no_rates", messageOf(error));
  }

  const balances = await deps.chain.readBalances(ctx.address);
  const decision = decide(await engineInput(deps.db, ctx, balances, rates, deps.now()));
  const open = await openIntent(deps.db, ctx.userId);
  // Trade approvals §5.1 step 2: a dismissed group stays quiet for 24 hours, unless the mode no longer asks.
  if (
    decision.kind === "convert" &&
    ctx.rules.approvalMode !== "auto" &&
    (await dismissedRecently(deps.db, ctx.userId, GROUP_REASONS[approvalGroup(decision.reason)], deps.now()))
  ) {
    if (open) await cancelIntent(deps.db, open.id, deps.now());
    return result("idle", "dismissed");
  }
  const plan = planIntent(open && { id: open.id, fromAsset: open.fromAsset, toAsset: open.toAsset }, decision);
  if (plan.action === "none") {
    if (plan.cancel) await cancelIntent(deps.db, plan.cancel, deps.now());
    return result("idle", decision.kind === "none" ? decision.reason : undefined);
  }

  const approval = await approvalFor(deps, ctx, open, plan);
  if (approval.kind === "needed") return propose(deps, ctx, plan, result);
  const sized = { ...plan, decision: capDecision(plan.decision, approval.cap, rates) };
  if (deps.flags.dryRun) return dryRun(deps, ctx, sized, approval.approved, result);

  const intent = await saveIntent(deps.db, ctx.userId, sized, deps.now(), approval.save);
  // The freelancer may have approved a lower amount since `open` was read: the stored approval is the limit.
  const d = intent.approvedAmountAtomic === null ? sized.decision : capDecision(sized.decision, BigInt(intent.approvedAmountAtomic), rates);
  if (intent.retryAfter && intent.retryAfter > deps.now()) return result("waiting", "retry_after");

  const { feeToken } = await ensureFeeToken(deps, ctx, balances, { asset: d.from, amount: d.amount });
  if (!feeToken) {
    await logOncePerIntent(deps, ctx.userId, intent.id, "needs_gas", {});
    await updateIntent(deps.db, intent.id, { attempts: intent.attempts + 1 }, deps.now());
    return result("needs_gas");
  }
  return trade(deps, ctx, intent, d, feeToken, rates, result);
}

type Approval =
  | { kind: "needed" }
  /** `approved`: the freelancer (or an inherited approval) already said yes, so dry run keeps the intent. */
  | { kind: "granted"; cap: bigint | null; save: SaveApproval; approved: boolean };

/** Trade approvals §5.1 step 4, in order: an earlier approval, the auto mode, an inherited approval, the mode table. */
async function approvalFor(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  open: FxIntentRow | null,
  plan: Extract<IntentPlan, { action: "convert" }>,
): Promise<Approval> {
  const kept = plan.keep !== null && open?.id === plan.keep ? open : null;
  if (kept?.approvedAt) {
    const cap = kept.approvedAmountAtomic === null ? null : BigInt(kept.approvedAmountAtomic);
    return { kind: "granted", cap, save: {}, approved: true };
  }
  const mode = ctx.rules.approvalMode;
  // Selling pesos/reais for dollars is all a dollars freelancer's agent does: it never asks (USD home spec §2.3).
  if (mode === "auto" || ctx.rules.localCurrency === "USD") return { kind: "granted", cap: null, save: {}, approved: false };
  if (plan.decision.reason === "top_up") {
    const parent = await inheritableApproval(deps.db, ctx.userId, deps.now());
    if (parent) {
      return { kind: "granted", cap: parent.boughtAtomic, save: { via: parent.intentId, capAtomic: parent.boughtAtomic }, approved: true };
    }
  }
  if (modeNeedsApproval(mode, plan.decision.reason)) return { kind: "needed" };
  return { kind: "granted", cap: null, save: {}, approved: false };
}

/** Trade approvals §2: never more than the freelancer approved. */
function capDecision(d: ConvertDecision, cap: bigint | null, rates: ReferenceRates): ConvertDecision {
  if (cap === null || d.amount <= cap) return d;
  return { ...d, amount: cap, usdWad: usdWad(d.from, cap, rates) };
}

/** Trade approvals §5.1 step 5: store the proposal and tell the freelancer once per intent. */
async function propose(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  plan: Extract<IntentPlan, { action: "convert" }>,
  result: Result,
): Promise<RunResult> {
  const intent = await proposeIntent(deps.db, ctx.userId, plan, deps.now());
  await logOncePerIntent(deps, ctx.userId, intent.id, "proposed", decisionData(plan.decision));
  return result("awaiting_approval");
}

/**
 * waiting, no_quote and needs_gas repeat on every run while an intent waits; each is told once per
 * intent. The intent id in the event's data is what the next run compares.
 */
async function logOncePerIntent(
  deps: Pick<ExecutorDeps, "db" | "now">,
  userId: string,
  intentId: string,
  type: "waiting" | "no_quote" | "needs_gas" | "proposed",
  data: Record<string, unknown>,
): Promise<void> {
  const last = await lastEvent(deps.db, userId, type);
  if (last?.data.intentId === intentId) return;
  await logEvent(deps.db, userId, type, { ...data, intentId }, deps.now());
}

/**
 * Spec §10.3 in dry run: record what would be done, once per pair and reason, and keep no intent.
 * A stored intent would age while nothing trades, and the first live run would then treat it as past
 * the wait deadline and accept a price up to the hard limit at once. An approved intent is the
 * exception (trade approvals §5.3): cancelling it would make the next run propose it again.
 */
async function dryRun(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  plan: Extract<IntentPlan, { action: "convert" }>,
  keepApproved: boolean,
  result: Result,
): Promise<RunResult> {
  for (const id of [plan.cancel, keepApproved ? null : plan.keep]) if (id) await cancelIntent(deps.db, id, deps.now());
  const data = decisionData(plan.decision);
  const last = await lastEvent(deps.db, ctx.userId, "dry_run");
  if (!last || dryRunKey(last.data) !== dryRunKey(data)) await logEvent(deps.db, ctx.userId, "dry_run", data, deps.now());
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

/** Spec §10.4 for one intent, from the RFQ to the swap. Each step below returns early with the outcome when it stops the trade. */
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
  const outcome = await requestQuote(deps, ctx, signer, d);
  if (outcome.status === "no_quote") return noQuote(deps, ctx, intent, d, outcome.reason, outcome.retryAfterMs, result);

  const q = outcome.quote;
  const run: QuoteRun = {
    deps,
    ctx,
    intent,
    d,
    q,
    signer,
    feeToken,
    rates,
    result,
    attempts: intent.attempts + 1,
    policy: { allowedSpenders: deps.allowedSpenders, personalWallet: ctx.personalWallet, withdrawalAddresses: [] },
    quotedTrade: quotedTradeRow(ctx, intent, d, q),
  };
  // The quote must be what we asked for: bound to this wallet, within the intent, on an allowed contract.
  if (!quoteMatches(q, ctx.address, d.amount, deps.allowedSpenders)) return rejectOffPolicy(run);

  const slippage = slippageBps(d.from, q.takerPays, d.to, q.buyAmount, rates);
  const priceRefused = await refuseOnPrice(run, slippage);
  if (priceRefused) return priceRefused;

  await updateIntent(deps.db, intent.id, { status: "executing", attempts: run.attempts, lastSlippageBps: slippage }, deps.now());
  // Expiry is checked before the approval too, so no gas goes on a quote that is already too old.
  const stopped =
    (await discardIfExpired(run, slippage)) ?? (await ensureAllowance(run, slippage)) ?? (await discardIfExpired(run, slippage));
  if (stopped) return stopped;
  return sendSwap(run, slippage);
}

/** One firm quote on its way from the checks to the swap: what every step of trade() after the RFQ needs. */
interface QuoteRun {
  deps: ExecutorDeps;
  ctx: TreasuryContext;
  intent: FxIntentRow;
  d: ConvertDecision;
  q: FirmQuote;
  signer: TreasurySigner;
  feeToken: GasToken;
  rates: ReferenceRates;
  result: Result;
  /** The intent's attempt count with this run included. */
  attempts: number;
  policy: TreasuryPolicy;
  /** The fx_trades fields every row written for this quote shares. */
  quotedTrade: ReturnType<typeof quotedTradeRow>;
}

function quotedTradeRow(ctx: TreasuryContext, intent: FxIntentRow, d: ConvertDecision, q: FirmQuote) {
  return {
    userId: ctx.userId,
    intentId: intent.id,
    rfqId: q.rfqId,
    sellAsset: d.from,
    buyAsset: d.to,
    sellAmount: q.takerPays.toString(),
    buyAmount: q.buyAmount.toString(),
    feeAmount: q.feeAmount.toString(),
  };
}

/** Spec §10.4 step 3, with a fresh taker proof each time (Textile accepts one for 60 s). An error becomes a no-quote. */
async function requestQuote(deps: ExecutorDeps, ctx: TreasuryContext, signer: TreasurySigner, d: ConvertDecision): Promise<RfqOutcome> {
  try {
    const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
    const issuedAt = deps.now().getTime();
    const signature = await signer.signTypedData(takerControlTypedData(ctx.address, nonce, issuedAt));
    return await deps.rfq.request({
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
    return { status: "no_quote", reason, retryAfterMs: RETRY_AFTER_ERROR_MS };
  }
}

/** Tells Textile the quote will not be filled. A failed cancel is only logged. */
async function cancelQuote({ deps, q }: QuoteRun): Promise<void> {
  await deps.rfq.cancel(q.rfqId, q.claimToken).catch((error) => console.error(`Textile cancel ${q.rfqId} failed:`, error));
}

/** Cancels the quote and records the trade as not taken. */
async function refuseQuote(run: QuoteRun, status: "rejected" | "expired", detail: string, slippage: number | null): Promise<void> {
  await cancelQuote(run);
  await insertTrade(run.deps.db, { ...run.quotedTrade, status, detail, slippageBps: slippage });
}

async function rejectOffPolicy(run: QuoteRun): Promise<RunResult> {
  const { deps, ctx, intent, d, q } = run;
  await refuseQuote(run, "rejected", "policy", null);
  await updateIntent(deps.db, intent.id, { attempts: run.attempts, retryAfter: new Date(deps.now().getTime() + RETRY_AFTER_ERROR_MS) }, deps.now());
  await logEvent(deps.db, ctx.userId, "policy_rejected", { ...decisionData(d), spender: q.spender }, deps.now());
  return run.result("failed", "policy");
}

/** Spec §10.3: blocks a price past the hard limit, waits on one past the normal limit. Null when the price is accepted. */
async function refuseOnPrice(run: QuoteRun, slippage: number): Promise<RunResult | null> {
  const { deps, ctx, intent, d } = run;
  const verdict = acceptQuote({
    slippageBps: slippage,
    intentCreatedAt: waitStartedAt(intent),
    now: deps.now(),
    maxSlippageBps: ctx.rules.maxSlippageBps,
    hardMaxSlippageBps: ctx.rules.hardMaxSlippageBps,
    maxWaitMinutes: ctx.rules.maxWaitMinutes,
  });
  if (verdict === "block") {
    await refuseQuote(run, "rejected", "price_blocked", slippage);
    await updateIntent(deps.db, intent.id, { status: "blocked", attempts: run.attempts, lastSlippageBps: slippage }, deps.now());
    await logEvent(
      deps.db,
      ctx.userId,
      "blocked",
      { ...decisionData(d), slippageBps: slippage, limitBps: ctx.rules.hardMaxSlippageBps },
      deps.now(),
    );
    return run.result("blocked");
  }
  if (verdict === "wait") {
    await refuseQuote(run, "rejected", "price", slippage);
    await updateIntent(deps.db, intent.id, { attempts: run.attempts, lastSlippageBps: slippage }, deps.now());
    await logOncePerIntent(deps, ctx.userId, intent.id, "waiting", {
      ...decisionData(d),
      slippageBps: slippage,
      limitBps: ctx.rules.maxSlippageBps,
    });
    return run.result("waiting", "price");
  }
  return null;
}

/** Spec §10.4 step 5: approve up to what is left of the daily cap; USD₮ needs a reset to 0 first. Null once the spender may take the quote. */
async function ensureAllowance(run: QuoteRun, slippage: number): Promise<RunResult | null> {
  const { deps, ctx, intent, d, q, rates } = run;
  const allowance = await deps.chain.allowance(TOKENS[d.from].address, ctx.address, q.spender);
  if (allowance >= q.takerPays) return null;
  const dailyLeft = dollarsToWad(ctx.rules.dailyMaxUsd) - (await filledUsdWad24h(deps.db, ctx.userId, deps.now()));
  const target = maxBig(q.takerPays, atomicForUsdWad(d.from, dailyLeft, rates));
  for (const amount of d.from === "USDT" && allowance > 0n ? [0n, target] : [target]) {
    const call = encodeTreasuryCall({ kind: "approve", asset: d.from, spender: q.spender, amount }, run.policy);
    const sent = await sendTreasuryTx(deps, ctx, run.signer, "approve", call, run.feeToken);
    if (sent.status) await settleTreasuryTx(deps.db, sent.hash, sent.status === "rejected" ? "failed" : sent.status, deps.now());
    if (sent.status !== "success") {
      await refuseQuote(run, "rejected", `approve_${sent.status ?? "pending"}`, slippage);
      if (sent.status === null) {
        await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
        return run.result("pending_tx", "approve");
      }
      // Refused or reverted: back off as after a refused quote, so a failing approval is not resent (and paid for) every run.
      const retryAfter = new Date(deps.now().getTime() + RETRY_AFTER_ERROR_MS);
      await updateIntent(deps.db, intent.id, { status: "waiting", retryAfter }, deps.now());
      await logEvent(deps.db, ctx.userId, "swap_failed", { ...decisionData(d), detail: `approve_${sent.status}` }, deps.now());
      return run.result("failed", "approve");
    }
  }
  return null;
}

/** Spec §12: a quote this close to its expiry is discarded, never sent. An allowance already granted stays for the next run. */
async function discardIfExpired(run: QuoteRun, slippage: number): Promise<RunResult | null> {
  const { deps, intent, q } = run;
  if (deps.now().getTime() < q.expiresAt.getTime() - EXPIRY_MARGIN_MS) return null;
  await refuseQuote(run, "expired", "quote_expired", slippage);
  await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
  return run.result("expired");
}

async function sendSwap(run: QuoteRun, slippage: number): Promise<RunResult> {
  const { deps, ctx, d, q, rates } = run;
  // Store the signed bytes and the trade before broadcasting, so a crash right after is reconcilable.
  const signed = await deps.signTx(run.signer, encodeTreasuryCall({ kind: "swap", ...q.swap }, run.policy), run.feeToken);
  await deps.db.transaction(async (tx) => {
    await recordTreasuryTx(tx, {
      userId: ctx.userId,
      kind: "swap",
      nonce: signed.nonce,
      hash: signed.hash,
      raw: signed.raw,
      feeToken: run.feeToken,
    });
    await insertTrade(tx, {
      ...run.quotedTrade,
      claimToken: q.claimToken,
      slippageBps: slippage,
      notionalUsdCents: cents(usdWad(d.from, q.takerPays, rates)),
      status: "broadcast",
      swapTxHash: signed.hash,
    });
  });
  if (!(await broadcast(deps, signed.hash, signed.raw))) {
    await settleSwap(deps, ctx.userId, signed.hash, "failed", "rejected");
    await cancelQuote(run);
    return run.result("failed", "swap_rejected");
  }
  const status = await deps.chain.waitForReceipt(signed.hash);
  if (status === null) return run.result("pending_tx", "swap");
  await settleSwap(deps, ctx.userId, signed.hash, status);
  return status === "success" ? run.result("converted") : run.result("failed", "swap_reverted");
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
  await logOncePerIntent(deps, ctx.userId, intent.id, "no_quote", { ...decisionData(d), detail: reason });
  return result("no_quote", reason);
}

/**
 * The first broadcast of freshly stored bytes. False when the node refused them outright: their nonce
 * was never used, so the caller marks them failed at once (balances are always re-read from chain).
 * Any other error is rethrown and the transaction stays pending for reconcilePending.
 */
async function broadcast(deps: Pick<ExecutorDeps, "chain">, hash: Hex, raw: Hex): Promise<boolean> {
  try {
    await deps.chain.sendRaw(raw);
    return true;
  } catch (error) {
    if (!(error instanceof TxRejectedError)) throw error;
    console.error(`The node refused treasury transaction ${hash}:`, error.message);
    return false;
  }
}

/**
 * Signs, stores, broadcasts and waits for one treasury transaction. Shared with withdrawals. The
 * caller settles the stored row from the status: "rejected" means the node refused the bytes.
 */
export async function sendTreasuryTx(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "signTx">,
  ctx: TreasuryContext,
  signer: TreasurySigner,
  kind: TxKind,
  call: GuardedCall,
  feeToken: GasToken,
  extra: Pick<typeof treasuryTxs.$inferInsert, "asset" | "amountAtomic" | "toAddress" | "toLabel" | "usdCents"> = {},
): Promise<{ hash: Hex; status: "success" | "reverted" | "rejected" | null }> {
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
  if (!(await broadcast(deps, signed.hash, signed.raw))) return { hash: signed.hash, status: "rejected" };
  return { hash: signed.hash, status: await deps.chain.waitForReceipt(signed.hash) };
}

/** success and reverted were mined; failed never was (refused, or dropped). */
export type TxOutcome = "success" | "reverted" | "failed";

/** What an event says about a settled transaction: its hash once mined, else why it never was. */
function outcomeData(hash: string, status: TxOutcome, detail: string | undefined) {
  if (status === "failed") return { detail: detail ?? "dropped" };
  return status === "reverted" ? { txHash: hash, detail: "reverted" } : { txHash: hash };
}

/** Settles a swap's transaction, trade, intent and event in one database transaction; Textile is told after it commits. */
export async function settleSwap(
  deps: Pick<ExecutorDeps, "db" | "now" | "rfq">,
  userId: string,
  hash: string,
  status: TxOutcome,
  detail?: string,
): Promise<void> {
  const now = deps.now();
  const trade = await deps.db.transaction(async (db) => {
    await settleTreasuryTx(db, hash, status, now);
    const trade = await tradeBySwapHash(db, hash);
    if (!trade) return null;
    const intent = trade.intentId ? await intentById(db, trade.intentId) : null;
    const data = {
      from: trade.sellAsset,
      to: trade.buyAsset,
      amount: trade.sellAmount,
      buyAmount: trade.buyAmount,
      slippageBps: trade.slippageBps,
      reason: intent?.reason ?? null,
      ...outcomeData(hash, status, detail),
    };
    if (status === "success") {
      await updateTrade(db, trade.id, { status: "filled", filledAt: now });
      if (intent) await updateIntent(db, intent.id, { status: "filled" }, now);
      await logEvent(db, userId, "converted", data, now);
    } else {
      await updateTrade(db, trade.id, { status: "failed", detail: data.detail });
      if (intent?.status === "executing") await updateIntent(db, intent.id, { status: "waiting" }, now);
      await logEvent(db, userId, "swap_failed", data, now);
    }
    return trade;
  });
  if (status === "success" && trade?.rfqId && trade.claimToken) {
    await deps.rfq
      .submit(trade.rfqId, trade.claimToken, hash as Hex)
      .catch((error) => console.error(`Textile submit ${trade.rfqId} failed:`, error));
  }
}

/** Settles a withdrawal's transaction and its event together. */
export async function settleWithdrawal(
  deps: Pick<ExecutorDeps, "db" | "now">,
  tx: Pick<TreasuryTxRow, "userId" | "hash" | "asset" | "amountAtomic" | "toLabel">,
  status: TxOutcome,
  detail?: string,
): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (db) => {
    await settleTreasuryTx(db, tx.hash, status, now);
    await logEvent(
      db,
      tx.userId,
      status === "success" ? "withdrawn" : "withdraw_failed",
      { asset: tx.asset, amount: tx.amountAtomic, toLabel: tx.toLabel ?? null, ...outcomeData(tx.hash, status, detail) },
      now,
    );
  });
}

async function settlePending(deps: Pick<ExecutorDeps, "db" | "now" | "rfq">, tx: TreasuryTxRow, status: TxOutcome): Promise<void> {
  if (tx.kind === "swap") return settleSwap(deps, tx.userId, tx.hash, status);
  if (tx.kind === "withdraw") return settleWithdrawal(deps, tx, status);
  const now = deps.now();
  await deps.db.transaction(async (db) => {
    await settleTreasuryTx(db, tx.hash, status, now);
    // An approval is part of a conversion; one that never landed is told as a failed conversion.
    if (status === "failed") await logEvent(db, tx.userId, "swap_failed", { detail: "approve_dropped" }, now);
  });
}

/**
 * What became of one pending transaction: mined (its receipt), dropped ("failed"), or still unknown
 * (null, after re-sending the identical stored bytes).
 */
async function pendingOutcome(
  deps: Pick<ExecutorDeps, "now" | "chain">,
  address: Address,
  tx: TreasuryTxRow,
): Promise<TxOutcome | null> {
  const hash = tx.hash as Hex;
  const status = await deps.chain.receipt(hash);
  if (status) return status;
  if ((await deps.chain.confirmedNonce(address)) > tx.nonce) {
    // Mined between the two reads, or replaced. RPC backends can disagree for a moment, so one the
    // node still knows stays pending this run rather than being called dropped.
    const again = await deps.chain.receipt(hash);
    if (again) return again;
    return (await deps.chain.knownTx(hash)) ? null : "failed";
  }
  try {
    await deps.chain.sendRaw(tx.raw as Hex);
    return null;
  } catch (error) {
    console.error(`Re-sending ${tx.hash} failed:`, error);
  }
  // Neither accepted again nor known: after a grace period it will never land, and it would block
  // the wallet forever.
  if (deps.now().getTime() - tx.createdAt.getTime() <= DROP_AFTER_MS) return null;
  return (await deps.chain.knownTx(hash)) ? null : "failed";
}

/**
 * Spec §10.4 step 7: settle every pending transaction by its receipt. One with no receipt whose
 * nonce a later transaction already used can never land and counts as dropped; otherwise the
 * identical signed bytes are sent again, until the node has neither accepted nor known them for
 * DROP_AFTER_MS. Callers hold the wallet lock.
 */
export async function reconcilePending(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "rfq">,
  ctx: Pick<TreasuryContext, "userId" | "address">,
): Promise<{ settled: number; stillPending: number }> {
  const counts = { settled: 0, stillPending: 0 };
  for (const tx of await pendingTreasuryTxs(deps.db, ctx.userId)) {
    const status = await pendingOutcome(deps, ctx.address, tx);
    if (status === null) {
      counts.stillPending += 1;
      continue;
    }
    await settlePending(deps, tx, status);
    counts.settled += 1;
  }
  return counts;
}

/**
 * Settles every wallet's pending transactions whatever the switches say: a paused agent or the
 * global switch off must not strand a withdrawal, or a swap Textile was never told about. Signs and
 * trades nothing (receipts, the stored bytes re-sent, settlement). A wallet another run holds is
 * left to that run.
 */
export async function reconcileWallets(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "rfq">,
): Promise<{ settled: number; stillPending: number; errors: number }> {
  const totals = { settled: 0, stillPending: 0, errors: 0 };
  for (const userId of await usersWithPendingTxs(deps.db)) {
    try {
      const ctx = await loadTreasuryContext(deps.db, userId);
      if (!ctx) continue;
      const holder = crypto.randomUUID();
      if (!(await acquireWalletLock(deps.db, ctx.walletId, holder, deps.now()))) continue;
      try {
        const { settled, stillPending } = await reconcilePending(deps, ctx);
        totals.settled += settled;
        totals.stillPending += stillPending;
      } finally {
        await releaseWalletLock(deps.db, ctx.walletId, holder);
      }
    } catch (error) {
      console.error(`Reconciling the treasury of ${userId} failed:`, error);
      totals.errors += 1;
    }
  }
  return totals;
}

/**
 * Runs wallets with at most `concurrency` at once (default 1); a failure never stops the others.
 * No new wallet starts after `deadline`. Results come in completion order.
 */
export async function runTreasuries(
  userIds: string[],
  run: (userId: string) => Promise<RunResult>,
  opts: { deadline?: number; now?: () => number; concurrency?: number } = {},
): Promise<RunResult[]> {
  const now = opts.now ?? Date.now;
  const queue = [...userIds];
  const results: RunResult[] = [];
  const worker = async () => {
    while (queue.length > 0) {
      if (opts.deadline !== undefined && now() > opts.deadline) return;
      const userId = queue.shift()!;
      try {
        results.push(await run(userId));
      } catch (error) {
        console.error(`Treasury run for ${userId} failed:`, error);
        results.push({ userId, outcome: "failed", detail: messageOf(error) });
      }
    }
  };
  const workers = Math.min(Math.max(1, opts.concurrency ?? 1), queue.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export function summarizeRuns(results: RunResult[]): Partial<Record<RunOutcome, number>> {
  const summary: Partial<Record<RunOutcome, number>> = {};
  for (const { outcome } of results) summary[outcome] = (summary[outcome] ?? 0) + 1;
  return summary;
}
