import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { FEE_TOKENS, TOKENS, feeCurrencyFor } from "./tokens";

describe("TOKENS", () => {
  it("stores checksummed addresses", () => {
    for (const token of Object.values(TOKENS)) {
      expect(token.address).toBe(getAddress(token.address));
      if (token.feeCurrency) expect(token.feeCurrency).toBe(getAddress(token.feeCurrency));
    }
  });

  it("uses 6 decimals for dollar stablecoins and 18 for wFIAT", () => {
    expect(TOKENS.USDT.decimals).toBe(6);
    expect(TOKENS.USAT.decimals).toBe(6);
    expect(TOKENS.USDC.decimals).toBe(6);
    expect(TOKENS.WARS.decimals).toBe(18);
    expect(TOKENS.WBRL.decimals).toBe(18);
  });

  it("keeps the on-chain EIP-712 names (wBRL is 'Real Brasileño')", () => {
    expect(TOKENS.WBRL.eip712).toEqual({ name: "Real Brasileño", version: "1" });
    expect(TOKENS.USAT.eip712).toEqual({ name: "Tether America USD", version: "1" });
  });
});

describe("feeCurrencyFor", () => {
  it("returns no fee currency for native CELO", () => {
    expect(feeCurrencyFor("CELO")).toBeUndefined();
  });

  it("returns the adapter, not the token, for 6-decimal stablecoins", () => {
    expect(feeCurrencyFor("USDT")).toBe("0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72");
    expect(feeCurrencyFor("USDC")).toBe("0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B");
    expect(feeCurrencyFor("USAT")).toBe("0x0357EE22278c922e1D36cFe6b899269b161880C4");
  });

  it("covers every fee token", () => {
    expect(FEE_TOKENS).toEqual(["CELO", "USDT", "USDC", "USAT"]);
  });
});
