// src/lib/treasury/chat-swap.ts
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { safeErrorTag } from "@/lib/addresses/safe-error";
import { TOKENS } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { fxTrades } from "@/lib/db/schema";
import type { FirmQuote, TextileRfqClient } from "@/lib/fx/rfq";
import type { PayAsset } from "@/lib/money/currencies";
import { chatAvailable, dailyLeftWad, fitChatAmount, isDirectPair, swapWouldBeUndone } from "./chat-rules";
import { MIN_NOTIONAL_WAD, slippageBps } from "./engine";
import {
  engineRules,
  ensureFeeToken,
  executeQuote,
  quoteMatches,
  reconcilePending,
  refuseQuote,
  rejectOffPolicy,
  requestQuote,
  type ExecutorDeps,
  type QuoteRun,
  type RunResult,
} from "./executor";
import {
  acquireWalletLock,
  cancelOpenIntent,
  chatCardEvent,
  filledUsdWad24h,
  hasPendingApproval,
  holdsWalletLock,
  liveCardLockHolder,
  insertTrade,
  loadTreasuryContext,
  logEvent,
  nextDailyCapacityAt,
  openProposal,
  releaseWalletLock,
  setAutoConvertOff,
  tradeByChatCard,
  walletLockHolder,
  type TreasuryContext,
} from "./repo";
import { usdWad } from "./value";

export type ChatSwapError =
  | "paused"
  | "disabled"
  | "dry_run"
  | "not_ready"
  | "unsupported_pair"
  | "below_minimum"
  | "insufficient"
  | "daily_limit"
  | "busy"
  | "needs_gas"
  | "no_quote"
  | "price"
  | "expired"
  | "changed"
  | "policy"
  | "swap_failed"
  | "unconfirmed";

export interface SwapCard {
  cardId: string;
  from: PayAsset;
  to: PayAsset;
  amountAtomic: string;
  buyAtomic: string;
  limited: "daily" | "balance" | null;
  turnsOff: boolean;
  losesProposal: boolean;
  nextDailyAt: string | null;
}

export type ChatPreviewDeps = Pick<ExecutorDeps, "db" | "now" | "chain" | "rates"> & { preview: TextileRfqClient["preview"] };

export type ChatSwapStatus =
  | { state: "running"; stage: "price" | "preparing" | "swapping" }
  | { state: "confirming" }
  | { state: "success"; soldAtomic: string; boughtAtomic: string; from: PayAsset; to: PayAsset; txHash: string; turnedOff: boolean }
  | { state: "refused"; error: ChatSwapError }
  | { state: "unknown" };

export interface ChatSwapInput {
  from: PayAsset;
  to: PayAsset;
  amount: bigint;
  cardId: string;
  seenTurnsOff: boolean;
}

/** Lowercase, as crypto.randomUUID writes it: the card id is compared as text in event data, and reaches uuid columns. */
export const CARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The reference rates, or null when they cannot be read, for the caller to answer no_quote. Only a tag is logged. */
function ratesOrNull(deps: Pick<ExecutorDeps, "rates">, userId: string) {
  return deps.rates().catch((error) => {
    console.error(`Reference rates for ${userId} failed:`, safeErrorTag(error));
    return null;
  });
}

export interface PreviewRefusal {
  refused: ChatSwapError;
  availableSellAtomic: string | null;
  nextDailyAt: string | null;
  /** Set on "insufficient" when what is available is worth under the minimum swap: adding funds is the only next step. */
  balanceBelowMinimum?: true;
}

