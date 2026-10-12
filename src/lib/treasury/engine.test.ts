// src/lib/treasury/engine.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import { acceptQuote, decide, planIntent, slippageBps, type Balances, type EngineRules } from "./engine";
import { WAD } from "./value";

const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;
const dollars = (n: bigint) => n * 1_000_000n;
const balances = (b: Partial<Balances> = {}): Balances => ({ USDT: 0n, USAT: 0n, WARS: 0n, WBRL: 0n, ...b });
// Reserve 160,000 ARS = US$100; band = max(5% = 8,000 ARS, US$1 = 1,600 ARS) = 8,000 ARS.
const RULES: EngineRules = { localCurrency: "ARS", reserveAmount: "160000.00", autoTopUp: true, perTradeMaxUsd: 50, dailyMaxUsd: 200 };
const run = (b: Partial<Balances>, rules: Partial<EngineRules> = {}, filledUsdWad24h = 0n) =>
  decide({ balances: balances(b), rules: { ...RULES, ...rules }, rates: RATES, filledUsdWad24h });

describe("decide", () => {
  it("does nothing inside the band", () => {
    expect(run({ WARS: pesos(165_000n) })).toEqual({ kind: "none", reason: "within_band" });
    expect(run({ WARS: pesos(155_000n), USDT: dollars(100n) })).toEqual({ kind: "none", reason: "within_band" });
  });

  it("saves the excess above the reserve in USD₮", () => {
    expect(run({ WARS: pesos(200_000n) })).toEqual({
      kind: "convert",
      from: "WARS",
      to: "USDT",
      amount: pesos(40_000n),
      usdWad: 25n * WAD,
      reason: "save_excess",
    });
  });

  it("caps one trade at perTradeMaxUsd and splits the rest across runs", () => {
    expect(run({ WARS: pesos(400_000n) })).toMatchObject({ kind: "convert", amount: pesos(80_000n), usdWad: 50n * WAD });
  });

  it("caps by what is left of the daily limit", () => {
    expect(run({ WARS: pesos(400_000n) }, {}, 190n * WAD)).toMatchObject({ amount: pesos(16_000n), usdWad: 10n * WAD });
    expect(run({ WARS: pesos(400_000n) }, {}, 199n * WAD + WAD / 2n)).toEqual({ kind: "none", reason: "daily_cap" });
  });

  it("refills the reserve from USD₮", () => {
    expect(run({ WARS: pesos(100_000n), USDT: dollars(100n) })).toEqual({
      kind: "convert",
      from: "USDT",
      to: "WARS",
      amount: 37_500_000n,
      usdWad: 37n * WAD + WAD / 2n,
      reason: "top_up",
    });
    expect(run({ WARS: pesos(100_000n), USDT: dollars(10n) })).toMatchObject({ from: "USDT", amount: dollars(10n) });
  });

  it("routes USA₮ through USD₮ when USD₮ is short", () => {
    expect(run({ WARS: pesos(100_000n), USDT: 500_000n, USAT: dollars(80n) })).toMatchObject({
      kind: "convert",
      from: "USAT",
      to: "USDT",
      amount: 37_500_000n,
      reason: "hub_route",
    });
  });

  it("waits when there are no dollars to refill from, or refilling is off", () => {
    expect(run({ WARS: pesos(100_000n), USDT: 500_000n })).toEqual({ kind: "none", reason: "no_dollars" });
    expect(run({ WARS: pesos(100_000n), USDT: dollars(100n) }, { autoTopUp: false })).toEqual({ kind: "none", reason: "within_band" });
  });

  it("uses a US$1 band when the reserve is 0", () => {
    expect(run({ WARS: pesos(1_000n) }, { reserveAmount: "0.00" })).toEqual({ kind: "none", reason: "within_band" });
    expect(run({ WARS: pesos(3_200n) }, { reserveAmount: "0.00" })).toMatchObject({ amount: pesos(3_200n), usdWad: 2n * WAD });
  });

  it("saves the other local currency first, and ignores dust of it", () => {
    expect(run({ WARS: pesos(400_000n), WBRL: pesos(50n) })).toMatchObject({
      from: "WBRL",
      to: "USDT",
      amount: pesos(50n),
      usdWad: 10n * WAD,
      reason: "save_other",
    });
    expect(run({ WARS: pesos(165_000n), WBRL: pesos(2n) })).toEqual({ kind: "none", reason: "within_band" });
  });

  it("works the same for a Brazilian freelancer", () => {
    expect(run({ WBRL: pesos(1_000n) }, { localCurrency: "BRL", reserveAmount: "500.00" })).toMatchObject({
      from: "WBRL",
      to: "USDT",
      amount: pesos(250n),
      usdWad: 50n * WAD,
      reason: "save_excess",
    });
  });
});

describe("planIntent", () => {
  const convert = run({ WARS: pesos(200_000n) });
  const open = { id: "i1", fromAsset: "WARS", toAsset: "USDT" } as const;

  it("keeps an open intent for the same pair, so its age still counts", () => {
    expect(planIntent(open, convert)).toEqual({ action: "convert", keep: "i1", cancel: null, decision: convert });
  });

  it("cancels an open intent for another pair, or when nothing is needed", () => {
    expect(planIntent({ ...open, toAsset: "USAT" }, convert)).toEqual({ action: "convert", keep: null, cancel: "i1", decision: convert });
    expect(planIntent(open, { kind: "none", reason: "within_band" })).toEqual({ action: "none", cancel: "i1" });
    expect(planIntent(null, convert)).toEqual({ action: "convert", keep: null, cancel: null, decision: convert });
  });
});

describe("acceptQuote", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const limits = { maxSlippageBps: 50, hardMaxSlippageBps: 150, maxWaitMinutes: 360, now };
  const young = new Date(now.getTime() - 60 * 60_000);
  const old = new Date(now.getTime() - 361 * 60_000);

  it("accepts within the normal limit", () => {
    expect(acceptQuote({ ...limits, slippageBps: 50, intentCreatedAt: young })).toBe("accept");
    expect(acceptQuote({ ...limits, slippageBps: -20, intentCreatedAt: young })).toBe("accept");
  });

  it("waits for a better price until the deadline", () => {
    expect(acceptQuote({ ...limits, slippageBps: 80, intentCreatedAt: young })).toBe("wait");
  });

  it("after the deadline accepts up to the hard limit and blocks beyond it", () => {
    expect(acceptQuote({ ...limits, slippageBps: 150, intentCreatedAt: old })).toBe("accept");
    expect(acceptQuote({ ...limits, slippageBps: 151, intentCreatedAt: old })).toBe("block");
  });
});

describe("slippageBps", () => {
  it("measures the quote against the reference mid, rounding against us", () => {
    expect(slippageBps("WARS", pesos(1_600n), "USDT", 990_000n, RATES)).toBe(100);
    expect(slippageBps("WARS", pesos(1_600n), "USDT", 1_010_000n, RATES)).toBe(-100);
    expect(slippageBps("WARS", pesos(1_600n), "USDT", 999_999n, RATES)).toBe(1);
    expect(slippageBps("USDT", 10_000_000n, "WARS", pesos(15_950n), RATES)).toBe(32);
  });
});
