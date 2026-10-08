import { describe, expect, it } from "vitest";
import { ASSET_DENOMINATION, isPayAsset } from "./currencies";
import { ceilDiv, formatDecimal, parseDecimal, RATE_ONE } from "./decimal";
import { formatMoney, formatTokenAmount } from "./format";
import { parseFiatInput } from "./input";

const NBSP = " ";

describe("currencies", () => {
  it("knows which fiat each pay asset tracks", () => {
    expect(ASSET_DENOMINATION).toEqual({ USAT: "USD", USDT: "USD", WARS: "ARS", WBRL: "BRL" });
  });

  it("accepts only the four pay assets", () => {
    expect(isPayAsset("WARS")).toBe(true);
    expect(isPayAsset("USDC")).toBe(false);
    expect(isPayAsset(null)).toBe(false);
  });
});

describe("decimal", () => {
  it("parses decimals into scaled integers", () => {
    expect(parseDecimal("1605.495", 18)).toBe(1605495000000000000000n);
    expect(parseDecimal("300", 6)).toBe(300_000000n);
    expect(parseDecimal("0.01", 2)).toBe(1n);
    expect(parseDecimal("5", 0)).toBe(5n);
  });

  it("rejects malformed input and excess precision", () => {
    expect(() => parseDecimal("1,5", 2)).toThrow(/decimal/);
    expect(() => parseDecimal("-1", 2)).toThrow(/decimal/);
    expect(() => parseDecimal("1.005", 2)).toThrow(/2 decimal places/);
  });

  it("formats without trailing zeros", () => {
    expect(formatDecimal(1605495000000000000000n, 18)).toBe("1605.495");
    expect(formatDecimal(300_000000n, 6)).toBe("300");
    expect(formatDecimal(RATE_ONE, 18)).toBe("1");
    expect(formatDecimal(7n, 6)).toBe("0.000007");
  });

  it("divides rounding up", () => {
    expect(ceilDiv(10n, 5n)).toBe(2n);
    expect(ceilDiv(11n, 5n)).toBe(3n);
    expect(ceilDiv(0n, 5n)).toBe(0n);
    expect(() => ceilDiv(1n, 0n)).toThrow();
  });
});

describe("parseFiatInput", () => {
  it("accepts plain amounts and canonicalises them", () => {
    expect(parseFiatInput("1500")).toEqual({ ok: true, value: "1500.00" });
    expect(parseFiatInput(" 1500.5 ")).toEqual({ ok: true, value: "1500.50" });
    expect(parseFiatInput("0.01")).toEqual({ ok: true, value: "0.01" });
    expect(parseFiatInput("007.10")).toEqual({ ok: true, value: "7.10" });
  });

  it("refuses separators that could mean two different numbers", () => {
    expect(parseFiatInput("1,500.50")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("1.500,50")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("1500,50")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("1 500")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("$300")).toEqual({ ok: false, error: "format" });
  });

  it("refuses more than two decimals, zero, empty and huge amounts", () => {
    expect(parseFiatInput("1.005")).toEqual({ ok: false, error: "decimals" });
    expect(parseFiatInput("0")).toEqual({ ok: false, error: "range" });
    expect(parseFiatInput("")).toEqual({ ok: false, error: "required" });
    expect(parseFiatInput("1000000000.01")).toEqual({ ok: false, error: "range" });
  });

  it("allows zero when asked (spending reserve)", () => {
    expect(parseFiatInput("0", { allowZero: true })).toEqual({ ok: true, value: "0.00" });
  });
});

describe("formatMoney", () => {
  it("shows dollars as US$ with cents", () => {
    expect(formatMoney("300", "USD")).toBe("US$300.00");
    expect(formatMoney("1234.5", "USD")).toBe("US$1,234.50");
  });

  it("shows pesos and reais with the currency code, dropping .00", () => {
    expect(formatMoney("482000.00", "ARS")).toBe(`ARS${NBSP}482,000`);
    expect(formatMoney("1500.50", "BRL")).toBe(`BRL${NBSP}1,500.50`);
  });
});

describe("formatTokenAmount", () => {
  it("rounds up to cents so the shown amount is never less than what is charged", () => {
    expect(formatTokenAmount(622861n, "USDT")).toBe("0.63 USD₮");
    expect(formatTokenAmount(300_000000n, "USAT")).toBe("300.00 USA₮");
    expect(formatTokenAmount(481648500000000000000000n, "WARS")).toBe("481,648.50 wARS");
    expect(formatTokenAmount(31876880007147749947881n, "WBRL")).toBe("31,876.89 wBRL");
  });
});
