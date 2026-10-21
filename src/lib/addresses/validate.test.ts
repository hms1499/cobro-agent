import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { TEXTILE_REACTOR } from "@/lib/chain/treasury-tx";
import { TOKENS } from "@/lib/chain/tokens";
import { TEST_TREASURY } from "@/lib/db/testing";
import { parseAddressForm } from "./validate";

const PERSONAL = "0x2222222222222222222222222222222222222222" as Address;
const ctx = { treasury: TEST_TREASURY as Address, personalWallet: PERSONAL, saved: [] as Address[] };
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
// Same address with one letter's case flipped: mixed case, wrong checksum.
const BAD_CHECKSUM = "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function err(fields: Record<string, string>, c = ctx) {
  const r = parseAddressForm(fields, c);
  return r.ok ? null : r.errors;
}

describe("parseAddressForm", () => {
  it("accepts a labelled address, trimmed and checksummed", () => {
    expect(
      parseAddressForm({ label: "  Binance ", address: " 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 " }, ctx),
    ).toEqual({ ok: true, data: { label: "Binance", address: VITALIK } });
  });

  it("refuses what it cannot read", () => {
    for (const address of [BAD_CHECKSUM, VITALIK.slice(2), "vitalik.eth", ""]) {
      expect(err({ label: "X", address })).toEqual({ address: "addresses.error.format" });
    }
    expect(err({ label: "", address: VITALIK })).toEqual({ label: "addresses.error.label" });
    expect(err({ label: "a".repeat(41), address: VITALIK })).toEqual({ label: "addresses.error.label" });
    expect(err({ label: "a".repeat(40), address: VITALIK })).toBeNull();
  });

  it("refuses addresses that would lose or loop money", () => {
    const f = (address: string) => err({ label: "X", address });
    expect(f("0x0000000000000000000000000000000000000000")).toEqual({ address: "addresses.error.zero" });
    expect(f(TEST_TREASURY.toLowerCase())).toEqual({ address: "addresses.error.own" });
    expect(f(PERSONAL)).toEqual({ address: "addresses.error.personal" });
    for (const a of [TOKENS.USDT.address, TOKENS.USDT.feeCurrency!, TEXTILE_REACTOR]) {
      expect(f(a)).toEqual({ address: "addresses.error.contract" });
    }
    expect(f(VITALIK.toLowerCase())).toBeNull();
    expect(err({ label: "X", address: VITALIK }, { ...ctx, saved: [VITALIK as Address] })).toEqual({
      address: "addresses.error.duplicate",
    });
    const ten = Array.from({ length: 10 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "3")}` as Address);
    expect(err({ label: "X", address: VITALIK }, { ...ctx, saved: ten })).toEqual({ address: "addresses.error.full" });
  });
});
