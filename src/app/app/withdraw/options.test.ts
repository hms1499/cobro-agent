import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import type { SavedAddress } from "@/lib/addresses/repo";
import { destinationName, withdrawDestinations, withdrawOptions } from "./options";

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

const HOUR = 3_600_000;
const now = new Date("2026-10-21T12:00:00Z");
const personal = "0x1111111111111111111111111111111111111111" as const;
function saved(id: string, hoursAgo: number, address: SavedAddress["address"]): SavedAddress {
  const createdAt = new Date(now.getTime() - hoursAgo * HOUR);
  return { id, label: `L-${id}`, address, createdAt, usableAt: new Date(createdAt.getTime() + 24 * HOUR) };
}
const a25 = saved("a25", 25, "0x2222222222222222222222222222222222222222");
const a23 = saved("a23", 23, "0x3333333333333333333333333333333333333333");

describe("withdrawDestinations", () => {
  it("lists your wallet first and says when a new address is usable", () => {
    const list = withdrawDestinations(personal, [a25, a23], now);
    expect(list.map((d) => d.value)).toEqual(["personal", "a25", "a23"]);
    expect(list.map((d) => d.usableInHours)).toEqual([null, null, 1]);
    expect(list[0]).toMatchObject({ label: "Your Cobro wallet", address: personal });
  });

  it("lists only saved rows when there is no personal wallet", () => {
    expect(withdrawDestinations(null, [a25], now).map((d) => d.value)).toEqual(["a25"]);
  });
});

describe("destinationName", () => {
  const list = withdrawDestinations(personal, [a25], now);
  it("uses the lower-case phrase for the personal wallet so it reads mid-sentence", () => {
    expect(destinationName(list, "personal")).toBe("your Cobro wallet");
  });
  it("uses the saved label, and falls back to the personal phrase for an unknown value", () => {
    expect(destinationName(list, "a25")).toBe("L-a25");
    expect(destinationName(list, undefined)).toBe("your Cobro wallet");
  });
});
