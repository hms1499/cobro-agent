import { safeErrorTag } from "@/lib/addresses/safe-error";
import { TOKENS } from "@/lib/chain/tokens";
import type { ReferenceRates } from "@/lib/fx/rates";
import { isPayAsset, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal } from "@/lib/money/decimal";
import { parseFiatInput } from "@/lib/money/input";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import type { ChatSwapError, SwapCard } from "@/lib/treasury/chat-swap";
import { parseCommand, type ChatCommand } from "./parse";
import { resolveCommand } from "./resolve";

/** Spec §4.1: a longer message is refused before any parser or LLM sees it. */
export const MAX_CHAT_TEXT = 200;

export type ChatReply =
  | { kind: "card"; card: SwapCard }
  | {
      kind: "refused";
      error: ChatSwapError;
      availableSellAtomic: string | null;
      nextDailyAt: string | null;
      from: PayAsset;
      to: PayAsset;
    }
  | { kind: "choose"; to: PayAsset; wanted: string | null; options: { from: PayAsset; atomic: string }[] }
  | { kind: "two_step"; from: PayAsset; to: PayAsset }
  | { kind: "nothing_to_swap"; to: PayAsset; balances: Record<PayAsset, string> }
  | { kind: "already_dollars" }
  | { kind: "same_token" }
  | { kind: "bad_amount" }
  | { kind: "balances"; balances: Record<PayAsset, string> }
  | { kind: "help" }
  | { kind: "paused" };

type Preview = { from: PayAsset; to: PayAsset; wanted: bigint | null };
type PreviewResult = SwapCard | { refused: ChatSwapError; availableSellAtomic: string | null; nextDailyAt: string | null };

/** What a reply needs from the outside, so the logic runs without a database, a chain or a network. */
export interface ReplyIo {
  /** Primary RPC, the same source the card is built from. */
  balances(): Promise<TreasuryBalances>;
  rates(): Promise<ReferenceRates>;
  /** Balances as screens show them (fiat amount text per pay asset). */
  displayBalances(): Promise<Record<PayAsset, string>>;
  preview(input: Preview): Promise<PreviewResult>;
  /** Called only for a message the rule parser did not understand; already gated by key and rate limit. */
  interpret(text: string): Promise<ChatCommand | null>;
}

/** A read that failed must not reach the client as an exception. Only a tag is logged, never a message. */
function failed(from: PayAsset, to: PayAsset, error: unknown): ChatReply {
  console.error("Chat reply read failed:", safeErrorTag(error));
  return { kind: "refused", error: "no_quote", availableSellAtomic: null, nextDailyAt: null, from, to };
}

async function previewReply(io: ReplyIo, input: Preview): Promise<ChatReply> {
  const result = await io.preview(input);
  if ("refused" in result) {
    return {
      kind: "refused",
      error: result.refused,
      availableSellAtomic: result.availableSellAtomic,
      nextDailyAt: result.nextDailyAt,
      from: input.from,
      to: input.to,
    };
  }
  return { kind: "card", card: result };
}

/** Spec §4.1: the rule parser first, Groq only for what it did not understand, then the resolver and the card. */
export async function chatReply(text: string, io: ReplyIo): Promise<ChatReply> {
  if (typeof text !== "string" || text.length > MAX_CHAT_TEXT) return { kind: "help" };
  let command = parseCommand(text);
  if (command.kind === "unknown") command = (await io.interpret(text)) ?? command;
  if (command.kind === "unknown") return { kind: "help" };
  const target = command.kind === "swap" ? command.to : "USDT";
  try {
    if (command.kind === "balance") return { kind: "balances", balances: await io.displayBalances() };
    const resolved = resolveCommand(command, { balances: await io.balances(), rates: await io.rates() });
    switch (resolved.kind) {
      case "card":
        return await previewReply(io, { from: resolved.from, to: resolved.to, wanted: resolved.wanted });
      case "balances":
        return { kind: "balances", balances: await io.displayBalances() };
      case "nothing_to_swap":
        return { kind: "nothing_to_swap", to: resolved.to, balances: await io.displayBalances() };
      default:
        return resolved;
    }
  } catch (error) {
    return failed(command.kind === "swap" && command.from ? command.from : "USDT", target, error);
  }
}

const ATOMIC = /^\d{1,78}$/;

export interface CardRequest {
  from: PayAsset;
  to: PayAsset;
  amountText: string | null;
  wantedAtomic: string | null;
}

/**
 * A card asked for directly (a tap on a choice, an edited amount, "Try again"). The typed amount goes through
 * parseFiatInput into bigint; it wins over `wantedAtomic`. Always a new card id, through previewChatSwap.
 */
export async function cardReply(input: CardRequest, io: ReplyIo): Promise<ChatReply> {
  const { from, to, amountText, wantedAtomic } = input;
  if (!isPayAsset(from) || !isPayAsset(to)) return { kind: "help" };
  if (from === to) return { kind: "same_token" };
  let wanted: bigint | null = null;
  if (amountText !== null) {
    if (typeof amountText !== "string") return { kind: "bad_amount" };
    const parsed = parseFiatInput(amountText);
    if (!parsed.ok) return { kind: "bad_amount" };
    wanted = parseDecimal(parsed.value, TOKENS[from].decimals);
  } else if (wantedAtomic !== null) {
    if (typeof wantedAtomic !== "string" || !ATOMIC.test(wantedAtomic)) return { kind: "bad_amount" };
    wanted = BigInt(wantedAtomic);
  }
  try {
    return await previewReply(io, { from, to, wanted });
  } catch (error) {
    return failed(from, to, error);
  }
}
