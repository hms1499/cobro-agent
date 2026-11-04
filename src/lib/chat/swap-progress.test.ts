import { describe, expect, it } from "vitest";
import type { ChatSwapStatus } from "@/lib/treasury/chat-swap";
import { CHAT_SWAP_KEY, pollDecision, resumeCardId, swapKeyStore, UNKNOWN_GRACE_MS } from "./swap-progress";

const ID = "0a1b2c3d-0000-4000-8000-0123456789ab";
const success: ChatSwapStatus = { state: "success", soldAtomic: "1", boughtAtomic: "2", from: "USDT", to: "WARS", txHash: "0xabc", turnedOff: false };

describe("pollDecision", () => {
  const ctx = { lastActiveAt: 1_000, now: 4_000 };

  it("keeps polling while the swap runs, and restarts the unknown clock", () => {
    expect(pollDecision({ state: "running", stage: "price" }, ctx)).toEqual({ kind: "continue", show: "price", lastActiveAt: 4_000 });
    expect(pollDecision({ state: "confirming" }, ctx)).toEqual({ kind: "continue", show: "confirming", lastActiveAt: 4_000 });
  });

  it("stops on a terminal status and clears the stored id", () => {
    expect(pollDecision(success, ctx)).toMatchObject({ kind: "stop", clearKey: true, terminal: { kind: "success" } });
    expect(pollDecision({ state: "refused", error: "swap_failed" }, ctx)).toEqual({
      kind: "stop",
      clearKey: true,
      terminal: { kind: "refused", error: "swap_failed" },
    });
  });

  it("waits through an unknown answer, then reads it as unconfirmed after 30 s", () => {
    expect(pollDecision({ state: "unknown" }, { lastActiveAt: 1_000, now: 1_000 + UNKNOWN_GRACE_MS })).toMatchObject({ kind: "continue", show: "waiting", lastActiveAt: 1_000 });
    expect(pollDecision({ state: "unknown" }, { lastActiveAt: 1_000, now: 1_001 + UNKNOWN_GRACE_MS })).toEqual({
      kind: "stop",
      clearKey: true,
      terminal: { kind: "refused", error: "unconfirmed" },
    });
  });

  it("treats a rejected read like unknown, so one failed poll never ends a running swap", () => {
    expect(pollDecision(null, ctx)).toMatchObject({ kind: "continue", show: "waiting" });
    expect(pollDecision(null, { lastActiveAt: 0, now: UNKNOWN_GRACE_MS + 1 })).toMatchObject({ kind: "stop" });
  });
});

describe("resumeCardId", () => {
  it("prefers the server's active swap, then a well-formed stored id", () => {
    expect(resumeCardId(ID, "other")).toBe(ID);
    expect(resumeCardId(null, ID)).toBe(ID);
    expect(resumeCardId(null, "garbage")).toBeNull();
    expect(resumeCardId(null, null)).toBeNull();
  });
});

describe("swapKeyStore", () => {
  const fake = () => {
    const data = new Map<string, string>();
    return { data, storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } };
  };

  it("writes, reads and clears the card id, so a terminal status is not shown again after a reload", () => {
    const { data, storage } = fake();
    const store = swapKeyStore(() => storage);
    store.write(ID);
    expect(data.get(CHAT_SWAP_KEY)).toBe(ID);
    expect(resumeCardId(null, store.read())).toBe(ID);
    store.clear();
    expect(resumeCardId(null, store.read())).toBeNull();
  });

  it("never throws when storage is missing or blocked", () => {
    const blocked = swapKeyStore(() => {
      throw new Error("blocked");
    });
    expect(() => (blocked.write(ID), blocked.clear())).not.toThrow();
    expect(blocked.read()).toBeNull();
    expect(swapKeyStore(() => null).read()).toBeNull();
  });
});
