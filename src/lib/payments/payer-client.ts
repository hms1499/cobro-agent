import { x402Client } from "@x402/core/client";
import type { ClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { Address } from "viem";
import { CELO_NETWORK } from "./network";

export interface ExpectedPayment {
  asset: Address;
  amountAtomic: bigint;
  payTo: Address;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * An x402 client that signs one payment only: this token, this amount, to this treasury wallet.
 * The stock client caps payments at $1 (spendControls); the cap is lifted for this asset and amount only.
 */
export function createInvoicePayerClient(signer: ClientEvmSigner, expected: ExpectedPayment): x402Client {
  const amount = expected.amountAtomic.toString();
  return new x402Client()
    .register(CELO_NETWORK, new ExactEvmScheme(signer))
    .setSpendControls({
      maxAmountPerPayment: false,
      allowedAssets: [{ network: CELO_NETWORK, asset: expected.asset, maxAmountPerPayment: amount }],
    })
    .registerPolicy((_version, requirements) =>
      requirements.filter(
        (r) => r.network === CELO_NETWORK && same(r.asset, expected.asset) && r.amount === amount && same(r.payTo, expected.payTo),
      ),
    );
}

export function createInvoicePayerFetch(
  signer: ClientEvmSigner,
  expected: ExpectedPayment,
  opts: { onSigned?: () => void } = {},
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const client = createInvoicePayerClient(signer, expected);
  if (opts.onSigned) {
    const onSigned = opts.onSigned;
    client.onAfterPaymentCreation(async () => onSigned());
  }
  return wrapFetchWithPayment(globalThis.fetch.bind(globalThis), client);
}
