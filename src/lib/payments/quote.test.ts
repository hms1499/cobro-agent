import { describe, expect, it } from "vitest";
import { RatesUnavailableError, type ReferenceRates } from "@/lib/fx/rates";
import { needsRates, quoteInvoice } from "./quote";

const rates: ReferenceRates = { perUsd: { ARS: 1605495n * 10n ** 15n, BRL: 503655n * 10n ** 13n }, fetchedAt: 0 };

describe("needsRates", () => {
  it("is false when the token tracks the invoice currency", () => {
    expect(needsRates("USD", "USDT")).toBe(false);
    expect(needsRates("USD", "USAT")).toBe(false);
    expect(needsRates("ARS", "WARS")).toBe(false);
    expect(needsRates("USD", "WARS")).toBe(true);
    expect(needsRates("ARS", "USDT")).toBe(true);
  });
});

describe("quoteInvoice", () => {
  it("prices dollar invoices in dollar tokens 1:1 without any rate", () => {
    expect(quoteInvoice({ amount: "300.00", currency: "USD", asset: "USDT", rates: null })).toEqual({
      amountAtomic: 300_000000n,
      rate: "1",
    });
    expect(quoteInvoice({ amount: "300.00", currency: "USD", asset: "USAT", rates: null }).amountAtomic).toBe(300_000000n);
  });

  it("prices peso invoices in wARS 1:1 with 18 decimals", () => {
    expect(quoteInvoice({ amount: "1000.00", currency: "ARS", asset: "WARS", rates: null }).amountAtomic).toBe(
      1000n * 10n ** 18n,
    );
  });

  it("converts dollars to pesos at the reference mid", () => {
    expect(quoteInvoice({ amount: "300.00", currency: "USD", asset: "WARS", rates })).toEqual({
      amountAtomic: 481648500000000000000000n,
      rate: "1605.495",
    });
  });

  it("converts pesos to dollars, rounding up to the token's smallest unit", () => {
    expect(quoteInvoice({ amount: "1000.00", currency: "ARS", asset: "USDT", rates })).toEqual({
      amountAtomic: 622861n,
      rate: "0.000622860862226291",
    });
  });

  it("crosses reais to pesos through the dollar", () => {
    expect(quoteInvoice({ amount: "100.00", currency: "BRL", asset: "WARS", rates })).toEqual({
      amountAtomic: 31876880007147749947881n,
      rate: "318.768800071477499478",
    });
  });

  it("never quotes zero for a tiny invoice", () => {
    expect(quoteInvoice({ amount: "0.01", currency: "ARS", asset: "USDT", rates }).amountAtomic).toBe(7n);
  });

  it("refuses to guess a rate it does not have", () => {
    expect(() => quoteInvoice({ amount: "300.00", currency: "USD", asset: "WARS", rates: null })).toThrow(
      RatesUnavailableError,
    );
  });

  it("refuses a zero invoice", () => {
    expect(() => quoteInvoice({ amount: "0.00", currency: "USD", asset: "USDT", rates: null })).toThrow(/positive/);
  });
});
