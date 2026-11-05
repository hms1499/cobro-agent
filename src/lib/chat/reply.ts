import { safeErrorTag } from "@/lib/addresses/safe-error";
import { TOKENS } from "@/lib/chain/tokens";
import type { ReferenceRates } from "@/lib/fx/rates";
import { isPayAsset, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal } from "@/lib/money/decimal";
import { parseFiatInput } from "@/lib/money/input";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import type { ChatSwapError, PreviewRefusal, SwapCard } from "@/lib/treasury/chat-swap";
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
      /** The pair and amount to retry with. Null when a swap ended after a reload, with no card: no card retry then. */
      from: PayAsset | null;
      to: PayAsset | null;
      wantedAtomic: string | null;
      /** What the freelancer has, for "not enough balance" (spec §5.2). Screen amounts, not token units. */
      balances?: Record<PayAsset, string>;
      /** "Not enough" with what is available worth under the minimum swap: "use full balance" would only be refused again. Unset on tap-time refusals. */
      balanceBelowMinimum?: true;
    }
  | { kind: "choose"; to: PayAsset; wanted: string | null; options: { from: PayAsset; atomic: string }[] }
  | { kind: "two_step"; from: PayAsset; to: PayAsset; wanted: string | null }
  | { kind: "nothing_to_swap"; to: PayAsset; balances: Record<PayAsset, string> }
  | { kind: "already_dollars" }
  | { kind: "save_below_minimum"; balances: Record<PayAsset, string> }
  | { kind: "same_token" }
  | { kind: "bad_amount" }
  | { kind: "balances"; balances: Record<PayAsset, string> }
  | { kind: "help" }
  | { kind: "paused" }
  /** A read failed on a message with no whole pair: nothing to retry and nothing known about the market. It carries no detail on purpose. */
  | { kind: "read_failed" };

type Preview = { from: PayAsset; to: PayAsset; wanted: bigint | null };
type PreviewResult = SwapCard | PreviewRefusal;

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

/**
 * A read that failed must not reach the client as an exception. Only a tag is logged, never a message. With a whole
 * pair the reply is no_quote and its retry; without one, "nobody can fill this amount" would be untrue.
 */
function failed({ from, to }: { from: PayAsset | null; to: PayAsset | null }, wanted: bigint | null, error: unknown): ChatReply {
  console.error("Chat reply read failed:", safeErrorTag(error));
  if (!from || !to) return { kind: "read_failed" };
  return {
    kind: "refused",
    error: "no_quote",
    availableSellAtomic: null,
    nextDailyAt: null,
    from,
    to,
    wantedAtomic: wanted === null ? null : wanted.toString(),
  };
}

/** The typed amount of a command, for a retry, when the source token is known and the text reads. */
function typedWanted(command: ChatCommand): bigint | null {
  if (command.kind !== "swap" || !command.from || command.amount === null) return null;
  const parsed = parseFiatInput(command.amount);
  return parsed.ok ? parseDecimal(parsed.value, TOKENS[command.from].decimals) : null;
}

async function previewReply(io: ReplyIo, input: Preview): Promise<ChatReply> {
  const result = await io.preview(input);
  if ("refused" in result) {
    // The balance is a courtesy: a failed read must not hide the refusal.
    const balances = result.refused === "insufficient" ? await io.displayBalances().catch(() => undefined) : undefined;
    return {
      ...(balances ? { balances } : {}),
      ...(result.balanceBelowMinimum ? { balanceBelowMinimum: true as const } : {}),
      kind: "refused",
      error: result.refused,
      availableSellAtomic: result.availableSellAtomic,
      nextDailyAt: result.nextDailyAt,
      from: input.from,
      to: input.to,
      wantedAtomic: input.wanted === null ? null : input.wanted.toString(),
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
      case "save_below_minimum":
        return { kind: "save_below_minimum", balances: await io.displayBalances() };
      default:
        return resolved;
    }
  } catch (error) {
    const pair = command.kind === "swap" ? { from: command.from, to: command.to } : { from: null, to: null };
    return failed(pair, typedWanted(command), error);
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
    return failed({ from, to }, wanted, error);
  }
}
