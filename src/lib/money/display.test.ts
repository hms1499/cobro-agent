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

  it("leads balances with the local currency, whole above 1,000, no ≈ on the headline", () => {
    expect(displayAmount("300.00", "USD", "ARS", rates)).toEqual({ primary: `ARS${NBSP}481,649`, secondary: "US$300.00" });
    expect(displayAmount("1718.48", "ARS", "ARS", rates)).toEqual({ primary: `ARS${NBSP}1,718`, secondary: "≈ US$1.07" });
    expect(displayAmount("0.50", "USD", "ARS", rates)).toEqual({ primary: `ARS${NBSP}802.75`, secondary: "US$0.50" });
  });

  it("leads invoices with the billed currency, exact", () => {
    expect(displayAmount("300.00", "USD", "ARS", rates, "billed")).toEqual({ primary: "US$300.00", secondary: `≈ ARS${NBSP}481,649` });
    expect(displayAmount("1500.50", "ARS", "ARS", rates, "billed")).toEqual({ primary: `ARS${NBSP}1,500.50`, secondary: "≈ US$0.93" });
  });

  it("never shows a converted value as zero", () => {
    expect(displayAmount("1.10", "ARS", "ARS", rates, "billed")).toEqual({ primary: `ARS${NBSP}1.10`, secondary: "< US$0.01" });
  });

  it("falls back to the invoice currency when rates are missing", () => {
    expect(displayAmount("300.00", "USD", "ARS", null)).toEqual({ primary: "US$300.00" });
    expect(displayAmount("482000.00", "ARS", "ARS", null)).toEqual({ primary: `ARS${NBSP}482,000` });
  });

  it("shows only the invoice currency before onboarding picks a local one", () => {
    expect(displayAmount("300.00", "USD", null, rates)).toEqual({ primary: "US$300.00" });
  });
});
