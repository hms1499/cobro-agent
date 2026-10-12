// src/lib/fx/rfq.ts
import { getAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";

export const CELO_CHAIN_ID = 42220;
/** Textile blocks up to ~70 s on a cold corridor; "set a client timeout above that (75s)". */
export const RFQ_TIMEOUT_MS = 75_000;

/**
 * Spec §8.3: the EIP-712 proof that we control `taker`. Textile accepts it only while issuedAt is
 * within 60 s of its clock, so the executor signs a fresh one for every request.
 */
export function takerControlTypedData(taker: Address, nonce: Hex, issuedAt: number) {
  return {
    domain: { name: "Textile Taker Control", version: "1", chainId: CELO_CHAIN_ID },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker, chainId: BigInt(CELO_CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  } as const;
}

export interface TakerProof {
  nonce: Hex;
  issuedAt: number;
  signature: Hex;
}

export interface FirmQuote {
  rfqId: string;
  /** Returned once; the only credential for cancel and submit without a partner key. */
  claimToken: string;
  sellAmount: bigint;
  buyAmount: bigint;
  feeAmount: bigint;
  /** What leaves the taker's wallet, fee included. Approve at least this. */
  takerPays: bigint;
  expiresAt: Date;
  /** The contract to approve and call; the reactor unless the venue routed through a vault executor. */
  spender: Address;
  taker: Address;
  swap: { to: Address; data: Hex; value: bigint; chainId: number };
}

export type RfqOutcome =
  | { status: "quoted"; quote: FirmQuote }
  | { status: "no_quote"; reason: string; retryAfterMs: number | null };

export class TextileError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "TextileError";
  }
}

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => getAddress(value));
const hexData = z
  .string()
  .refine((value) => isHex(value), "not hex")
  .transform((value) => value as Hex);
const units = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => BigInt(value));
const instant = z
  .string()
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), "not a date");

const quotedSchema = z.object({
  data: z.object({
    rfqId: z.string().min(1),
    claimToken: z.string().min(1),
    status: z.literal("quoted"),
    quote: z.object({
      sellAmount: units,
      buyAmount: units,
      feeAmount: units,
      takerPays: units,
      expiresAt: instant,
      reactor: address,
      spender: address.optional(),
      taker: address,
    }),
    transactions: z.object({
      swap: z.object({ to: address, data: hexData, value: units, chainId: z.number().int() }),
    }),
  }),
});

const noQuoteSchema = z.object({
  data: z.object({
    status: z.literal("no_quote"),
    reason: z.string().optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    details: z.object({ reason: z.string().optional() }).optional(),
  }),
});

/** Textile RFQ v2, called keyless with a taker proof (spec §8.3). */
export class TextileRfqClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
  }

  async request(input: {
    sellToken: Address;
    buyToken: Address;
    sellAmount: bigint;
    taker: Address;
    takerProof: TakerProof;
  }): Promise<RfqOutcome> {
    const json = await this.call("POST", "/v2/rfq/request", {
      chainId: CELO_CHAIN_ID,
      sellToken: input.sellToken,
      buyToken: input.buyToken,
      sellAmount: input.sellAmount.toString(),
      taker: input.taker,
      takerProof: input.takerProof,
    });
    const quoted = quotedSchema.safeParse(json);
    if (quoted.success) {
      const { rfqId, claimToken, quote, transactions } = quoted.data.data;
      return {
        status: "quoted",
        quote: {
          rfqId,
          claimToken,
          sellAmount: quote.sellAmount,
          buyAmount: quote.buyAmount,
          feeAmount: quote.feeAmount,
          takerPays: quote.takerPays,
          expiresAt: quote.expiresAt,
          spender: quote.spender ?? quote.reactor,
          taker: quote.taker,
          swap: transactions.swap,
        },
      };
    }
    const noQuote = noQuoteSchema.safeParse(json);
    if (noQuote.success) {
      return {
        status: "no_quote",
        reason: noQuote.data.data.reason ?? "no_valid_quote",
        retryAfterMs: noQuote.data.data.retryAfterMs ?? null,
      };
    }
    throw new TextileError(200, "malformed_response", "Textile returned an RFQ outcome we cannot read");
  }

  async cancel(rfqId: string, claimToken: string): Promise<void> {
    await this.call("POST", `/v2/rfq/${encodeURIComponent(rfqId)}/cancel`, undefined, claimToken);
  }

  async submit(rfqId: string, claimToken: string, txHash: Hex): Promise<void> {
    await this.call("POST", `/v2/rfq/${encodeURIComponent(rfqId)}/submit`, { txHash }, claimToken);
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown, claimToken?: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (claimToken) headers["X-Rfq-Claim"] = claimToken;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? RFQ_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TextileError(0, "network", `Textile ${path} unreachable: ${error instanceof Error ? error.message : error}`);
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      const error = parsed.success ? parsed.data.error : undefined;
      throw new TextileError(
        response.status,
        error?.details?.reason ?? error?.code,
        `Textile ${method} ${path} failed with ${response.status}: ${error?.message ?? "no message"}`,
      );
    }
    return json;
  }
}
