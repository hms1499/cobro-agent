// src/lib/treasury/repo.test.ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { fxIntents, rules, treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { ConvertDecision, IntentPlan } from "./engine";
import {
  acquireWalletLock,
  approveProposal,
  cancelProposals,
  dismissedRecently,
  dismissProposal,
  filledUsdWad24h,
  inheritableApproval,
  insertTrade,
  lastEvent,
  listEvents,
  listTreasuryUsers,
  loadTreasuryContext,
  logEvent,
  openIntent,
  openProposal,
  pendingTreasuryTxs,
  proposeIntent,
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

describe("trade approvals schema", () => {
  it("gives new rules the sell_usd approval mode", async () => {
    const user = await seedFreelancer(db);
    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(row.approvalMode).toBe("sell_usd");
  });

  it("allows one open intent per user, a proposal included", async () => {
    const user = await seedFreelancer(db);
    const base = { userId: user.id, fromAsset: "USDT" as const, toAsset: "WARS" as const, amountAtomic: "1000000", reason: "top_up" as const };
    await db.insert(fxIntents).values({ ...base, status: "proposed" });
    await expect(db.insert(fxIntents).values({ ...base, status: "waiting" })).rejects.toThrow();
    await db.insert(fxIntents).values({ ...base, status: "cancelled", dismissedAt: NOW });
  });

  it("lets one intent inherit a given approval only once", async () => {
    const user = await seedFreelancer(db);
    const base = { userId: user.id, amountAtomic: "1000000", status: "filled" as const };
    const [hub] = await db
      .insert(fxIntents)
      .values({ ...base, fromAsset: "USAT", toAsset: "USDT", reason: "hub_route", approvedAt: NOW, approvedAmountAtomic: "1000000" })
      .returning();
    await db.insert(fxIntents).values({ ...base, fromAsset: "USDT", toAsset: "WARS", reason: "top_up", approvedVia: hub.id });
    await expect(
      db.insert(fxIntents).values({ ...base, fromAsset: "USDT", toAsset: "WARS", reason: "top_up", approvedVia: hub.id }),
    ).rejects.toThrow();
  });
});

const topUp = (amount: bigint): ConvertDecision => ({ kind: "convert", from: "USDT", to: "WARS", amount, usdWad: 0n, reason: "top_up" });
const newPlan = (d: ConvertDecision): Extract<IntentPlan, { action: "convert" }> => ({ action: "convert", keep: null, cancel: null, decision: d });
const keepPlan = (id: string, d: ConvertDecision): Extract<IntentPlan, { action: "convert" }> => ({ action: "convert", keep: id, cancel: null, decision: d });

describe("proposals", () => {
  it("proposes, keeps the id when the amount changes, and is the open intent", async () => {
    const user = await seedFreelancer(db);
    const first = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    const again = await proposeIntent(db, user.id, keepPlan(first.id, topUp(3_000_000n)), minutes(10));
    expect(again).toMatchObject({ id: first.id, status: "proposed", amountAtomic: "3000000", approvedAt: null });
    expect((await openIntent(db, user.id))?.id).toBe(first.id);
    expect((await openProposal(db, user.id))?.id).toBe(first.id);
  });

  it("approves at most the amount the freelancer saw (never raises the cap)", async () => {
    const user = await seedFreelancer(db);
    const proposal = await proposeIntent(db, user.id, newPlan(topUp(3_000_000n)), NOW);
    const approved = await approveProposal(db, user.id, proposal.id, 2_100_000n, minutes(5));
    expect(approved).toMatchObject({ status: "waiting", amountAtomic: "2100000", approvedAmountAtomic: "2100000", approvedAt: minutes(5) });

    const other = await seedFreelancer(db);
    const small = await proposeIntent(db, other.id, newPlan(topUp(1_500_000n)), NOW);
    expect((await approveProposal(db, other.id, small.id, 9_000_000n, NOW))?.approvedAmountAtomic).toBe("1500000");
  });

  it("refuses to approve someone else's proposal, or one already handled", async () => {
    const owner = await seedFreelancer(db);
    const stranger = await seedFreelancer(db);
    const proposal = await proposeIntent(db, owner.id, newPlan(topUp(2_000_000n)), NOW);
    expect(await approveProposal(db, stranger.id, proposal.id, 2_000_000n, NOW)).toBeNull();
    expect(await approveProposal(db, owner.id, proposal.id, 2_000_000n, NOW)).not.toBeNull();
    expect(await approveProposal(db, owner.id, proposal.id, 2_000_000n, NOW)).toBeNull();
    expect(await dismissProposal(db, owner.id, proposal.id, NOW)).toBeNull();
  });

  it("dismisses with a timestamp, and pausing cancels without one", async () => {
    const user = await seedFreelancer(db);
    const first = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    expect(await dismissProposal(db, user.id, first.id, NOW)).toMatchObject({ status: "cancelled", dismissedAt: NOW });
    expect(await dismissedRecently(db, user.id, ["top_up", "hub_route"], minutes(60))).toBe(true);
    expect(await dismissedRecently(db, user.id, ["save_excess", "save_other"], minutes(60))).toBe(false);
    expect(await dismissedRecently(db, user.id, ["top_up", "hub_route"], minutes(24 * 60))).toBe(false);

    const second = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), minutes(1));
    await cancelProposals(db, user.id, minutes(2));
    const [row] = await db.select().from(fxIntents).where(eq(fxIntents.id, second.id));
    expect(row).toMatchObject({ status: "cancelled", dismissedAt: null });
    expect(await openProposal(db, user.id)).toBeNull();
  });
});

