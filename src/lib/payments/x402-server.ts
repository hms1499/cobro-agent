import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPProcessResult,
  type HTTPRequestContext,
  type ProcessSettleResultResponse,
  type RouteConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import type { Address } from "viem";
import { TOKENS } from "@/lib/chain/tokens";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import type { PayAsset } from "@/lib/money/currencies";
import { CELO_NETWORK } from "./network";

/** How long a signed authorization stays valid for settlement. */
export const PAYMENT_TIMEOUT_SECONDS = 300;

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

export interface X402Exchange {
  result: HTTPProcessResult;
  settle(): Promise<ProcessSettleResultResponse>;
}

/** Verifies (through the facilitator) without settling; the caller claims the invoice, then settles. */
export async function processX402(server: x402ResourceServer, route: RouteConfig, request: Request): Promise<X402Exchange> {
  const http = new x402HTTPResourceServer(server, route);
  const context = requestContext(request);
  const result = await http.processHTTPRequest(context);
  return {
    result,
    settle: async () => {
      if (result.type !== "payment-verified") throw new Error("Only a verified payment can be settled");
      return http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, {
        request: context,
      });
    },
  };
}
