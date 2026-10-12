import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { readTreasuryBalances, spendableBalances, type ReadBalance, type TreasuryBalances } from "./balances";

const OWNER: Address = "0x1111111111111111111111111111111111111111";
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };

describe("readTreasuryBalances", () => {
  it("reads every treasury token for the owner", async () => {
    const read = vi.fn<ReadBalance>(async (token) => (token === TOKENS.USDT.address ? 7n : token === TOKENS.WARS.address ? 9n : 0n));
    expect(await readTreasuryBalances(read, OWNER)).toEqual({ ...ZERO, USDT: 7n, WARS: 9n });
    expect(read).toHaveBeenCalledTimes(5);
    expect(read.mock.calls.every(([, owner]) => owner === OWNER)).toBe(true);
  });
});

describe("spendableBalances", () => {
  it("keeps the gas reserve out of the dollar token that pays for gas", () => {
    expect(spendableBalances({ ...ZERO, USDT: 1_000_000n, WARS: 5n }, "USDT")).toEqual({ USDT: 950_000n, USAT: 0n, WARS: 5n, WBRL: 0n });
    expect(spendableBalances({ ...ZERO, USDT: 30_000n }, "USDT").USDT).toBe(0n);
    expect(spendableBalances({ ...ZERO, USDT: 1_000_000n, USDC: 60_000n }, "USDC").USDT).toBe(1_000_000n);
  });
});
