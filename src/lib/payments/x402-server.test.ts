import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { buildInvoiceRoute, createResourceServer, processX402, requestContext } from "./x402-server";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const payerOf = (payload: PaymentPayload) => (payload.payload.authorization as { from: string }).from;

function fakeFacilitator() {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" as const }],
      extensions: ["eip2612GasSponsoring"],
      signers: {},
    }),
    verify: vi.fn(async (payload: PaymentPayload) => ({ isValid: true, payer: payerOf(payload) })),
    settle: vi.fn(async (payload: PaymentPayload) => ({
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:42220" as const,
      payer: payerOf(payload),
    })),
  } satisfies FacilitatorClient;
}

async function signedHeader(required: PaymentRequired) {
  const account = privateKeyToAccount(generatePrivateKey());
  const signer = toClientEvmSigner({
    address: account.address,
    signTypedData: (message) => account.signTypedData(message as Parameters<typeof account.signTypedData>[0]),
  });
  const client = new x402Client().register("eip155:42220", new ExactEvmScheme(signer)).setSpendControls(false);
  return { payer: account.address, header: encodePaymentSignatureHeader(await client.createPaymentPayload(required)) };
}

const usdtRoute = () => buildInvoiceRoute({ asset: "USDT", amountAtomic: 300_000000n, payTo: PAY_TO, description: "Cobro invoice abc" });
const request = (headers: Record<string, string> = {}) =>
  new Request("https://cobro.test/api/pay/abc?asset=USDT", { headers });

describe("buildInvoiceRoute", () => {
  it("prices EIP-3009 dollars with the token's EIP-712 domain", () => {
    expect(usdtRoute()).toEqual({
      accepts: {
        scheme: "exact",
        network: "eip155:42220",
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        price: { asset: TOKENS.USDT.address, amount: "300000000", extra: { name: "Tether USD", version: "1" } },
      },
      description: "Cobro invoice abc",
      mimeType: "application/json",
    });
  });

  it("routes pesos through Permit2 with gas-sponsored approval", () => {
    const route = buildInvoiceRoute({ asset: "WARS", amountAtomic: 5n, payTo: PAY_TO, description: "x" });
    expect(route.accepts).toMatchObject({
      price: { asset: TOKENS.WARS.address, amount: "5", extra: { name: "Peso Argentino", version: "1", assetTransferMethod: "permit2" } },
    });
    expect(Object.keys(route.extensions ?? {})).toEqual(["eip2612GasSponsoring"]);
  });
});

describe("requestContext", () => {
  it("reads the payment header and always asks for JSON (no HTML paywall)", () => {
    const context = requestContext(request({ "payment-signature": "abc", accept: "text/html" }));
    expect(context).toMatchObject({ path: "/api/pay/abc", method: "GET", paymentHeader: "abc" });
    expect(context.adapter.getAcceptHeader()).toBe("application/json");
    expect(requestContext(request({ "x-payment": "v1" })).paymentHeader).toBe("v1");
  });
});

describe("processX402", () => {
  it("answers an unpaid request with 402 and the exact invoice price", async () => {
    const server = createResourceServer(fakeFacilitator());
    await server.initialize();
    const { result, settle } = await processX402(server, usdtRoute(), request());
    expect(result.type).toBe("payment-error");
    if (result.type !== "payment-error") return;
    expect(result.response.status).toBe(402);
    const required = decodePaymentRequiredHeader(result.response.headers["PAYMENT-REQUIRED"]);
    expect(required.accepts[0]).toMatchObject({ amount: "300000000", payTo: PAY_TO, asset: TOKENS.USDT.address });
    await expect(settle()).rejects.toThrow(/verified/);
  });

  it("verifies a signed payment and settles it through the facilitator", async () => {
    const facilitator = fakeFacilitator();
    const server = createResourceServer(facilitator);
    await server.initialize();
    const first = await processX402(server, usdtRoute(), request());
    if (first.result.type !== "payment-error") throw new Error("expected 402");
    const { payer, header } = await signedHeader(decodePaymentRequiredHeader(first.result.response.headers["PAYMENT-REQUIRED"]));

    const paid = await processX402(server, usdtRoute(), request({ "payment-signature": header }));
    expect(paid.result.type).toBe("payment-verified");
    const settled = await paid.settle();
    expect(settled).toMatchObject({ kind: "settled", payer, transaction: `0x${"ab".repeat(32)}` });
    if (settled.kind === "settled") expect(Object.keys(settled.headers)).toContain("PAYMENT-RESPONSE");
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  async function verifiedExchange(facilitator: ReturnType<typeof fakeFacilitator>) {
    const server = createResourceServer(facilitator);
    await server.initialize();
    const first = await processX402(server, usdtRoute(), request());
    if (first.result.type !== "payment-error") throw new Error("expected 402");
    const { header } = await signedHeader(decodePaymentRequiredHeader(first.result.response.headers["PAYMENT-REQUIRED"]));
    const paid = await processX402(server, usdtRoute(), request({ "payment-signature": header }));
    expect(paid.result.type).toBe("payment-verified");
    return paid;
  }

  it("treats a facilitator verdict of failure as definite", async () => {
    const facilitator = fakeFacilitator();
    facilitator.settle.mockResolvedValueOnce({ success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:42220" } as never);
    const outcome = await (await verifiedExchange(facilitator)).settle();
    expect(outcome).toMatchObject({ kind: "failed", reason: "insufficient_funds", response: { status: 402 } });
  });

  it("never treats a thrown facilitator error as a definite failure", async () => {
    const facilitator = fakeFacilitator();
    facilitator.settle.mockRejectedValueOnce(new Error("Facilitator settle failed (502): <html>Bad Gateway</html>"));
    expect(await (await verifiedExchange(facilitator)).settle()).toMatchObject({ kind: "unknown" });
  });

  it("keeps a pending settlement that already has a transaction as unknown", async () => {
    const facilitator = fakeFacilitator();
    const pending = { success: false, errorReason: "settlement_pending", transaction: `0x${"cd".repeat(32)}`, network: "eip155:42220" } as never;
    facilitator.settle.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending);
    expect(await (await verifiedExchange(facilitator)).settle()).toMatchObject({ kind: "unknown" });
  });

  it("does not accept a signature made for a different price", async () => {
    const server = createResourceServer(fakeFacilitator());
    await server.initialize();
    const first = await processX402(server, usdtRoute(), request());
    if (first.result.type !== "payment-error") throw new Error("expected 402");
    const { header } = await signedHeader(decodePaymentRequiredHeader(first.result.response.headers["PAYMENT-REQUIRED"]));
    const repriced = buildInvoiceRoute({ asset: "USDT", amountAtomic: 299_000000n, payTo: PAY_TO, description: "x" });
    const { result } = await processX402(server, repriced, request({ "payment-signature": header }));
    expect(result.type).toBe("payment-error");
  });
});
