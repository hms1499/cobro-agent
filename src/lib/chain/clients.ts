import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { attributionSuffix } from "./attribution";
import { feeCurrencyFor, type FeeToken } from "./tokens";

export function createCeloPublicClient(rpcUrl: string, transport?: Transport) {
  return createPublicClient({ chain: celo, transport: transport ?? http(rpcUrl) });
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
