import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, fallback, http, type Address, type Hex, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { attributionSuffix } from "./attribution";
import { feeCurrencyFor, type FeeToken } from "./tokens";

/** Reads made in the same tick are batched into one Multicall3 call (a treasury's 5 balanceOf → 1 eth_call). */
export function createCeloPublicClient(rpcUrl: string, transport?: Transport) {
  return createPublicClient({ chain: celo, batch: { multicall: true }, transport: transport ?? http(rpcUrl) });
}

/**
 * For screens only (dashboard, rules preview, withdraw page): moves to the next RPC when one fails.
 * Never use it on a money path. A lagging fallback node can show a stale balance or allowance, and a
 * swap or withdrawal built on it reverts.
 */
export function createCeloDisplayClient(rpcUrls: readonly string[], transport?: Transport) {
  return createPublicClient({
    chain: celo,
    batch: { multicall: true },
    transport: transport ?? fallback(rpcUrls.map((url) => http(url))),
  });
}

/** Wallet client whose sendTransaction and writeContract always carry our attribution tag. */
export function createOperatorClient(opts: {
  privateKey: Hex;
  attributionCode: string;
  rpcUrl: string;
  transport?: Transport;
}) {
  attributionSuffix(opts.attributionCode); // validates the code before any client exists
  const account = privateKeyToAccount(opts.privateKey);
  return createWalletClient({ account, chain: celo, transport: opts.transport ?? http(opts.rpcUrl) }).extend(
    withAttribution(opts.attributionCode),
  );
}

/** Spread into sendTransaction/writeContract so gas is paid in the configured token. */
export function operatorSendParams(feeToken: FeeToken): { feeCurrency?: Address } {
  const feeCurrency = feeCurrencyFor(feeToken);
  return feeCurrency ? { feeCurrency } : {};
}
