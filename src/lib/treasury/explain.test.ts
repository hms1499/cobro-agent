// src/lib/treasury/explain.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import { describeDecision, describeEvent, describeProposal, eventAssets, moneyText, percentText } from "./explain";

const rates: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ctx = { local: "ARS" as const, rates };
// Intl puts a no-break space between a currency code and the number.
const NBSP = "\u00A0";

describe("moneyText and percentText", () => {
  it("shows token amounts in their own currency", () => {
    expect(moneyText("WARS", "3200000000000000000000", ctx)).toBe(`ARS${NBSP}3,200`);
    expect(moneyText("USDT", "2000000", ctx)).toBe("US$2.00");
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
      "Sent US$2.00 to your Cobro wallet",
    );
  });

  it("names the destination of a withdrawal", () => {
    const data = { asset: "USDT", amount: "1000000", txHash: "0x1" };
    expect(describeEvent({ type: "withdrawn", data: { ...data, toLabel: "Lemon" } }, ctx).title).toBe("Sent US$1.00 to Lemon");
    expect(describeEvent({ type: "withdrawn", data: { ...data, toLabel: null } }, ctx).title).toBe("Sent US$1.00 to your Cobro wallet");
  });
});

describe("describeDecision", () => {
  it("tells a dollars freelancer there is nothing to convert", () => {
    expect(describeDecision({ kind: "none", reason: "within_band" }, { local: "USD", rates })).toBe(
      "do nothing: everything you hold is already in dollars.",
    );
  });

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
      "convert US$10.00 to pesos. Your spending money fell below the reserve you set, so the agent refilled it from your savings.",
    );
  });
});

describe("approval events", () => {
  it("explains a proposal, an approval and a dismissal", () => {
    const data = { from: "USDT", to: "WARS", amount: "2000000", reason: "top_up" };
    expect(describeEvent({ type: "proposed", data }, ctx)).toMatchObject({
      tone: "warning",
      title: "Your agent asks to convert US$2.00 to pesos",
    });
    expect(describeEvent({ type: "approved", data }, ctx).title).toBe("You approved converting US$2.00 to pesos");
    expect(describeEvent({ type: "dismissed", data }, ctx).why).toBe("Your agent won't suggest this again for 24 hours.");
  });

  it("names the spending currency for the first leg of a refill through USD₮", () => {
    const data = { from: "USAT", to: "USDT", amount: "2000000", reason: "hub_route" };
    expect(describeEvent({ type: "proposed", data }, ctx).title).toBe("Your agent asks to convert US$2.00 to pesos");
  });
});

describe("describeProposal", () => {
  const limits = { maxSlippageBps: 50, hardMaxSlippageBps: 150, maxWaitMinutes: 360 };
  it("says what, why, at what price, and keeps token units for Details", () => {
    const view = describeProposal({ fromAsset: "USDT", toAsset: "WARS", amountAtomic: "2100000", reason: "top_up" }, ctx, limits);
    expect(view).toEqual({
      title: "Your agent needs your approval",
      body: `Convert US$2.10 of your dollars to pesos (≈ ARS${NBSP}3,360).`,
      why: "Your spending money is below the reserve you set.",
      price: "Your agent converts only within your price limit: at most 0.50% below the market rate, or up to 1.50% after 6 hours.",
      units: "2.1 USD₮",
    });
  });

  it("mentions the USD₮ step of a refill from USA₮", () => {
    const view = describeProposal({ fromAsset: "USAT", toAsset: "USDT", amountAtomic: "2100000", reason: "hub_route" }, ctx, limits);
    expect(view.body).toBe(`Convert US$2.10 of your dollars to pesos (≈ ARS${NBSP}3,360), through USD₮.`);
  });

  it("names pesos in their own currency when selling pesos", () => {
    const view = describeProposal({ fromAsset: "WARS", toAsset: "USDT", amountAtomic: "3200000000000000000000", reason: "save_excess" }, ctx, limits);
    expect(view.body).toBe(`Convert ARS${NBSP}3,200 to dollars (≈ US$2.00).`);
  });

  it("drops the estimate without rates", () => {
    const view = describeProposal({ fromAsset: "USDT", toAsset: "WARS", amountAtomic: "2100000", reason: "top_up" }, { local: null, rates: null }, limits);
    expect(view.body).toBe("Convert US$2.10 of your dollars to pesos.");
  });
});

describe("describeDecision with approval", () => {
  it("says the agent would ask first", () => {
    const decision = { kind: "convert", from: "USDT", to: "WARS", amount: 2_000_000n, usdWad: 0n, reason: "top_up" } as const;
    expect(describeDecision(decision, ctx, { askFirst: true })).toMatch(/^ask you to approve converting US\$2\.00 to pesos\./);
  });
});

describe("eventAssets", () => {
  it("lists the tokens a conversion moves, in order", () => {
    expect(eventAssets({ type: "converted", data: { from: "WARS", to: "USDT" } })).toEqual(["WARS", "USDT"]);
    expect(eventAssets({ type: "proposed", data: { from: "USDT", to: "WBRL" } })).toEqual(["USDT", "WBRL"]);
  });

  it("names the token of a withdrawal", () => {
    expect(eventAssets({ type: "withdrawn", data: { asset: "USAT", amount: "1" } })).toEqual(["USAT"]);
  });

  it("shows no token for events without one, or with an unknown one", () => {
    expect(eventAssets({ type: "paused", data: {} })).toEqual([]);
    expect(eventAssets({ type: "gas_dripped", data: { asset: "CELO" } })).toEqual([]);
    expect(eventAssets({ type: "converted", data: { from: "USDC", to: "USDT" } })).toEqual(["USDT"]);
  });
});
