// src/lib/treasury/view.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { agentState, buildTreasuryView } from "./view";

const rates: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const pesos = (n: bigint) => n * 10n ** 18n;

describe("buildTreasuryView", () => {
  it("gives the dashboard its figures", () => {
    const view = buildTreasuryView({
      balances: { ...ZERO, WARS: pesos(80_000n), USDT: 50_000_000n, USAT: 10_000_000n, USDC: 40_000n },
      rates,
      rules: { localCurrency: "ARS", reserveAmount: "160000.00" },
      payments: [{ asset: "USDT", amountAtomic: 100_000_000n, ratesSnapshot: { ARS: "1000" } }],
      withdrawnUsdWad: 0n,
    });
    expect(view).toEqual({
      local: "ARS",
      totalUsd: "110.00",
      spending: "80000.00",
      reserve: "160000.00",
      reservePercent: 50,
      savingsUsd: "60.00",
      protectedUsd: "47.50",
      protectedNegative: false,
    });
  });

  it("hides the reserve bar without a reserve, caps it at 100% and reports a shortfall", () => {
    const base = { rates, payments: [], withdrawnUsdWad: 0n };
    expect(
      buildTreasuryView({ ...base, balances: { ...ZERO, WARS: pesos(5n) }, rules: { localCurrency: "ARS", reserveAmount: "0.00" } }).reservePercent,
    ).toBeNull();
    expect(
      buildTreasuryView({ ...base, balances: { ...ZERO, WARS: pesos(500n) }, rules: { localCurrency: "ARS", reserveAmount: "100.00" } }).reservePercent,
    ).toBe(100);
    const behind = buildTreasuryView({
      ...base,
      payments: [{ asset: "WARS", amountAtomic: pesos(3_200n), ratesSnapshot: null }],
      balances: ZERO,
      rules: { localCurrency: "ARS", reserveAmount: "0.00" },
    });
    expect(behind).toMatchObject({ protectedUsd: "2.00", protectedNegative: true });
  });
});

describe("agentState", () => {
  it("shows the most restrictive switch, then dry run, then a waiting proposal", () => {
    const base = { globalEnabled: true, dryRun: false, userEnabled: true, awaitingApproval: false };
    expect(agentState({ ...base, globalEnabled: false, awaitingApproval: true })).toBe("off");
    expect(agentState({ ...base, userEnabled: false, awaitingApproval: true })).toBe("paused");
    expect(agentState({ ...base, dryRun: true, awaitingApproval: true })).toBe("dry_run");
    expect(agentState({ ...base, awaitingApproval: true })).toBe("awaiting");
    expect(agentState({ ...base, dryRun: true })).toBe("dry_run");
    expect(agentState(base)).toBe("active");
  });
});
