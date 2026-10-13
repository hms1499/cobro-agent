import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import {
  atomicForUsdWad,
  dollarsToWad,
  fiatToAtomic,
  formatCents,
  tokenFiatAmount,
  usdWad,
  usdWadToDollars,
  WAD,
} from "./value";

const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;

describe("usdWad", () => {
  it("values dollar tokens one to one and local tokens at the reference mid", () => {
    expect(usdWad("USDT", 1_500_000n, RATES)).toBe(1_500_000_000_000_000_000n);
    expect(usdWad("USAT", 1n, RATES)).toBe(1_000_000_000_000n);
    expect(usdWad("WARS", pesos(3200n), RATES)).toBe(2n * WAD);
    expect(usdWad("WBRL", pesos(10n), RATES)).toBe(2n * WAD);
  });
});

describe("atomicForUsdWad", () => {
  it("inverts usdWad, rounding down", () => {
    expect(atomicForUsdWad("WARS", 2n * WAD, RATES)).toBe(pesos(3200n));
    expect(atomicForUsdWad("USDT", 2n * WAD, RATES)).toBe(2_000_000n);
    expect(atomicForUsdWad("USDT", 999_999_999_999n, RATES)).toBe(0n);
  });
});

describe("conversions for rules and display", () => {
  it("turns whole dollars and fiat strings into units", () => {
    expect(dollarsToWad(50)).toBe(50n * WAD);
    expect(fiatToAtomic("300000.00", "WARS")).toBe(pesos(300000n));
    expect(fiatToAtomic("12.5", "USDT")).toBe(12_500_000n);
  });

  it("formats cents, including negatives", () => {
    expect(formatCents(123456n)).toBe("1234.56");
    expect(formatCents(-5n)).toBe("-0.05");
    expect(usdWadToDollars(1_234_567_000_000_000_000n)).toBe("1.23");
  });

  it("gives a balance as a fiat amount rounded down to cents", () => {
    expect(tokenFiatAmount("WARS", 2_409_205_000_000_000_000_000n)).toEqual({ amount: "2409.20", currency: "ARS" });
    expect(tokenFiatAmount("USAT", 1_000_000n)).toEqual({ amount: "1.00", currency: "USD" });
    expect(tokenFiatAmount("WBRL", 0n)).toEqual({ amount: "0.00", currency: "BRL" });
  });
});
