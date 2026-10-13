// src/lib/treasury/repo.test.ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { fxIntents, rules, treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { ConvertDecision } from "./engine";
import {
  acquireWalletLock,
  filledUsdWad24h,
  insertTrade,
  lastEvent,
  listEvents,
  listTreasuryUsers,
  loadTreasuryContext,
  logEvent,
  openIntent,
  pendingTreasuryTxs,
  recordTreasuryTx,
  releaseWalletLock,
  saveIntent,
  settleTreasuryTx,
} from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);
const walletOf = async (userId: string) =>
  (await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, userId)))[0];
const decision = (amount: bigint, to: "USDT" | "USAT" = "USDT"): ConvertDecision => ({
  kind: "convert",
  from: "WARS",
  to,
  amount,
  usdWad: 1n,
  reason: "save_excess",
});

describe("wallet locks", () => {
  it("lets one holder in at a time and takes over an expired lock", async () => {
    const wallet = await walletOf((await seedFreelancer(db)).id);
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    expect(await acquireWalletLock(db, wallet.id, a, NOW)).toBe(true);
    expect(await acquireWalletLock(db, wallet.id, b, minutes(1))).toBe(false);
    expect(await acquireWalletLock(db, wallet.id, b, minutes(6))).toBe(true);
    await releaseWalletLock(db, wallet.id, a); // a no longer holds it: nothing happens
    expect(await acquireWalletLock(db, wallet.id, c, minutes(7))).toBe(false);
    await releaseWalletLock(db, wallet.id, b);
    expect(await acquireWalletLock(db, wallet.id, c, minutes(7))).toBe(true);
  });
});

describe("treasury context", () => {
  it("loads a ready, onboarded user and lists the ones the agent runs for", async () => {
    const user = await seedFreelancer(db);
    const paused = await seedFreelancer(db);
    await db.update(rules).set({ enabled: false }).where(eq(rules.userId, paused.id));
    await seedFreelancer(db, { treasuryAddress: null });

    expect(await loadTreasuryContext(db, user.id)).toMatchObject({
      userId: user.id,
      address: TEST_TREASURY,
      paraWalletId: "para-wallet-1",
      personalWallet: null,
      rules: { localCurrency: "ARS", enabled: true },
    });
    expect(await listTreasuryUsers(db)).toEqual([user.id]);
  });
});

describe("intents", () => {
  it("creates, keeps (with its age) and replaces the open intent", async () => {
    const user = await seedFreelancer(db);
    const first = await saveIntent(db, user.id, { action: "convert", keep: null, cancel: null, decision: decision(10n) }, NOW);
    expect(first).toMatchObject({ status: "waiting", amountAtomic: "10", createdAt: NOW });

    const kept = await saveIntent(db, user.id, { action: "convert", keep: first.id, cancel: null, decision: decision(20n) }, minutes(10));
    expect(kept).toMatchObject({ id: first.id, amountAtomic: "20", createdAt: NOW });

    const replaced = await saveIntent(
      db,
      user.id,
      { action: "convert", keep: null, cancel: first.id, decision: decision(30n, "USAT") },
      minutes(20),
    );
    expect(replaced.id).not.toBe(first.id);
    expect((await db.select().from(fxIntents).where(eq(fxIntents.id, first.id)))[0].status).toBe("cancelled");
    expect((await openIntent(db, user.id))?.id).toBe(replaced.id);
  });
});

describe("filledUsdWad24h", () => {
  it("adds swaps broadcast or filled in the last 24 hours", async () => {
    const user = await seedFreelancer(db);
    const trade = { userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1" } as const;
    await insertTrade(db, { ...trade, status: "broadcast", notionalUsdCents: 150, createdAt: minutes(-60) });
    await insertTrade(db, { ...trade, status: "filled", notionalUsdCents: 250, createdAt: minutes(-120) });
    await insertTrade(db, { ...trade, status: "failed", notionalUsdCents: 999, createdAt: minutes(-60) });
    await insertTrade(db, { ...trade, status: "filled", notionalUsdCents: 1_000, createdAt: minutes(-25 * 60) });
    expect(await filledUsdWad24h(db, user.id, NOW)).toBe(4n * 10n ** 18n);
  });
});

describe("events and treasury transactions", () => {
  it("lists events newest first", async () => {
    const user = await seedFreelancer(db);
    await logEvent(db, user.id, "dry_run", { amount: "1" }, NOW);
    await logEvent(db, user.id, "converted", { amount: "2" }, minutes(5));
    expect((await listEvents(db, user.id)).map((e) => e.type)).toEqual(["converted", "dry_run"]);
  });

  it("finds the last event of one type, newest first and then by id", async () => {
    const user = await seedFreelancer(db);
    expect(await lastEvent(db, user.id, "dry_run")).toBeNull();
    await logEvent(db, user.id, "dry_run", { n: 1 }, NOW);
    await logEvent(db, user.id, "dry_run", { n: 2 }, minutes(5));
    await logEvent(db, user.id, "converted", { n: 3 }, minutes(10));
    expect((await lastEvent(db, user.id, "dry_run"))?.data).toEqual({ n: 2 });
    await logEvent(db, user.id, "dry_run", { n: 4 }, minutes(20));
    await logEvent(db, user.id, "dry_run", { n: 5 }, minutes(20));
    const tied = await listEvents(db, user.id);
    const highestId = tied.filter((e) => e.createdAt.getTime() === minutes(20).getTime()).map((e) => e.id).sort().at(-1);
    expect((await lastEvent(db, user.id, "dry_run"))?.id).toBe(highestId);
  });

  it("keeps transactions pending until settled, in nonce order", async () => {
    const user = await seedFreelancer(db);
    const tx = { userId: user.id, kind: "approve", raw: "0x00", feeToken: "USDT" } as const;
    await recordTreasuryTx(db, { ...tx, nonce: 2, hash: "0xb" });
    await recordTreasuryTx(db, { ...tx, nonce: 1, hash: "0xa" });
    expect((await pendingTreasuryTxs(db, user.id)).map((t) => t.hash)).toEqual(["0xa", "0xb"]);
    await settleTreasuryTx(db, "0xa", "success", NOW);
    expect((await pendingTreasuryTxs(db, user.id)).map((t) => t.hash)).toEqual(["0xb"]);
  });
});
