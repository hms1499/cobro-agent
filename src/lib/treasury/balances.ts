import { erc20Abi, type Address } from "viem";
import type { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS, type TokenSymbol } from "@/lib/chain/tokens";
import { GAS_RESERVE_ATOMIC, type GasToken } from "@/lib/chain/treasury-tx";
import type { Balances } from "./engine";

/** The four pay assets, plus USDC, which a treasury holds only as gas money (operator drips). */
export const TREASURY_TOKENS = ["USDT", "USAT", "USDC", "WARS", "WBRL"] as const satisfies readonly TokenSymbol[];
export type TreasuryToken = (typeof TREASURY_TOKENS)[number];
export type TreasuryBalances = Record<TreasuryToken, bigint>;

export type ReadBalance = (token: Address, owner: Address) => Promise<bigint>;

export function erc20Balance(client: Pick<ReturnType<typeof createCeloPublicClient>, "readContract">): ReadBalance {
  return (token, owner) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export async function readTreasuryBalances(read: ReadBalance, owner: Address): Promise<TreasuryBalances> {
  const values = await Promise.all(TREASURY_TOKENS.map((symbol) => read(TOKENS[symbol].address, owner)));
  return Object.fromEntries(TREASURY_TOKENS.map((symbol, i) => [symbol, values[i]])) as TreasuryBalances;
}

/** Engine input: the pay assets, with the gas reserve held back in the dollar token that pays for gas. */
export function spendableBalances(balances: TreasuryBalances, gasToken: GasToken | null): Balances {
  const spendable: Balances = { USDT: balances.USDT, USAT: balances.USAT, WARS: balances.WARS, WBRL: balances.WBRL };
  if (gasToken === "USDT" || gasToken === "USAT") {
    const left = spendable[gasToken] - GAS_RESERVE_ATOMIC;
    spendable[gasToken] = left > 0n ? left : 0n;
  }
  return spendable;
}
