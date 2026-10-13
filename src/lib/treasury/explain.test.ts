// src/lib/treasury/explain.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import { describeDecision, describeEvent, moneyText, percentText } from "./explain";

const rates: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ctx = { local: "ARS" as const, rates };
// Intl puts a no-break space between a currency code and the number.
const NBSP = "\u00A0";

describe("moneyText and percentText", () => {
  it("shows token amounts in the freelancer's currency first", () => {
    expect(moneyText("WARS", "3200000000000000000000", ctx)).toBe(`ARS${NBSP}3,200`);
    expect(moneyText("USDT", "2000000", ctx)).toBe(`≈ ARS${NBSP}3,200`);
    expect(moneyText("USDT", "2000000", { local: null, rates: null })).toBe("US$2.00");
    expect(moneyText("DAI", "1", ctx)).toBe("some money");
  });

  it("writes basis points as a percentage", () => {
    expect(percentText(50)).toBe("0.50%");
    expect(percentText(150)).toBe("1.50%");
    expect(percentText(undefined)).toBe("0.00%");
  });
});

describe("describeEvent", () => {
  it("explains a conversion with its reason and price", () => {
    const view = describeEvent(
      {
        type: "converted",
        data: { from: "WARS", to: "USDT", amount: "3200000000000000000000", slippageBps: 50, reason: "save_excess", txHash: "0xabc" },
      },
      ctx,
    );
    expect(view).toEqual({
      tone: "success",
      title: `Converted ARS${NBSP}3,200 to dollars`,
      why: "Your spending money was above the reserve you set, so the agent saved the extra in dollars to protect it from inflation. The rate was 0.50% below the market rate, within your limit.",
      txHash: "0xabc",
    });
  });

  it("takes fiat amounts in copy from the constants, formatted", () => {
    expect(describeEvent({ type: "gas_dripped", data: {} }, ctx).why).toContain("US$0.05");
    expect(describeDecision({ kind: "none", reason: "below_minimum" }, ctx)).toContain("US$1.00 minimum");
  });

  it("explains waiting, blocking and withdrawals", () => {
    const waiting = describeEvent(
      { type: "waiting", data: { from: "WARS", amount: "3200000000000000000000", slippageBps: 500, limitBps: 50 } },
      ctx,
    );
    expect(waiting.title).toBe("Waiting for a better rate");
    expect(waiting.why).toContain("5.00% below the market rate. Your limit is 0.50%");
    expect(describeEvent({ type: "blocked", data: {} }, ctx).tone).toBe("alert");
    expect(describeEvent({ type: "withdrawn", data: { asset: "USDT", amount: "2000000", txHash: "0x1" } }, ctx).title).toBe(
      `Sent ≈ ARS${NBSP}3,200 to your wallet`,
    );
  });
});

describe("describeDecision", () => {
  it("says what the agent would do now", () => {
    expect(describeDecision({ kind: "none", reason: "within_band" }, ctx)).toBe(
      "do nothing: your spending money is within the range you set.",
    );
    expect(
      describeDecision(
        { kind: "convert", from: "USDT", to: "WARS", amount: 10_000_000n, usdWad: 10n ** 19n, reason: "top_up" },
        ctx,
      ),
    ).toBe(
      `convert ≈ ARS${NBSP}16,000 to pesos. Your spending money fell below the reserve you set, so the agent refilled it from your savings.`,
    );
  });
});
