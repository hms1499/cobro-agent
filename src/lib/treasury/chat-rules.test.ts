// src/lib/treasury/chat-rules.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import type { PayAsset } from "@/lib/money/currencies";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { chatAvailable, dailyLeftWad, DIRECT_PAIRS, fitChatAmount, isDirectPair, swapWouldBeUndone } from "./chat-rules";
import type { EngineRules } from "./engine";
import { WAD } from "./value";

const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;
const reais = pesos;
const dollars = (n: bigint) => n * 1_000_000n;
const wad = (n: bigint) => n * WAD;
const held = (b: Partial<TreasuryBalances> = {}): TreasuryBalances => ({ USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n, ...b });

// Reserve ARS 50,000 (about US$31.25), band 5% = ARS 2,500, refill on.
const arsHome: EngineRules = { localCurrency: "ARS", reserveAmount: "50000.00", autoTopUp: true, perTradeMaxUsd: 50, dailyMaxUsd: 200 };
const usdHome: EngineRules = { ...arsHome, localCurrency: "USD" };

const undone = (
  balances: TreasuryBalances,
  rules: EngineRules,
  from: PayAsset,
  to: PayAsset,
  sold: bigint,
  bought: bigint,
) => swapWouldBeUndone({ balances, rules, rates: RATES, from, to, sold, bought });

describe("swapWouldBeUndone", () => {
  it.each([
    ["USD home, wARS → USD₮", usdHome, held({ WARS: pesos(160_000n) }), "WARS", "USDT", pesos(160_000n), dollars(100n), false],
    ["ARS home, excess wARS → USD₮, reserve covered", arsHome, held({ WARS: pesos(100_000n), USDT: dollars(10n) }), "WARS", "USDT", pesos(40_000n), dollars(25n), false],
    ["ARS home, reserve wARS → USD₮, refill on", arsHome, held({ WARS: pesos(60_000n), USDT: dollars(10n) }), "WARS", "USDT", pesos(30_000n), dollars(18n), true],
    ["ARS home, USD₮ → wARS above the reserve", arsHome, held({ WARS: pesos(50_000n), USDT: dollars(100n) }), "USDT", "WARS", dollars(100n), pesos(160_000n), true],
    ["ARS home, USD₮ → wBRL", arsHome, held({ WARS: pesos(50_000n), USDT: dollars(100n) }), "USDT", "WBRL", dollars(100n), reais(500n), true],
    ["USD₮ → USA₮ with the reserve covered", arsHome, held({ WARS: pesos(50_000n), USDT: dollars(100n) }), "USDT", "USAT", dollars(50n), dollars(50n), false],
  ] as const)("%s", (_name, rules, balances, from, to, sold, bought, expected) => {
    expect(undone(balances, rules, from, to, sold, bought)).toBe(expected);
  });

  it("is false for reserve wARS → USD₮ when refill is off", () => {
    const balances = held({ WARS: pesos(60_000n), USDT: dollars(10n) });
    expect(undone(balances, { ...arsHome, autoTopUp: false }, "WARS", "USDT", pesos(30_000n), dollars(18n))).toBe(false);
  });

  it("is not hidden by a used-up daily cap", () => {
    // The check runs with nothing filled, so the limit left today has no say.
    const balances = held({ WARS: pesos(60_000n), USDT: dollars(10n) });
    expect(undone(balances, { ...arsHome, dailyMaxUsd: 200 }, "WARS", "USDT", pesos(30_000n), dollars(18n))).toBe(true);
  });

  it("is not hidden by an unrelated wBRL balance", () => {
    const balances = held({ WARS: pesos(60_000n), USDT: dollars(10n), WBRL: reais(500n) });
    expect(undone(balances, arsHome, "WARS", "USDT", pesos(30_000n), dollars(18n))).toBe(true);
  });

  it("keeps the local reserve: USAT → USD₮ with the ARS reserve covered is not undone", () => {
    const balances = held({ WARS: pesos(50_000n), USDT: dollars(50n), USAT: dollars(50n) });
    expect(undone(balances, arsHome, "USAT", "USDT", dollars(50n), dollars(50n))).toBe(false);
  });

  it("is not fooled by an unrelated wARS excess: USD₮ → USA₮ while WARS holds more than the reserve", () => {
    const balances = held({ WARS: pesos(100_000n), USDT: dollars(100n) });
    expect(undone(balances, arsHome, "USDT", "USAT", dollars(50n), dollars(50n))).toBe(false);
  });

  it("does not call a refill of wARS an undo of USAT → USD₮", () => {
    const balances = held({ WARS: pesos(30_000n), USDT: dollars(10n), USAT: dollars(50n) });
    expect(undone(balances, arsHome, "USAT", "USDT", dollars(50n), dollars(50n))).toBe(false);
  });

  it("counts a hub_route refill of the local token just sold as undone", () => {
    // Sold reserve wARS for US$1; after the gas holdback that is under US$1, so the agent routes USA₮ first.
    const balances = held({ WARS: pesos(60_000n), USAT: dollars(50n) });
    expect(undone(balances, arsHome, "WARS", "USDT", pesos(30_000n), dollars(1n))).toBe(true);
  });

  it("applies the gas holdback: US$1.02 of USD₮ with no other gas token leaves nothing to refill with", () => {
    const balances = held({ WARS: pesos(60_000n) });
    expect(undone(balances, arsHome, "WARS", "USDT", pesos(30_000n), 1_020_000n)).toBe(false);
    expect(undone(balances, arsHome, "WARS", "USDT", pesos(30_000n), 1_060_000n)).toBe(true);
  });
});

