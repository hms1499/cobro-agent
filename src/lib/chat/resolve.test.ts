import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { RATE_ONE } from "@/lib/money/decimal";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import { chatAvailable } from "@/lib/treasury/chat-rules";
import { resolveCommand } from "./resolve";

const rates: ReferenceRates = { perUsd: { ARS: 1000n * RATE_ONE, BRL: 5n * RATE_ONE }, fetchedAt: 0 };
const none: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const bal = (b: Partial<TreasuryBalances>): TreasuryBalances => ({ ...none, ...b });
const run = (command: Parameters<typeof resolveCommand>[0], b: Partial<TreasuryBalances>) =>
  resolveCommand(command, { balances: bal(b), rates });
const swapTo = (to: "USDT" | "WARS" | "WBRL" | "USAT", amount: string | null = null) =>
  ({ kind: "swap", from: null, to, amount }) as const;

describe("resolveCommand swap without a source", () => {
  it("one source held gives its card", () => {
    expect(run(swapTo("USDT"), { WARS: 5_000_000_000_000_000_000_000n })).toEqual({
      kind: "card", from: "WARS", to: "USDT", wanted: null,
    });
  });

  it("several sources give a choice with their balances", () => {
    const r = run(swapTo("USDT", "10"), { WARS: 5_000n * 10n ** 18n, USAT: 20_000_000n });
    expect(r).toEqual({
      kind: "choose",
      to: "USDT",
      wanted: "10",
      options: [
        { from: "USAT", atomic: chatAvailable("USAT", bal({ WARS: 5_000n * 10n ** 18n, USAT: 20_000_000n })).toString() },
        { from: "WARS", atomic: (5_000n * 10n ** 18n).toString() },
      ],
    });
  });

  it("nothing worth US$1 gives nothing_to_swap", () => {
    expect(run(swapTo("USDT"), { WARS: 500n * 10n ** 18n, USAT: 999_999n })).toEqual({ kind: "nothing_to_swap", to: "USDT" });
  });

  it.each(["WARS", "WBRL", "USAT"] as const)("target %s has only USDT as source", (to) => {
    expect(run(swapTo(to), { USDT: 50_000_000n })).toEqual({ kind: "card", from: "USDT", to, wanted: null });
  });

  it.each(["WARS", "WBRL", "USAT"] as const)("target %s with USDT under US$1 has nothing to swap", (to) => {
    expect(run(swapTo(to), { USDT: 999_999n })).toEqual({ kind: "nothing_to_swap", to });
  });

  it("a zero amount is bad_amount", () => {
    expect(run({ kind: "swap", from: "USDT", to: "WARS", amount: "0" }, {})).toEqual({ kind: "bad_amount" });
  });

  it("USAT may be a source when the target is USDT", () => {
    expect(run(swapTo("USDT"), { USAT: 20_000_000n })).toEqual({ kind: "card", from: "USAT", to: "USDT", wanted: null });
  });
});

describe("resolveCommand named source", () => {
  it("wARS to wBRL takes two steps", () => {
    expect(run({ kind: "swap", from: "WARS", to: "WBRL", amount: null }, {})).toEqual({ kind: "two_step", from: "WARS", to: "WBRL", wanted: null });
  });

  it("two steps keep the typed amount as raw text", () => {
    expect(run({ kind: "swap", from: "WARS", to: "WBRL", amount: "100,50" }, {})).toEqual({ kind: "two_step", from: "WARS", to: "WBRL", wanted: "100,50" });
  });

  it("two steps with an unreadable amount are bad_amount", () => {
    expect(run({ kind: "swap", from: "WARS", to: "WBRL", amount: "1.500" }, {})).toEqual({ kind: "bad_amount" });
    expect(run({ kind: "swap", from: "WARS", to: "WBRL", amount: "0" }, {})).toEqual({ kind: "bad_amount" });
  });

  it.each([
    ["USAT", "WARS"],
    ["WBRL", "USAT"],
    ["WBRL", "WARS"],
  ] as const)("%s to %s takes two steps", (from, to) => {
    expect(run({ kind: "swap", from, to, amount: null }, {})).toEqual({ kind: "two_step", from, to, wanted: null });
  });

  it("same token is refused", () => {
    expect(run({ kind: "swap", from: "USDT", to: "USDT", amount: null }, {})).toEqual({ kind: "same_token" });
  });

  it("a comma amount becomes atomic units of the source", () => {
    expect(run({ kind: "swap", from: "USDT", to: "WARS", amount: "25,50" }, {})).toEqual({
      kind: "card", from: "USDT", to: "WARS", wanted: 25_500_000n,
    });
  });

  it("an unreadable amount is bad_amount", () => {
    expect(run({ kind: "swap", from: "USDT", to: "WARS", amount: "abc" }, {})).toEqual({ kind: "bad_amount" });
    expect(run(swapTo("USDT", "1.500"), { WARS: 5_000n * 10n ** 18n })).toEqual({ kind: "bad_amount" });
  });
});

describe("resolveCommand save_in_dollars", () => {
  const save = { kind: "save_in_dollars" } as const;
  it("holding both gives the wARS card first", () => {
    expect(run(save, { WARS: 5_000n * 10n ** 18n, WBRL: 50n * 10n ** 18n })).toEqual({ kind: "card", from: "WARS", to: "USDT", wanted: null });
  });
  it("holding only wBRL gives the wBRL card", () => {
    expect(run(save, { WBRL: 50n * 10n ** 18n })).toEqual({ kind: "card", from: "WBRL", to: "USDT", wanted: null });
  });
  it("USAT alone is never a save_in_dollars source", () => {
    expect(run(save, { USAT: 50_000_000n })).toEqual({ kind: "already_dollars" });
  });
  it("pesos or reais worth under US$1 are not called dollars", () => {
    expect(run(save, { WARS: 500n * 10n ** 18n })).toEqual({ kind: "save_below_minimum" });
    expect(run(save, { WBRL: 10n ** 18n })).toEqual({ kind: "save_below_minimum" });
  });
  it("a card for one currency wins over another under US$1", () => {
    expect(run(save, { WARS: 500n * 10n ** 18n, WBRL: 50n * 10n ** 18n })).toEqual({ kind: "card", from: "WBRL", to: "USDT", wanted: null });
  });
  it("holding only dollars is already_dollars", () => {
    expect(run(save, { USAT: 50_000_000n, USDT: 50_000_000n })).toEqual({ kind: "already_dollars" });
  });
});

describe("resolveCommand other", () => {
  it("balance and unknown", () => {
    expect(run({ kind: "balance" }, {})).toEqual({ kind: "balances" });
    expect(run({ kind: "unknown" }, {})).toEqual({ kind: "help" });
  });
});
