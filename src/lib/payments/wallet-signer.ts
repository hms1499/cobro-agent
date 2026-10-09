import { toClientEvmSigner, type ClientEvmSigner } from "@x402/evm";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";

/** The connected browser wallet as an x402 signer. Reads are used for Permit2 allowance checks (wARS, wBRL). */
export function toX402Signer(
  walletClient: WalletClient<Transport, Chain, Account>,
  publicClient: Pick<PublicClient, "readContract">,
): ClientEvmSigner {
  return toClientEvmSigner(
    {
      address: walletClient.account.address,
      signTypedData: (message) =>
        walletClient.signTypedData({
          account: walletClient.account,
          ...(message as Omit<Parameters<typeof walletClient.signTypedData>[0], "account">),
        } as Parameters<typeof walletClient.signTypedData>[0]),
    },
    { readContract: (args) => publicClient.readContract(args as Parameters<PublicClient["readContract"]>[0]) },
  );
}
