import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { displayAmount } from "./display";

const NBSP = " ";
const rates: ReferenceRates = { perUsd: { ARS: 1605495n * 10n ** 15n, BRL: 503655n * 10n ** 13n }, fetchedAt: 0 };

describe("displayAmount", () => {
  it("puts the freelancer's currency first, with dollars underneath", () => {
    expect(displayAmount("482000.00", "ARS", "ARS", rates)).toEqual({
      primary: `ARS${NBSP}482,000`,
      secondary: "≈ US$300.22",
    });
  });

  it("converts a dollar invoice into the local currency, marked approximate", () => {
    expect(displayAmount("300.00", "USD", "ARS", rates)).toEqual({
      primary: `≈ ARS${NBSP}481,648.50`,
      secondary: "US$300.00",
    });
  });

  it("falls back to the invoice currency when rates are missing", () => {
    expect(displayAmount("300.00", "USD", "ARS", null)).toEqual({ primary: "US$300.00" });
    expect(displayAmount("482000.00", "ARS", "ARS", null)).toEqual({ primary: `ARS${NBSP}482,000` });
  });

  it("shows only the invoice currency before onboarding picks a local one", () => {
    expect(displayAmount("300.00", "USD", null, rates)).toEqual({ primary: "US$300.00" });
  });
});
