import type { PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { createInvoicePayerClient } from "./payer-client";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const account = privateKeyToAccount(generatePrivateKey());
const signer = toClientEvmSigner({
  address: account.address,
  signTypedData: (message) => account.signTypedData(message as Parameters<typeof account.signTypedData>[0]),
});

function required(overrides: { amount?: string; payTo?: string; asset?: string } = {}): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: "https://cobro.test/api/pay/abc?asset=USDT" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:42220",
        asset: overrides.asset ?? TOKENS.USDT.address,
        amount: overrides.amount ?? "300000000",
        payTo: overrides.payTo ?? PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { name: "Tether USD", version: "1" },
      },
    ],
  };
}

const client = () => createInvoicePayerClient(signer, { asset: TOKENS.USDT.address, amountAtomic: 300_000000n, payTo: PAY_TO });

describe("createInvoicePayerClient", () => {
  it("signs a real invoice amount that the stock client's $1 cap would refuse", async () => {
    const payload = await client().createPaymentPayload(required());
    expect(payload.accepted.amount).toBe("300000000");
    expect(Object.keys(payload.payload)).toEqual(expect.arrayContaining(["authorization", "signature"]));
  });

  it("refuses any other amount, recipient or token", async () => {
    await expect(client().createPaymentPayload(required({ amount: "300000001" }))).rejects.toThrow();
    await expect(client().createPaymentPayload(required({ payTo: "0x2222222222222222222222222222222222222222" }))).rejects.toThrow();
    await expect(client().createPaymentPayload(required({ asset: TOKENS.USAT.address }))).rejects.toThrow();
  });
});