/** Spec §5: the card, from Textile's unlocked estimate. It only reads; the tap checks everything again. */
export async function previewChatSwap(
  deps: ChatPreviewDeps,
  userId: string,
  input: { from: PayAsset; to: PayAsset; wanted: bigint | null },
): Promise<SwapCard | PreviewRefusal> {
  const { from, to, wanted } = input;
  const refused = (error: ChatSwapError, more: Partial<Omit<PreviewRefusal, "refused">> = {}): PreviewRefusal => ({
    refused: error,
    availableSellAtomic: null,
    nextDailyAt: null,
    ...more,
  });
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx) return refused("not_ready");
  if (!ctx.rules.enabled) return refused("paused");
  if (!isDirectPair(from, to)) return refused("unsupported_pair");

  const balances = await deps.chain.readBalances(ctx.address);
  const rates = await ratesOrNull(deps, userId);
  if (!rates) return refused("no_quote");
  const now = deps.now();
  const nextDailyAt = async () => (await nextDailyCapacityAt(deps.db, userId, now))?.toISOString() ?? null;
  const available = chatAvailable(from, balances);
  const fit = fitChatAmount({
    from,
    wanted,
    available,
    dailyLeft: dailyLeftWad(ctx.rules.dailyMaxUsd, await filledUsdWad24h(deps.db, userId, now)),
    rates,
  });
  if ("refused" in fit) {
    if (fit.refused === "daily_limit") return refused("daily_limit", { nextDailyAt: await nextDailyAt() });
    if (fit.refused === "insufficient" && usdWad(from, available, rates) < MIN_NOTIONAL_WAD) return refused("insufficient", { balanceBelowMinimum: true });
    return refused(fit.refused);
  }

  const estimate = await deps
    .preview({ sellToken: TOKENS[from].address, buyToken: TOKENS[to].address, sellAmount: fit.amount, taker: ctx.address })
    .catch((error) => {
      console.error(`Textile preview for ${userId} failed:`, safeErrorTag(error));
      return null;
    });
  if (!estimate) return refused("no_quote");
  if (estimate.status === "no_quote") return refused("no_quote", { availableSellAtomic: estimate.availableSellAmount?.toString() ?? null });

  const turnsOff =
    !ctx.rules.autoPausedAt &&
    swapWouldBeUndone({ balances, rules: engineRules(ctx.rules), rates, from, to, sold: estimate.takerPays, bought: estimate.buyAmount });
  return {
    cardId: crypto.randomUUID(),
    from,
    to,
    amountAtomic: fit.amount.toString(),
    buyAtomic: estimate.buyAmount.toString(),
    limited: fit.limited,
    turnsOff,
    losesProposal: turnsOff && (await openProposal(deps.db, userId)) !== null,
    nextDailyAt: fit.limited === "daily" ? await nextDailyAt() : null,
  };
}

/** One tap on a card. `quote` is set once Textile holds a firm quote for it. */
interface Tap {
  deps: ExecutorDeps;
  userId: string;
  input: ChatSwapInput;
  quote: FirmQuote | null;
}

/**
 * Spec §5: the freelancer's tap on a card, from the checks to the swap, in the shape of withdraw(). It never
 * throws; the outcome goes to the database, where chatSwapStatus reads it. The card id is the lock's holder, so
 * status can read the lock, and a card that has a trade or a refusal never trades again.
 */
export async function chatSwap(deps: ExecutorDeps, userId: string, input: ChatSwapInput): Promise<void> {
  // A crafted value must not reach Postgres as a uuid. There is no card to record a refusal against.
  if (!CARD_ID.test(input.cardId)) {
    console.error(`Chat swap for ${userId} ignored: the card id is not a uuid`);
    return;
  }
  const tap: Tap = { deps, userId, input, quote: null };
  try {
    await startSwap(tap);
  } catch (error) {
    // Failed before this tap took the lock (startSwap catches everything after), so it holds no quote and stored no swap.
    console.error(`Chat swap for ${userId} failed before the lock:`, safeErrorTag(error));
    await refuseUnlessEnded(tap, "unconfirmed").catch((second) =>
      console.error(`Recording the end of a chat swap for ${userId} failed:`, safeErrorTag(second)),
    );
  }
}

async function startSwap(tap: Tap): Promise<void> {
  const { deps, userId, input } = tap;
  const off = !deps.flags.enabled ? "disabled" : deps.flags.dryRun ? "dry_run" : null;
  if (off) return refuseUnlessEnded(tap, off);
  const first = await loadTreasuryContext(deps.db, userId);
  if (!first) return refuseUnlessEnded(tap, "not_ready");
  if (!first.rules.enabled) return refuseUnlessEnded(tap, "paused");
  if (!(await acquireWalletLock(deps.db, first.walletId, input.cardId, deps.now()))) {
    // Held by this same card: a double tap while the first run trades. That run reports the outcome.
    if ((await walletLockHolder(deps.db, first.walletId)) !== input.cardId) await refuseUnlessEnded(tap, "busy");
    return;
  }
  try {
    if (await cardEnded(tap)) return;
    // Read again now the lock is held: Paused, the limits and auto-convert may have changed since the read above.
    const ctx = await loadTreasuryContext(deps.db, userId);
    const error = !ctx ? "not_ready" : !ctx.rules.enabled ? "paused" : await swapLocked(tap, ctx);
    if (error) await refuse(tap, error);
  } catch (error) {
    // This run holds the lock, so it must answer, and before the release: status never sees the lock gone with no answer yet.
    await endUnconfirmed(tap, error);
  } finally {
    await releaseWalletLock(deps.db, first.walletId, input.cardId).catch((error) =>
      console.error(`Releasing the wallet lock of ${userId} failed:`, safeErrorTag(error)),
    );
  }
}

