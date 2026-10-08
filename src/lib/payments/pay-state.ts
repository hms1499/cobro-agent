import type { MessageKey } from "@/i18n";

export type PayBlocker = "no-wallet" | "connect" | "switch-network" | "expired" | "insufficient" | null;

const CELO_CHAIN_ID = 42220;

/** The first thing standing between the payer and the Pay button (spec §17.2 payment states). */
export function payBlocker(input: {
  hasInjectedWallet: boolean;
  address?: string;
  chainId?: number;
  balance?: bigint;
  amountAtomic?: bigint;
  expiresAt?: number;
  now: number;
}): PayBlocker {
  if (!input.hasInjectedWallet) return "no-wallet";
  if (!input.address) return "connect";
  if (input.chainId !== CELO_CHAIN_ID) return "switch-network";
  if (input.expiresAt !== undefined && input.now >= input.expiresAt) return "expired";
  if (input.balance !== undefined && input.amountAtomic !== undefined && input.balance < input.amountAtomic) {
    return "insufficient";
  }
  return null;
}

export function payErrorKey(status: number, body: unknown): MessageKey {
  const error = typeof body === "object" && body !== null && "error" in body ? String(body.error) : "";
  if (status === 409) return error === "busy" ? "pay.error.busy" : "pay.error.closed";
  if (status === 503) return error === "rates_unavailable" ? "pay.error.rates" : "pay.error.notReady";
  if (status === 502) return "pay.error.unknown";
  if (status === 402) return "pay.error.rejected";
  return "pay.error.generic";
}

const DECLINED_MESSAGE = /user rejected|user denied|rejected the request|denied (message|transaction) signature/i;
const CHANGED_MESSAGE = /filtered out by polic|rejected by spendControls|no payment requirements/i;

/**
 * Wallet libraries wrap errors, and @x402/fetch rethrows signing failures as
 * `new Error("Failed to create payment payload: <message>")` with no cause, so check the
 * cause chain (EIP-1193 code 4001) and the message text.
 */
export function payExceptionKind(error: unknown): "declined" | "changed" | "other" {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const e = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (e.name === "UserRejectedRequestError" || e.code === 4001) return "declined";
    if (typeof e.message === "string") {
      if (DECLINED_MESSAGE.test(e.message)) return "declined";
      if (CHANGED_MESSAGE.test(e.message)) return "changed";
    }
    current = e.cause;
  }
  return "other";
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