describe("saveIntent approvals", () => {
  it("treats a kept proposal as approved once the mode no longer asks", async () => {
    const user = await seedFreelancer(db);
    const proposal = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    const saved = await saveIntent(db, user.id, keepPlan(proposal.id, topUp(2_000_000n)), minutes(30));
    expect(saved).toMatchObject({ id: proposal.id, status: "waiting", approvedAt: minutes(30), approvedAmountAtomic: "2000000" });
  });

  it("keeps an earlier approval as it was", async () => {
    const user = await seedFreelancer(db);
    const proposal = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    await approveProposal(db, user.id, proposal.id, 2_000_000n, minutes(5));
    const saved = await saveIntent(db, user.id, keepPlan(proposal.id, topUp(1_800_000n)), minutes(10));
    expect(saved).toMatchObject({ amountAtomic: "1800000", approvedAt: minutes(5), approvedAmountAtomic: "2000000" });
  });

  it("records an inherited approval on a new intent", async () => {
    const user = await seedFreelancer(db);
    const [hub] = await db
      .insert(fxIntents)
      .values({ userId: user.id, fromAsset: "USAT", toAsset: "USDT", amountAtomic: "2000000", reason: "hub_route", status: "filled", approvedAt: NOW })
      .returning();
    const saved = await saveIntent(db, user.id, newPlan(topUp(1_900_000n)), NOW, { via: hub.id, capAtomic: 1_990_000n });
    expect(saved).toMatchObject({ approvedVia: hub.id, approvedAt: NOW, approvedAmountAtomic: "1990000", status: "waiting" });
  });
});

describe("inheritableApproval", () => {
  async function filledHub(userId: string, opts: { approved: boolean; filledAt: Date }) {
    const [hub] = await db
      .insert(fxIntents)
      .values({
        userId,
        fromAsset: "USAT",
        toAsset: "USDT",
        amountAtomic: "2000000",
        reason: "hub_route",
        status: "filled",
        approvedAt: opts.approved ? NOW : null,
      })
      .returning();
    await insertTrade(db, {
      userId,
      intentId: hub.id,
      sellAsset: "USAT",
      buyAsset: "USDT",
      sellAmount: "2000000",
      buyAmount: "1990000",
      status: "filled",
      filledAt: opts.filledAt,
    });
    return hub;
  }

  it("finds an approved hub leg filled in the last 24 hours, with the USD₮ it bought", async () => {
    const user = await seedFreelancer(db);
    const hub = await filledHub(user.id, { approved: true, filledAt: NOW });
    expect(await inheritableApproval(db, user.id, minutes(30))).toEqual({ intentId: hub.id, boughtAtomic: 1_990_000n });
  });

  it("ignores an unapproved, an old or an already inherited hub leg", async () => {
    const user = await seedFreelancer(db);
    await filledHub(user.id, { approved: false, filledAt: NOW });
    await filledHub(user.id, { approved: true, filledAt: minutes(-25 * 60) });
    const used = await filledHub(user.id, { approved: true, filledAt: NOW });
    await db.insert(fxIntents).values({
      userId: user.id,
      fromAsset: "USDT",
      toAsset: "WARS",
      amountAtomic: "1990000",
      reason: "top_up",
      status: "filled",
      approvedVia: used.id,
    });
    expect(await inheritableApproval(db, user.id, minutes(30))).toBeNull();
  });
});