/** The steps in the lock, in the order of spec §5. Returns what to refuse with, or null when no refusal is due. */
async function swapLocked(tap: Tap, ctx: TreasuryContext): Promise<ChatSwapError | null> {
  const { deps, userId } = tap;
  const { from, to, amount, cardId, seenTurnsOff } = tap.input;
  if ((await reconcilePending(deps, ctx)).stillPending > 0) return "busy";
  if (!isDirectPair(from, to)) return "unsupported_pair";

  const read = await deps.chain.readBalances(ctx.address);
  if (amount > chatAvailable(from, read)) return "insufficient";
  const rates = await ratesOrNull(deps, userId);
  if (!rates) return "no_quote";
  const usd = usdWad(from, amount, rates);
  if (usd < MIN_NOTIONAL_WAD) return "below_minimum";
  const dailyLeft = dailyLeftWad(ctx.rules.dailyMaxUsd, await filledUsdWad24h(deps.db, userId, deps.now()));
  // A card lowered to the limit sits exactly on it, so a small rate move lands here. With a swap still possible, the
  // retry's card fits what is left at today's rate.
  if (usd > dailyLeft) return dailyLeft >= MIN_NOTIONAL_WAD ? "changed" : "daily_limit";
  const { feeToken, balances } = await ensureFeeToken(deps, ctx, read, { asset: from, amount });
  if (!feeToken) return "needs_gas";

  const signer = deps.signer(ctx);
  const outcome = await requestQuote(deps, ctx, signer, { from, to, amount });
  if (outcome.status === "no_quote") {
    await insertTrade(deps.db, {
      userId,
      chatCardId: cardId,
      sellAsset: from,
      buyAsset: to,
      sellAmount: amount.toString(),
      status: "no_quote",
      detail: outcome.reason,
    });
    // Spec §5.2: Textile's limit on outstanding RFQs reads as busy, because trying again shortly can work.
    return outcome.httpStatus === 429 ? "busy" : "no_quote";
  }

  const q = outcome.quote;
  tap.quote = q;
  const run: QuoteRun = {
    deps,
    ctx,
    intent: null,
    chatCardId: cardId,
    d: { kind: "convert", from, to, amount, usdWad: usd, reason: "chat" },
    q,
    signer,
    feeToken,
    rates,
    result: (runOutcome, detail) => ({ userId, outcome: runOutcome, detail }),
    attempts: 1,
    policy: { allowedSpenders: deps.allowedSpenders, personalWallet: ctx.personalWallet, withdrawalAddresses: [] },
  };
  if (!quoteMatches(q, ctx.address, amount, deps.allowedSpenders)) {
    await rejectOffPolicy(run);
    return "policy";
  }
  // No wait-then-accept-worse path: the freelancer is present and can try again.
  const slippage = slippageBps(from, q.takerPays, to, q.buyAmount, rates);
  if (slippage > ctx.rules.maxSlippageBps) {
    await refuseQuote(run, "rejected", "price", slippage);
    return "price";
  }
  // Spec §3.1, again on the firm amounts: a card that did not say so must not turn auto-convert off.
  const turnsOff =
    !ctx.rules.autoPausedAt &&
    swapWouldBeUndone({ balances, rules: engineRules(ctx.rules), rates, from, to, sold: q.takerPays, bought: q.buyAmount });
  if (turnsOff && !seenTurnsOff) {
    await refuseQuote(run, "rejected", "changed", slippage);
    return "changed";
  }
  if (turnsOff) {
    run.beforeBroadcast = async (tx) => {
      await setAutoConvertOff(tx, userId, deps.now());
      await cancelOpenIntent(tx, userId, deps.now());
      await logEvent(tx, userId, "auto_convert_off", { cardId }, deps.now());
    };
  }
  return errorOf(await executeQuote(run, slippage));
}

function errorOf({ outcome, detail }: RunResult): ChatSwapError | null {
  if (outcome === "converted") return null;
  // A swap with no receipt yet is settled by reconciliation; status reads it from the trade.
  if (outcome === "pending_tx") return detail === "swap" ? null : "busy";
  if (outcome === "expired") return "expired";
  // A failed swap or approval: the executor's swap_failed event already says so, and "a swap wasn't sent" would be
  // untrue for a reverted one. Status reads swap_failed from the trade.
  return null;
}

function refuse({ deps, userId, input }: Tap, error: ChatSwapError): Promise<void> {
  const { cardId, from, to, amount } = input;
  return logEvent(deps.db, userId, "chat_swap_refused", { cardId, error, from, to, amount: amount.toString() }, deps.now());
}

