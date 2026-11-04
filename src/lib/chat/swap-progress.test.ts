import { describe, expect, it } from "vitest";
import type { ChatSwapStatus } from "@/lib/treasury/chat-swap";
import { CHAT_SWAP_KEY, pollDecision, resumeCardId, swapKeyStore, UNKNOWN_GRACE_MS } from "./swap-progress";

const ID = "0a1b2c3d-0000-4000-8000-0123456789ab";
const success: ChatSwapStatus = { state: "success", soldAtomic: "1", boughtAtomic: "2", from: "USDT", to: "WARS", txHash: "0xabc", turnedOff: false };

describe("pollDecision", () => {
  it("keeps polling while the swap runs, and clears the miss clock", () => {
    expect(pollDecision({ state: "running", stage: "price" }, { firstMissAt: 500, now: 4_000 })).toEqual({ kind: "continue", show: "price", firstMissAt: null });
    expect(pollDecision({ state: "confirming" }, { firstMissAt: null, now: 4_000 })).toEqual({ kind: "continue", show: "confirming", firstMissAt: null });
  });

  it("stops on a terminal status and clears the stored id", () => {
    expect(pollDecision(success, { firstMissAt: null, now: 1 })).toMatchObject({ kind: "stop", clearKey: true, terminal: { kind: "success" } });
    expect(pollDecision({ state: "refused", error: "swap_failed" }, { firstMissAt: null, now: 1 })).toEqual({
      kind: "stop",
      clearKey: true,
      terminal: { kind: "refused", error: "swap_failed" },
    });
  });

  it("waits through unknown answers, then reads them as unconfirmed after 30 s of misses", () => {
    const first = pollDecision({ state: "unknown" }, { firstMissAt: null, now: 10_000 });
    expect(first).toEqual({ kind: "continue", show: "waiting", firstMissAt: 10_000 });
    expect(pollDecision({ state: "unknown" }, { firstMissAt: 10_000, now: 10_000 + UNKNOWN_GRACE_MS })).toMatchObject({ kind: "continue" });
    expect(pollDecision({ state: "unknown" }, { firstMissAt: 10_000, now: 10_001 + UNKNOWN_GRACE_MS })).toEqual({
      kind: "stop",
      clearKey: true,
      terminal: { kind: "refused", error: "unconfirmed" },
    });
  });

  it("does not count time spent asleep: the first rejected read after a long gap only starts the clock", () => {
    // Running at t=0, the phone locks for two minutes, the first read on waking is rejected.
    const wake = pollDecision(null, { firstMissAt: null, now: 120_000 });
    expect(wake).toEqual({ kind: "continue", show: "waiting", firstMissAt: 120_000 });
    // The next read answers: the result arrives.
    expect(pollDecision(success, { firstMissAt: 120_000, now: 123_000 })).toMatchObject({ kind: "stop", terminal: { kind: "success" } });
  });

  it("treats a rejected read like unknown", () => {
    expect(pollDecision(null, { firstMissAt: 0, now: UNKNOWN_GRACE_MS + 1 })).toMatchObject({ kind: "stop" });
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
