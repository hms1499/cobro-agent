import { custom, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, multicall3Abi, type Address, type Hex } from "viem";
import { celo } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import { erc20Balance, readTreasuryBalances, spendableBalances, TREASURY_TOKENS, type ReadBalance, type TreasuryBalances } from "./balances";

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

/** A fake node that answers Multicall3 aggregate3; `fail` makes that call index unsuccessful. */
function multicallNode(fail?: number) {
  const calls: { to: Hex; data: Hex }[] = [];
  const transport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return "0xa4ec";
      if (method !== "eth_call") throw new Error(`unexpected RPC ${method}`);
      const [tx] = params as [{ to: Hex; data: Hex }];
      calls.push(tx);
      const decoded = decodeFunctionData({ abi: multicall3Abi, data: tx.data });
      const inner = (decoded.args as readonly [readonly unknown[]])[0];
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: inner.map((_, i) => ({
          success: i !== fail,
          returnData: i === fail ? "0x" : encodeAbiParameters([{ type: "uint256" }], [BigInt(i + 1)]),
        })),
      });
    },
  });
  return { transport, calls };
}

describe("readTreasuryBalances over the Celo client", () => {
  it("reads all five balances in one Multicall3 eth_call", async () => {
    const node = multicallNode();
    const balances = await readTreasuryBalances(erc20Balance(createCeloPublicClient("https://unused.invalid", node.transport)), OWNER);
    expect(node.calls).toHaveLength(1);
    expect(getAddress(node.calls[0].to)).toBe(getAddress(celo.contracts.multicall3.address));
    expect(TREASURY_TOKENS.map((symbol) => balances[symbol])).toEqual([1n, 2n, 3n, 4n, 5n]);
  });

  it("rejects when one token's balanceOf fails, instead of reporting zero", async () => {
    const node = multicallNode(2);
    await expect(readTreasuryBalances(erc20Balance(createCeloPublicClient("https://unused.invalid", node.transport)), OWNER)).rejects.toThrow();
  });
});