/** Whether this card already has its answer: one card, at most one swap and no second try. */
async function cardEnded({ deps, userId, input }: Tap): Promise<boolean> {
  return (
    (await tradeByChatCard(deps.db, userId, input.cardId)) !== null ||
    (await chatCardEvent(deps.db, userId, "chat_swap_refused", input.cardId)) !== null
  );
}

/**
 * For a tap that does not hold the lock. If this card's own run holds it, that run may still swap and will report the
 * outcome: a refusal here would make status say nothing was sent while money moves. A replayed card that already
 * ended must not add "a swap wasn't sent" to its history either.
 */
async function refuseUnlessEnded(tap: Tap, error: ChatSwapError): Promise<void> {
  const { deps, userId, input } = tap;
  if (await holdsWalletLock(deps.db, userId, input.cardId, deps.now())) return;
  if (!(await cardEnded(tap))) await refuse(tap, error);
}

/**
 * Signing, the RPC or the database failed. With the swap stored, it may still land: the quote stays, and no refusal
 * is logged, because "a swap wasn't sent" could sit in History beside a swap that fills. Status reads `confirming`
 * from the trade and reconciliation settles it. With no swap stored, nothing can land, so Textile is told. Only a
 * tag is logged: a failed insert's message carries its parameters.
 */
async function endUnconfirmed(tap: Tap, error: unknown): Promise<void> {
  const { deps, userId, quote } = tap;
  console.error(`Chat swap for ${userId} ended with an error:`, safeErrorTag(error));
  try {
    const trade = await tradeByChatCard(deps.db, userId, tap.input.cardId);
    if (trade?.swapTxHash) return;
    if (quote && !trade) {
      await deps.rfq
        .cancel(quote.rfqId, quote.claimToken)
        .catch((cancelError) => console.error(`Textile cancel ${quote.rfqId} failed:`, safeErrorTag(cancelError)));
    }
    await refuse(tap, "unconfirmed");
  } catch (second) {
    console.error(`Recording the end of a chat swap for ${userId} failed:`, safeErrorTag(second));
  }
}

/** An approval that was mined and reverted, or refused by the node. One with no receipt ("approve_pending") reads as busy. */
const FAILED_APPROVALS = ["approve_reverted", "approve_rejected"];

/** Spec §5.1: what a card's swap is doing, from Postgres alone, so a reload never loses it. */
export async function chatSwapStatus(db: Db, userId: string, cardId: string, now: Date): Promise<ChatSwapStatus> {
  if (!CARD_ID.test(cardId)) return { state: "unknown" };
  const trade = await tradeByChatCard(db, userId, cardId);
  if (trade?.status === "filled" && trade.buyAmount && trade.swapTxHash) {
    return {
      state: "success",
      soldAtomic: trade.sellAmount,
      boughtAtomic: trade.buyAmount,
      from: trade.sellAsset,
      to: trade.buyAsset,
      txHash: trade.swapTxHash,
      turnedOff: (await chatCardEvent(db, userId, "auto_convert_off", cardId)) !== null,
    };
  }
  const locked = () => holdsWalletLock(db, userId, cardId, now);
  if (trade?.status === "broadcast") return (await locked()) ? { state: "running", stage: "swapping" } : { state: "confirming" };
  if (trade?.status === "failed" || (trade?.status === "rejected" && trade.detail && FAILED_APPROVALS.includes(trade.detail))) {
    return { state: "refused", error: "swap_failed" };
  }
  const refusal = await chatCardEvent(db, userId, "chat_swap_refused", cardId);
  if (refusal) return { state: "refused", error: refusal.data.error as ChatSwapError };
  if (await locked()) return { state: "running", stage: (await hasPendingApproval(db, userId)) ? "preparing" : "price" };
  return { state: "unknown" };
}

/**
 * The card of a chat swap in progress, so the page can pick it up after a reload on any browser (spec §5.1): one
 * waiting for its receipt, or one still running under the wallet lock before it is broadcast. A lock held by the automatic agent
 * or a withdrawal (not a card id) or an expired lock names nothing.
 */
export async function activeChatCardId(db: Db, userId: string, now: Date = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ cardId: fxTrades.chatCardId })
    .from(fxTrades)
    .where(and(eq(fxTrades.userId, userId), eq(fxTrades.status, "broadcast"), isNotNull(fxTrades.chatCardId)))
    .orderBy(desc(fxTrades.createdAt))
    .limit(1);
  if (row?.cardId) return row.cardId;
  const holder = await liveCardLockHolder(db, userId, now);
  // A card that has ended (filled, failed, refused) can hold the lock a little longer, for example while Textile is told
  // of the fill. Naming it would show its result a second time after a refresh, so only a card still running counts.
  return holder && (await chatSwapStatus(db, userId, holder, now)).state === "running" ? holder : null;
}
