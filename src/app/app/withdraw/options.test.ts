import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import { withdrawOptions } from "./options";

const NBSP = " ";
const rates: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const balances: TreasuryBalances = { USAT: 0n, USDT: 0n, WARS: parseDecimal("1718.50", 18), WBRL: 0n, USDC: 0n };

describe("withdrawOptions", () => {
  it("shows the exact amount that can be withdrawn, in the token's own currency", () => {
    expect(withdrawOptions(balances, "ARS", rates)).toEqual([
      { asset: "WARS", label: "Argentine peso (wARS)", available: { primary: `ARS${NBSP}1,718.50`, secondary: "≈ US$1.07" } },
    ]);
  });
});
