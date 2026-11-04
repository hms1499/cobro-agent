import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import { rules } from "@/lib/db/schema";
import { chatGate, startChatSwapRequest } from "./gate";
import { chatReply, type ReplyIo } from "./reply";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const CARD = "3f0c1a52-7d4e-4b6a-9c11-2e5f8a7b6c01";
const good = { from: "WARS", to: "USDT", amountAtomic: "3200000000000000000000", cardId: CARD, seenTurnsOff: false };
const on = { enabled: true, dryRun: false };

/** The balances reply, the path where the gate is the only Paused check. */
function spyIo() {
  const displayBalances = vi.fn(async () => ({ USAT: "0.00", USDT: "1.00", WARS: "0.00", WBRL: "0.00" }));
  const preview = vi.fn(async () => ({
    cardId: CARD, from: "USDT", to: "WARS", amountAtomic: "1", buyAtomic: "1", limited: null, turnsOff: false, losesProposal: false, nextDailyAt: null,
  }) as never);
  const io: ReplyIo = { balances: vi.fn(async () => ({}) as never), rates: vi.fn(async () => ({}) as never), displayBalances, preview, interpret: async () => null };
  return { io, displayBalances, preview };
}

async function answer(deps: Parameters<typeof chatGate>[0], userId: string, text: string, io: ReplyIo) {
  const open = await chatGate(deps, userId);
  return "reply" in open ? open.reply : chatReply(text, io);
}

describe("chat is refused server-side", () => {
  it("answers paused with no balance read while the agent is Paused", async () => {
    const user = await seedFreelancer(db);
    await db.update(rules).set({ enabled: false }).where(eq(rules.userId, user.id));
    const { io, displayBalances } = spyIo();
    expect(await answer({ db, flags: on }, user.id, "what do i have?", io)).toEqual({ kind: "paused" });
    expect(displayBalances).not.toHaveBeenCalled();
  });

  it("answers paused with no balance read while the treasury is switched off", async () => {
    const user = await seedFreelancer(db);
    const { io, displayBalances } = spyIo();
    expect(await answer({ db, flags: { enabled: false, dryRun: false } }, user.id, "what do i have?", io)).toEqual({ kind: "paused" });
    expect(displayBalances).not.toHaveBeenCalled();
  });

  it("still shows the card in dry run, and refuses at the tap", async () => {
    const user = await seedFreelancer(db);
    const dry = { db, flags: { enabled: true, dryRun: true } };
    const { io, preview } = spyIo();
    io.balances = async () => ({ USDT: 50_000_000n, USAT: 0n, WARS: 0n, WBRL: 0n, USDC: 0n });
    io.rates = async () => ({ perUsd: { ARS: 1600n * 10n ** 18n, BRL: 5n * 10n ** 18n }, fetchedAt: 0 }) as never;
    expect((await answer(dry, user.id, "swap 25 usdt to wars", io)).kind).toBe("card");
    expect(preview).toHaveBeenCalled();
    const schedule = vi.fn();
    expect(await startChatSwapRequest(dry, user.id, good, schedule)).toEqual({ started: false, error: "dry_run" });
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("startChatSwapRequest", () => {
  it("schedules the swap once every check passes", async () => {
    const user = await seedFreelancer(db);
    const schedule = vi.fn();
    expect(await startChatSwapRequest({ db, flags: on }, user.id, good, schedule)).toEqual({ started: true });
    expect(schedule).toHaveBeenCalledWith({ from: "WARS", to: "USDT", amount: 3200n * 10n ** 18n, cardId: CARD, seenTurnsOff: false });
  });

  it.each([
    ["from", { from: "ETH" }],
    ["to", { to: "usdt" }],
    ["amountAtomic (decimal)", { amountAtomic: "1.5" }],
    ["amountAtomic (number)", { amountAtomic: 5 }],
    ["amountAtomic (negative)", { amountAtomic: "-1" }],
    ["cardId (uppercase)", { cardId: CARD.toUpperCase() }],
    ["cardId (not a uuid)", { cardId: "x'; drop table" }],
    ["seenTurnsOff", { seenTurnsOff: "yes" }],
  ])("refuses an invalid %s and schedules nothing", async (_name, patch) => {
    const user = await seedFreelancer(db);
    const schedule = vi.fn();
    expect(await startChatSwapRequest({ db, flags: on }, user.id, { ...good, ...patch }, schedule)).toEqual({ started: false, error: "changed" });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("refuses a Paused agent and a switched-off treasury at the tap", async () => {
    const user = await seedFreelancer(db);
    const schedule = vi.fn();
    expect(await startChatSwapRequest({ db, flags: { enabled: false, dryRun: false } }, user.id, good, schedule)).toEqual({ started: false, error: "disabled" });
    await db.update(rules).set({ enabled: false }).where(eq(rules.userId, user.id));
    expect(await startChatSwapRequest({ db, flags: on }, user.id, good, schedule)).toEqual({ started: false, error: "paused" });
    expect(schedule).not.toHaveBeenCalled();
  });
});
