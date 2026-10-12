// src/lib/chain/treasury-tx.ts
import { encodeFunctionData, erc20Abi, getAddress, isAddressEqual, keccak256, type Address, type Hex } from "viem";
import { serializeTransaction } from "viem/celo";
import type { PayAsset } from "@/lib/money/currencies";
import type { TreasurySigner } from "@/lib/signer/treasury-signer";
import { tagCalldata } from "./attribution";
import type { createCeloPublicClient } from "./clients";
import { TOKENS } from "./tokens";

/** Textile LimitOrderReactor on Celo (spec §8.3): the only contract a treasury may approve or call. */
export const TEXTILE_REACTOR: Address = getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3");

/** Treasury gas is paid in a dollar stablecoin through CIP-64, in this order of preference. */
export const GAS_TOKENS = ["USDT", "USAT", "USDC"] as const;
export type GasToken = (typeof GAS_TOKENS)[number];
/** A Celo transaction costs well under $0.01; a token qualifies for gas from 0.02 (6 decimals). */
export const GAS_FLOOR_ATOMIC = 20_000n;
/** Kept back from swaps in the gas token, so the next transactions can still pay for themselves. */
export const GAS_RESERVE_ATOMIC = 50_000n;

export function pickGasToken(
  balances: Record<GasToken, bigint>,
  spend?: { asset: string; amount: bigint },
): GasToken | null {
  return (
    GAS_TOKENS.find((token) => balances[token] - (spend?.asset === token ? spend.amount : 0n) >= GAS_FLOOR_ATOMIC) ?? null
  );
}

export class TreasuryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryPolicyError";
  }
}

export type TreasuryCall =
  | { kind: "approve"; asset: PayAsset; spender: Address; amount: bigint }
  | { kind: "swap"; to: Address; data: Hex; value: bigint; chainId: number }
  | { kind: "withdraw"; asset: PayAsset; to: Address; amount: bigint };

export interface TreasuryPolicy {
  allowedSpenders: readonly Address[];
  personalWallet: Address | null;
}

const isAllowed = (policy: TreasuryPolicy, address: Address) =>
  policy.allowedSpenders.some((spender) => isAddressEqual(spender, address));

/**
 * Spec §6.1 and §12: what a treasury wallet may sign. Para Guardrails were not enforced in the spike
 * (check 4), so this guard is the enforcement; every treasury transaction is encoded here.
 */
export function encodeTreasuryCall(call: TreasuryCall, policy: TreasuryPolicy): { to: Address; data: Hex } {
  switch (call.kind) {
    case "approve":
      if (!isAllowed(policy, call.spender)) throw new TreasuryPolicyError(`approve(${call.spender}) is not allowed`);
      return {
        to: TOKENS[call.asset].address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [call.spender, call.amount] }),
      };
    case "swap":
      if (!isAllowed(policy, call.to)) throw new TreasuryPolicyError(`swap on ${call.to} is not allowed`);
      if (call.value !== 0n || call.chainId !== 42220) {
        throw new TreasuryPolicyError("a swap must carry no value and settle on Celo");
      }
      return { to: getAddress(call.to), data: call.data };
    case "withdraw":
      if (!policy.personalWallet || !isAddressEqual(call.to, policy.personalWallet)) {
        throw new TreasuryPolicyError("withdrawals go only to the freelancer's personal wallet");
      }
      if (call.amount <= 0n) throw new TreasuryPolicyError("a withdrawal must move a positive amount");
      return {
        to: TOKENS[call.asset].address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [policy.personalWallet, call.amount] }),
      };
  }
}

export type TreasuryTxClient = Pick<ReturnType<typeof createCeloPublicClient>, "getTransactionCount" | "estimateGas" | "request">;

export interface SignedTreasuryTx {
  hash: Hex;
  raw: Hex;
  nonce: number;
  feeToken: GasToken;
}

/**
 * Builds a CIP-64 transaction that pays gas in `feeToken`, appends our attribution tag (spec §8.5)
 * and signs its digest with the TreasurySigner. Nothing is broadcast here: the caller stores the raw
 * bytes first, so an unknown outcome can be settled or re-sent verbatim (spec §10.4 step 7).
 */
export async function signTreasuryTx(
  deps: { client: TreasuryTxClient; signer: TreasurySigner; attributionCode: string },
  call: { to: Address; data: Hex },
  feeToken: GasToken,
): Promise<SignedTreasuryTx> {
  const feeCurrency = TOKENS[feeToken].feeCurrency;
  if (!feeCurrency) throw new Error(`${feeToken} has no fee currency adapter`);
  const data = tagCalldata(call.data, deps.attributionCode);
  const from = deps.signer.address;
  // Gas prices quoted in the fee currency (what viem/celo's fee estimator calls).
  const rpc = deps.client.request as unknown as (args: { method: string; params: unknown[] }) => Promise<Hex>;
  const [nonce, gas, gasPrice, tip] = await Promise.all([
    deps.client.getTransactionCount({ address: from, blockTag: "pending" }),
    deps.client.estimateGas({ account: from, to: call.to, data, value: 0n, feeCurrency }),
    rpc({ method: "eth_gasPrice", params: [feeCurrency] }).then(BigInt),
    rpc({ method: "eth_maxPriorityFeePerGas", params: [feeCurrency] }).then(BigInt),
  ]);
  const tx = {
    type: "cip64" as const,
    chainId: 42220,
    nonce,
    to: call.to,
    data,
    value: 0n,
    gas: (gas * 12n) / 10n,
    maxFeePerGas: gasPrice * 2n,
    maxPriorityFeePerGas: tip,
    feeCurrency,
  };
  const signature = await deps.signer.signDigest(keccak256(serializeTransaction(tx)));
  const raw = serializeTransaction(tx, signature);
  return { hash: keccak256(raw), raw, nonce, feeToken };
}
