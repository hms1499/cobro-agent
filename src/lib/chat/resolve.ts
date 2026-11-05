// src/lib/chat/resolve.ts
import { TOKENS } from "@/lib/chain/tokens";
import type { ReferenceRates } from "@/lib/fx/rates";
import { PAY_ASSETS, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal } from "@/lib/money/decimal";
import { parseFiatInput } from "@/lib/money/input";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import { chatAvailable, isDirectPair } from "@/lib/treasury/chat-rules";
import { MIN_NOTIONAL_WAD } from "@/lib/treasury/engine";
import { usdWad } from "@/lib/treasury/value";
import type { ChatCommand } from "./parse";

export type ResolvedCommand =
  | { kind: "card"; from: PayAsset; to: PayAsset; wanted: bigint | null }
  | { kind: "choose"; to: PayAsset; wanted: string | null; options: { from: PayAsset; atomic: string }[] }
  | { kind: "two_step"; from: PayAsset; to: PayAsset; wanted: string | null }
  | { kind: "nothing_to_swap"; to: PayAsset }
  | { kind: "already_dollars" }
  /** Holds pesos or reais, but each is worth under the minimum swap: not "already in dollars", and no card. */
  | { kind: "save_below_minimum" }
  | { kind: "same_token" }
  | { kind: "bad_amount" }
  | { kind: "balances" }
  | { kind: "help" };

type Ctx = { balances: TreasuryBalances; rates: ReferenceRates };

/** What chat may sell of `asset`, or 0n when it is worth under US$1 (not a candidate). */
function candidateAtomic(asset: PayAsset, { balances, rates }: Ctx): bigint {
  const atomic = chatAvailable(asset, balances);
  return atomic > 0n && usdWad(asset, atomic, rates) >= MIN_NOTIONAL_WAD ? atomic : 0n;
}

/** Validates a typed amount: null when none was given, undefined when it cannot be read. */
function readAmount(amount: string | null): string | null | undefined {
  if (amount === null) return null;
  const parsed = parseFiatInput(amount);
  return parsed.ok ? parsed.value : undefined;
}

function resolveSwap(command: Extract<ChatCommand, { kind: "swap" }>, ctx: Ctx): ResolvedCommand {
  const { from, to } = command;
  const value = readAmount(command.amount);
  if (value === undefined) return { kind: "bad_amount" };

  if (from) {
    if (from === to) return { kind: "same_token" };
    if (!isDirectPair(from, to)) return { kind: "two_step", from, to, wanted: command.amount };
    return { kind: "card", from, to, wanted: value === null ? null : parseDecimal(value, TOKENS[from].decimals) };
  }

  const candidates = PAY_ASSETS.filter((a) => a !== to && isDirectPair(a, to))
    .map((a) => ({ from: a, atomic: candidateAtomic(a, ctx) }))
    .filter((c) => c.atomic > 0n);
  const [only] = candidates;
  if (!only) return { kind: "nothing_to_swap", to };
  if (candidates.length === 1) {
    return {
      kind: "card",
      from: only.from,
      to,
      wanted: value === null ? null : parseDecimal(value, TOKENS[only.from].decimals),
    };
  }
  return {
    kind: "choose",
    to,
    wanted: command.amount,
    options: candidates.map((c) => ({ from: c.from, atomic: c.atomic.toString() })),
  };
}

/** Turns a command into what the chat does next, from balances and rates alone. */
export function resolveCommand(command: ChatCommand, ctx: Ctx): ResolvedCommand {
  switch (command.kind) {
    case "swap":
      return resolveSwap(command, ctx);
    case "save_in_dollars": {
      const local = ["WARS", "WBRL"] as const;
      const from = local.find((a) => candidateAtomic(a, ctx) > 0n);
      if (from) return { kind: "card", from, to: "USDT", wanted: null };
      return local.some((a) => chatAvailable(a, ctx.balances) > 0n) ? { kind: "save_below_minimum" } : { kind: "already_dollars" };
    }
    case "balance":
      return { kind: "balances" };
    case "unknown":
      return { kind: "help" };
  }
}