describe("fitChatAmount", () => {
  const fit = (o: Partial<Parameters<typeof fitChatAmount>[0]> = {}) =>
    fitChatAmount({ from: "USDT", wanted: dollars(10n), available: dollars(1_000n), dailyLeft: wad(1_000n), rates: RATES, ...o });

  it("keeps a wanted amount that fits", () => {
    expect(fit()).toEqual({ amount: dollars(10n), limited: null });
  });

  it("lowers the amount to the balance", () => {
    expect(fit({ wanted: dollars(300n), available: dollars(120n) })).toEqual({ amount: dollars(120n), limited: "balance" });
  });

  it("lowers the amount to the daily limit", () => {
    expect(fit({ wanted: dollars(300n), dailyLeft: wad(200n) })).toEqual({ amount: dollars(200n), limited: "daily" });
  });

  it("uses no per-trade limit", () => {
    expect(fit({ wanted: dollars(500n), dailyLeft: wad(1_000n) })).toEqual({ amount: dollars(500n), limited: null });
  });

  it("converts the daily limit to wARS", () => {
    const r = fit({ from: "WARS", wanted: pesos(1_000_000n), available: pesos(2_000_000n), dailyLeft: wad(100n) });
    expect(r).toEqual({ amount: pesos(160_000n), limited: "daily" });
  });

  it("refuses below US$1 and with under US$1 left today", () => {
    expect(fit({ wanted: 500_000n })).toEqual({ refused: "below_minimum" });
    expect(fit({ wanted: null, available: 900_000n })).toEqual({ refused: "below_minimum" });
    expect(fit({ dailyLeft: WAD - 1n })).toEqual({ refused: "daily_limit" });
    expect(fit({ dailyLeft: 0n })).toEqual({ refused: "daily_limit" });
  });

  it("says insufficient when a typed amount exceeds a balance worth under US$1", () => {
    // 0.0177 USD₮ against "25,50".
    expect(fit({ wanted: 25_500_000n, available: 17_700n })).toEqual({ refused: "insufficient" });
    // Before the daily limit: no funds is the truer answer.
    expect(fit({ wanted: 25_500_000n, available: 17_700n, dailyLeft: 0n })).toEqual({ refused: "insufficient" });
  });

  it("lowers a typed amount to a balance worth at least US$1", () => {
    expect(fit({ wanted: dollars(300n), available: dollars(1n) })).toEqual({ amount: dollars(1n), limited: "balance" });
  });

  it("keeps below_minimum for a small typed amount with enough balance, and for no amount with a small balance", () => {
    expect(fit({ wanted: 500_000n, available: dollars(50n) })).toEqual({ refused: "below_minimum" });
    expect(fit({ wanted: null, available: 17_700n })).toEqual({ refused: "below_minimum" });
  });

  it("refuses when nothing is available", () => {
    expect(fit({ available: 0n })).toEqual({ refused: "insufficient" });
    expect(fit({ available: 0n, dailyLeft: 0n })).toEqual({ refused: "insufficient" });
  });

  it("keeps a whole-balance amount exact", () => {
    const r = fit({ from: "WARS", wanted: null, available: 1234567890123456789012345n });
    expect("amount" in r && r.amount).toBe(1234567890123456789012345n);
  });
});

describe("dailyLeftWad", () => {
  it("subtracts what is filled and never goes below zero", () => {
    expect(dailyLeftWad(200, wad(50n))).toBe(wad(150n));
    expect(dailyLeftWad(200, wad(250n))).toBe(0n);
  });
});

describe("chatAvailable", () => {
  it("holds back the gas reserve in the dollar token that pays gas", () => {
    expect(chatAvailable("USDT", held({ USDT: dollars(10n) }))).toBe(dollars(10n) - 50_000n);
    expect(chatAvailable("WARS", held({ USDT: dollars(10n), WARS: pesos(5n) }))).toBe(pesos(5n));
  });
});

describe("direct pairs", () => {
  it("allows exactly the six direct directions", () => {
    const assets: PayAsset[] = ["USDT", "USAT", "WARS", "WBRL"];
    const allowed = assets.flatMap((a) => assets.filter((b) => isDirectPair(a, b)).map((b) => `${a}>${b}`)).sort();
    expect(allowed).toEqual(["USAT>USDT", "USDT>USAT", "USDT>WARS", "USDT>WBRL", "WARS>USDT", "WBRL>USDT"]);
    expect(DIRECT_PAIRS).toHaveLength(6);
  });
});
