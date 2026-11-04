"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { interpretWithGroq } from "@/lib/chat/groq";
import { chatGate, startChatSwapRequest } from "@/lib/chat/gate";
import { allowGroqCall } from "@/lib/chat/rate-limit";
import { cardReply, chatReply, type CardRequest, type ChatReply, type ReplyIo } from "@/lib/chat/reply";
import { parseServerEnv } from "@/lib/config/server";
import { isPayAsset, PAY_ASSETS, type PayAsset } from "@/lib/money/currencies";
import { CARD_ID, chatSwap, chatSwapStatus, previewChatSwap, type ChatSwapError, type ChatSwapStatus } from "@/lib/treasury/chat-swap";
import { liveChatDeps, liveExecutorDeps, readDisplayBalances } from "@/lib/treasury/live";
import { tokenFiatAmount } from "@/lib/treasury/value";
import type { Address } from "viem";

/** Balances as screens show them: a fiat amount per pay asset, never token units. */
async function displayed(address: Address): Promise<Record<PayAsset, string>> {
  const balances = await readDisplayBalances(address);
  return Object.fromEntries(PAY_ASSETS.map((a) => [a, tokenFiatAmount(a, balances[a]).amount])) as Record<PayAsset, string>;
}

function replyIo(userId: string, address: Address, text: string | null): ReplyIo {
  const deps = liveChatDeps();
  return {
    balances: () => deps.chain.readBalances(address),
    rates: async () => {
      const rates = await deps.rates();
      if (!rates) throw new Error("no rates");
      return rates;
    },
    displayBalances: () => displayed(address),
    preview: (input) => previewChatSwap(deps, userId, input),
    interpret: async () => {
      // Only the current message goes out, and only with a key and inside the per-user limit.
      const apiKey = parseServerEnv().GROQ_API_KEY;
      if (!text || !apiKey || !allowGroqCall(userId, Date.now())) return null;
      return interpretWithGroq(text, { apiKey });
    },
  };
}

/** Spec §4: one chat message in, one reply out. The reply is data; the screen renders it through t(). */
export async function sendChatMessage(text: string): Promise<ChatReply> {
  const user = await requireUser();
  if (typeof text !== "string") return { kind: "help" };
  const open = await chatGate(liveChatDeps(), user.id);
  if ("reply" in open) return open.reply;
  return chatReply(text, replyIo(user.id, open.address, text));
}

/** A card asked for by a tap (a choice, an edited amount, "Try again"): always a new card id. */
export async function previewCardAction(input: CardRequest): Promise<ChatReply> {
  const user = await requireUser();
  if (!input || !isPayAsset(input.from) || !isPayAsset(input.to)) return { kind: "help" };
  const open = await chatGate(liveChatDeps(), user.id);
  if ("reply" in open) return open.reply;
  return cardReply(
    { from: input.from, to: input.to, amountText: input.amountText ?? null, wantedAtomic: input.wantedAtomic ?? null },
    replyIo(user.id, open.address, null),
  );
}

/**
 * Spec §5: the tap. It answers at once and does the swap in after(), so a closed tab cannot lose the outcome; the page
 * reads it with readChatSwap. Only the tap refuses in dry run (spec §3.3).
 */
export async function startChatSwap(input: {
  from: PayAsset;
  to: PayAsset;
  amountAtomic: string;
  cardId: string;
  seenTurnsOff: boolean;
}): Promise<{ started: boolean; error?: ChatSwapError }> {
  const user = await requireUser();
  const deps = liveExecutorDeps();
  return startChatSwapRequest(deps, user.id, input, (parsed) => after(() => chatSwap(deps, user.id, parsed)));
}

/** Spec §5.1: where a card's swap stands, from Postgres. Another user's card id reads as unknown. */
export async function readChatSwap(cardId: string): Promise<ChatSwapStatus & { balances?: Record<PayAsset, string> }> {
  const user = await requireUser();
  if (typeof cardId !== "string" || !CARD_ID.test(cardId)) return { state: "unknown" };
  const status = await chatSwapStatus(liveChatDeps().db, user.id, cardId, new Date());
  const wantsBalances = status.state === "success" || (status.state === "refused" && status.error === "insufficient");
  if (!wantsBalances || !user.treasuryAddress) return status;
  // The balances are a courtesy: a failed read must not hide the outcome.
  const balances = await displayed(user.treasuryAddress as Address).catch(() => null);
  return balances ? { ...status, balances } : status;
}
