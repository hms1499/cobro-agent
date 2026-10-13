// src/lib/treasury/pnl.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { heldInLocalUsdWad, protectedValue, treasuryUsdWad } from "./pnl";
import { WAD } from "./value";

const NOW_RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const pesos = (n: bigint) => n * 10n ** 18n;

describe("heldInLocalUsdWad", () => {
  it("converts a dollar payment to pesos at the rate it arrived at, then values those pesos today", () => {
    // US$100 at ARS 1,000 → ARS 100,000, worth US$62.50 at today's ARS 1,600.
    const payment = { asset: "USDT" as const, amountAtomic: 100_000_000n, ratesSnapshot: { ARS: "1000", BRL: "4" } };
    expect(heldInLocalUsdWad(payment, "ARS", NOW_RATES)).toBe(62n * WAD + WAD / 2n);
  });

  it("values a local-currency payment as it is, and an old payment without a snapshot at today's rate", () => {
    expect(heldInLocalUsdWad({ asset: "WARS", amountAtomic: pesos(160_000n), ratesSnapshot: null }, "ARS", NOW_RATES)).toBe(100n * WAD);
    expect(heldInLocalUsdWad({ asset: "USDT", amountAtomic: 100_000_000n, ratesSnapshot: null }, "ARS", NOW_RATES)).toBe(100n * WAD);
  });

  it("goes through dollars for the other local currency", () => {
    // 50 wBRL at BRL 4 = US$12.50 → ARS 12,500 → US$7.8125 today.
    const payment = { asset: "WBRL" as const, amountAtomic: pesos(50n), ratesSnapshot: { ARS: "1000", BRL: "4" } };
    expect(heldInLocalUsdWad(payment, "ARS", NOW_RATES)).toBe(7_812_500_000_000_000_000n);
  });
});

describe("protectedValue", () => {
  it("compares what the agent holds (plus withdrawals) with holding pesos", () => {
    const payments = [{ asset: "USDT" as const, amountAtomic: 100_000_000n, ratesSnapshot: { ARS: "1000" } }];
    expect(protectedValue({ balances: { ...ZERO, USDT: 100_000_000n }, withdrawnUsdWad: 0n, payments, local: "ARS", rates: NOW_RATES })).toEqual({
      actualUsdWad: 100n * WAD,
      heldUsdWad: 62n * WAD + WAD / 2n,
      protectedUsdWad: 37n * WAD + WAD / 2n,
    });
    expect(
      protectedValue({ balances: { ...ZERO, USDT: 90_000_000n }, withdrawnUsdWad: 10n * WAD, payments, local: "ARS", rates: NOW_RATES }).actualUsdWad,
    ).toBe(100n * WAD);
  });

  it("leaves gas money (USDC) out of the treasury value", () => {
    expect(treasuryUsdWad({ ...ZERO, USDC: 50_000n, WARS: pesos(1_600n) }, NOW_RATES)).toBe(WAD);
  });
});
