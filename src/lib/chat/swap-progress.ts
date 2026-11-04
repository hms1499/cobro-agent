import type { ChatSwapError, ChatSwapStatus } from "@/lib/treasury/chat-swap";

/** Spec §5.1: the card id of a swap in progress, kept so a reload can pick it up. */
export const CHAT_SWAP_KEY = "cobro.chatSwap";
/** How long "unknown" is believed to be a swap that has not shown yet before it reads as unconfirmed. */
export const UNKNOWN_GRACE_MS = 30_000;
export const POLL_MS = 3_000;

type Stored = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage can be missing or throw (private window, blocked data); the page must work without it. */
export function swapKeyStore(storage: () => Stored | null) {
  const guard = <T>(run: (s: Stored) => T, fallback: T): T => {
    try {
      const s = storage();
      return s ? run(s) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    read: () => guard((s) => s.getItem(CHAT_SWAP_KEY), null),
    write: (cardId: string) => guard((s) => (s.setItem(CHAT_SWAP_KEY, cardId), undefined), undefined),
    clear: () => guard((s) => (s.removeItem(CHAT_SWAP_KEY), undefined), undefined),
  };
}

const CARD_ID_SHAPE = /^[0-9a-f-]{36}$/;

/** On mount: the server's active swap wins; otherwise a stored id of the right shape. */
export function resumeCardId(activeCardId: string | null, stored: string | null): string | null {
  if (activeCardId) return activeCardId;
  return stored && CARD_ID_SHAPE.test(stored) ? stored : null;
}

export type Terminal =
  | { kind: "success"; status: Extract<ChatSwapStatus, { state: "success" }> }
  | { kind: "refused"; error: ChatSwapError };

export type PollDecision =
  | { kind: "continue"; show: "price" | "preparing" | "swapping" | "confirming" | "waiting"; lastActiveAt: number }
  | { kind: "stop"; terminal: Terminal; clearKey: true };

/**
 * What to do with one poll answer. `status` is null when the read itself was rejected. A rejected read counts as
 * "unknown": it keeps polling, and only 30 s without any sign of the swap reads as unconfirmed (never as a failure,
 * since the swap may still land). A terminal answer stops the polling and clears the stored id, so it shows once.
 */
export function pollDecision(status: ChatSwapStatus | null, ctx: { lastActiveAt: number; now: number }): PollDecision {
  if (status?.state === "success") return { kind: "stop", terminal: { kind: "success", status }, clearKey: true };
  if (status?.state === "refused") return { kind: "stop", terminal: { kind: "refused", error: status.error }, clearKey: true };
  if (status?.state === "running") return { kind: "continue", show: status.stage, lastActiveAt: ctx.now };
  if (status?.state === "confirming") return { kind: "continue", show: "confirming", lastActiveAt: ctx.now };
  if (ctx.now - ctx.lastActiveAt > UNKNOWN_GRACE_MS) {
    return { kind: "stop", terminal: { kind: "refused", error: "unconfirmed" }, clearKey: true };
  }
  return { kind: "continue", show: "waiting", lastActiveAt: ctx.lastActiveAt };
}
