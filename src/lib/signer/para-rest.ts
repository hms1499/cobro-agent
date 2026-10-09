import type { Address, Hex } from "viem";
import { withHexPrefix } from "./signature";

export interface ParaWallet {
  id: string;
  type: string;
  status: "creating" | "ready";
  address?: Address;
  publicKey?: string;
  userIdentifier?: string;
  userIdentifierType?: string;
}

/** Para's EvmTransaction: only legacy (0) and EIP-1559 (2); numbers as decimal or 0x strings. */
export interface ParaEvmTransaction {
  to: Address;
  chainId: number;
  type: 0 | 2;
  value?: string;
  data?: Hex;
  nonce?: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

/** EIP-712 typed data without EIP712Domain in `types`; values must be JSON-safe (see toJsonSafe). */
export interface ParaTypedData {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export class ParaRestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ParaRestError";
  }
}

export interface ParaRestClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
}

export class ParaRestClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ParaRestClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  createWallet(userId: string): Promise<ParaWallet> {
    return this.request<ParaWallet>("POST", "/v1/wallets", {
      type: "EVM",
      userIdentifier: userId,
      userIdentifierType: "CUSTOM_ID",
    });
  }

  /** Looks up the EVM wallet created for a CUSTOM_ID (GET /v1/wallets filters), or null when none exists. */
  async findWalletByCustomId(userId: string): Promise<ParaWallet | null> {
    const query = new URLSearchParams({ userIdentifier: userId, userIdentifierType: "CUSTOM_ID", type: "EVM", limit: "1" });
    const result = await this.request<{ data?: ParaWallet[] }>("GET", `/v1/wallets?${query}`);
    return result.data?.[0] ?? null;
  }

  getWallet(walletId: string): Promise<ParaWallet> {
    return this.request<ParaWallet>("GET", `/v1/wallets/${encodeURIComponent(walletId)}`);
  }

  async waitUntilReady(walletId: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<ParaWallet> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const wallet = await this.getWallet(walletId);
      if (wallet.status === "ready" && wallet.address) return wallet;
      if (Date.now() >= deadline) throw new Error(`Para wallet ${walletId} not ready after ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async signTransaction(walletId: string, transaction: ParaEvmTransaction, idempotencyKey?: string): Promise<Hex> {
    const result = await this.request<{ signedTransaction: string }>(
      "POST",
      `/v1/wallets/${encodeURIComponent(walletId)}/sign-transaction`,
      { transaction },
      idempotencyKey,
    );
    return withHexPrefix(result.signedTransaction);
  }

  async signTypedData(walletId: string, typedData: ParaTypedData): Promise<Hex> {
    const result = await this.request<{ signature: string }>(
      "POST",
      `/v1/wallets/${encodeURIComponent(walletId)}/sign-typed-data`,
      { typedData },
    );
    return withHexPrefix(result.signature);
  }

  async signRaw(walletId: string, data: Hex): Promise<Hex> {
    const result = await this.request<{ signature: string }>(
      "POST",
      `/v1/wallets/${encodeURIComponent(walletId)}/sign-raw`,
      { data },
    );
    return withHexPrefix(result.signature);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      "X-API-Key": this.options.apiKey,
      "X-Request-Id": crypto.randomUUID(),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: { code?: string; message?: string } | undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      throw new ParaRestError(
        response.status,
        json?.code,
        `Para ${method} ${path} failed with ${response.status}: ${json?.message ?? text}`,
      );
    }
    return json as T;
  }
}
