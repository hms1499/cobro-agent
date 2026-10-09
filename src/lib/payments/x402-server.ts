import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPProcessResult,
  type HTTPRequestContext,
  type RouteConfig,
} from "@x402/core/server";
import { SettleError, type SettleResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import type { Address } from "viem";
import { TOKENS } from "@/lib/chain/tokens";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import type { PayAsset } from "@/lib/money/currencies";
import { CELO_NETWORK, PAYMENT_TIMEOUT_SECONDS } from "./network";

export { PAYMENT_TIMEOUT_SECONDS };

/** Spec §8.2: explicit asset/amount prices; Permit2 tokens also declare EIP-2612 gas sponsoring. */
export function buildInvoiceRoute(input: {
  asset: PayAsset;
  amountAtomic: bigint;
  payTo: Address;
  description: string;
}): RouteConfig {
  const token = TOKENS[input.asset];
  const permit2 = token.transferMethod === "permit2";
  return {
    accepts: {
      scheme: "exact",
      network: CELO_NETWORK,
      payTo: input.payTo,
      maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
      price: {
        asset: token.address,
        amount: input.amountAtomic.toString(),
        extra: {
          name: token.eip712.name,
          version: token.eip712.version,
          ...(permit2 ? { assetTransferMethod: "permit2" } : {}),
        },
      },
    },
    description: input.description,
    mimeType: "application/json",
    ...(permit2 ? { extensions: declareEip2612GasSponsoringExtension() } : {}),
  };
}

export function celoFacilitator(opts: { url: string; apiKey: string }): FacilitatorClient {
  const headers = { "X-API-Key": opts.apiKey };
  return new HTTPFacilitatorClient({
    url: opts.url,
    timeoutMs: 60_000,
    createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),
  });
}

export function createResourceServer(facilitator: FacilitatorClient): x402ResourceServer {
  return new x402ResourceServer(facilitator).register(CELO_NETWORK, new ExactEvmScheme());
}

let ready: Promise<x402ResourceServer> | undefined;

/** One initialised server per instance (it fetches the facilitator's /supported once); retried after a failure. */
export function getResourceServer(): Promise<x402ResourceServer> {
  if (!ready) {
    const env = parseServerEnv();
    const server = createResourceServer(
      celoFacilitator({ url: env.X402_FACILITATOR_URL, apiKey: requireValue(env.X402_API_KEY, "X402_API_KEY") }),
    );
    ready = server.initialize().then(
      () => server,
      (error: unknown) => {
        ready = undefined;
        throw error;
      },
    );
  }
  return ready;
}

export function requestContext(request: Request): HTTPRequestContext {
  const url = new URL(request.url);
  const adapter: HTTPAdapter = {
    getHeader: (name) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    // Always JSON: /pay/[slug] is our payment UI, so x402's HTML paywall is never served.
    getAcceptHeader: () => "application/json",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
  };
  return {
    adapter,
    path: url.pathname,
    method: request.method,
    paymentHeader: adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment"),
  };
}

/**
 * What settling a verified payment came to. Only `failed` is a verdict the facilitator itself gave
 * that no transfer happened; everything else that is not `settled` is `unknown` and must keep the
 * invoice held, because the transfer may already be on its way.
 */
export type SettleOutcome =
  | { kind: "settled"; transaction: string; payer: string | undefined; headers: Record<string, string> }
  | { kind: "failed"; reason: string; response: { status: number; headers: Record<string, string>; body: unknown } }
  | { kind: "unknown"; reason: string };

export interface X402Exchange {
  result: HTTPProcessResult;
  /** Never throws for a settlement problem; throws only if the payment was not verified. */
  settle(): Promise<SettleOutcome>;
}

const SETTLEMENT_PENDING = "settlement_pending";

/** A definite failure carries the facilitator's own "no" and no transaction hash. */
function isDefiniteFailure(failure: { errorReason?: string; transaction?: string }): boolean {
  return !failure.transaction && failure.errorReason !== SETTLEMENT_PENDING;
}

/** Verifies (through the facilitator) without settling; the caller claims the invoice, then settles. */
export async function processX402(server: x402ResourceServer, route: RouteConfig, request: Request): Promise<X402Exchange> {
  const http = new x402HTTPResourceServer(server, route);
  const context = requestContext(request);
  const result = await http.processHTTPRequest(context);

  const failed = (failure: SettleResponse): SettleOutcome => {
    const reason = failure.errorReason || "settlement_failed";
    return {
      kind: "failed",
      reason,
      response: { status: 402, headers: http.createSettlementHeaders(failure), body: { error: reason } },
    };
  };

  return {
    result,
    settle: async () => {
      if (result.type !== "payment-verified") throw new Error("Only a verified payment can be settled");
      // Not http.processSettlement: it turns every thrown error (a gateway 502, a dropped connection)
      // into a plain failure, and a failure would reopen the invoice while the transfer may be in flight.
      try {
        const response = await server.settlePayment(
          result.paymentPayload,
          result.paymentRequirements,
          result.declaredExtensions,
          { request: context },
          undefined,
          "after-handler",
        );
        if (response.success) {
          if (!response.transaction) return { kind: "unknown", reason: "settled without a transaction hash" };
          return { kind: "settled", transaction: response.transaction, payer: response.payer, headers: http.createSettlementHeaders(response) };
        }
        return isDefiniteFailure(response) ? failed(response) : { kind: "unknown", reason: response.errorReason || "settlement pending" };
      } catch (error) {
        if (error instanceof SettleError && isDefiniteFailure(error)) {
          return failed({
            success: false,
            errorReason: error.errorReason || error.message,
            errorMessage: error.errorMessage,
            payer: error.payer,
            network: error.network,
            transaction: "",
          });
        }
        return { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
