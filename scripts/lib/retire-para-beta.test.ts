import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import * as schema from "@/lib/db/schema";
import { findPublicInvoice } from "@/lib/invoices/repo";
import { listTreasuryUsers } from "@/lib/treasury/repo";
import { retireParaBetaData } from "./retire-para-beta";

const CUTOFF = new Date("2026-10-21T00:00:00Z");

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

async function seedAt(createdAt: string) {
  const user = await seedFreelancer(db);
  await db.update(schema.users).set({ createdAt: new Date(createdAt) }).where(eq(schema.users.id, user.id));
  await db.insert(schema.recurringInvoices).values({
    slug: `r${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}`,
    userId: user.id,
    clientName: "Acme",
    description: "Retainer",
    amount: "100",
    currency: "USD",
    interval: "monthly",
    anchorDay: 1,
    nextIssueAt: new Date("2026-11-01T00:00:00Z"),
  });
  const open = await seedInvoice(db, user.id);
  const paid = await seedInvoice(db, user.id, { status: "paid", paidAt: new Date() });
  return { user, open, paid };
}

async function snapshot(userId: string) {
  const [wallet] = await db.select().from(schema.treasuryWallets).where(eq(schema.treasuryWallets.userId, userId));
  const [rule] = await db.select().from(schema.rules).where(eq(schema.rules.userId, userId));
  const [rec] = await db.select().from(schema.recurringInvoices).where(eq(schema.recurringInvoices.userId, userId));
  const invs = await db.select().from(schema.invoices).where(eq(schema.invoices.userId, userId));
  return {
    wallet: wallet.status,
    rule: rule.enabled,
    rec: rec.active,
    invs: invs.map((i) => `${i.slug}:${i.status}`).sort(),
  };
}

describe("retireParaBetaData", () => {
  it("dry run counts and writes nothing", async () => {
    const a = await seedAt("2026-10-10T00:00:00Z");
    const before = await snapshot(a.user.id);
    const summary = await retireParaBetaData(db, { createdBefore: CUTOFF, apply: false });
    expect(summary).toEqual({ wallets: 1, rulesDisabled: 1, recurringStopped: 1, invoicesCancelled: 1, blockers: [] });
    expect(await snapshot(a.user.id)).toEqual(before);
    expect(before.wallet).toBe("ready");
  });

  it("apply retires only users created before the cutoff", async () => {
    const a = await seedAt("2026-10-10T00:00:00Z");
    const b = await seedAt("2026-10-22T00:00:00Z");
    const bBefore = await snapshot(b.user.id);
    const summary = await retireParaBetaData(db, { createdBefore: CUTOFF, apply: true });
    expect(summary.blockers).toEqual([]);
    const after = await snapshot(a.user.id);
    expect(after.wallet).toBe("retired");
    expect(after.rule).toBe(false);
    expect(after.rec).toBe(false);
    expect(after.invs).toEqual([`${a.open.slug}:cancelled`, `${a.paid.slug}:paid`].sort());
    expect(await snapshot(b.user.id)).toEqual(bBefore);
  });

  it("a retired user's pay link takes no payment", async () => {
    const a = await seedAt("2026-10-10T00:00:00Z");
    expect((await findPublicInvoice(db, a.open.slug))?.payTo).not.toBeNull();
    await retireParaBetaData(db, { createdBefore: CUTOFF, apply: true });
    expect((await findPublicInvoice(db, a.open.slug))?.payTo).toBeNull();
    expect(await listTreasuryUsers(db)).not.toContain(a.user.id);
  });

  it("refuses while an invoice is settling", async () => {
    const a = await seedAt("2026-10-10T00:00:00Z");
    const settling = await seedInvoice(db, a.user.id, { status: "settling", settlingUntil: new Date(Date.now() + 60_000) });
    const summary = await retireParaBetaData(db, { createdBefore: CUTOFF, apply: true });
    expect(summary.blockers).toEqual([expect.stringContaining(settling.slug)]);
    const after = await snapshot(a.user.id);
    expect(after.wallet).toBe("ready");
    expect(after.rule).toBe(true);
  });

  it("refuses while a treasury tx is pending", async () => {
    const a = await seedAt("2026-10-10T00:00:00Z");
    const [tx] = await db
      .insert(schema.treasuryTxs)
      .values({ userId: a.user.id, kind: "swap", nonce: 1, hash: "0xabc", raw: "0x00", feeToken: "0x01", status: "pending" })
      .returning();
    const summary = await retireParaBetaData(db, { createdBefore: CUTOFF, apply: true });
    expect(summary.blockers).toEqual([expect.stringContaining(tx.id)]);
    expect((await snapshot(a.user.id)).wallet).toBe("ready");
  });

  it("refuses while an fx intent is executing, and dry run still reports the blocker", async () => {
    const a = await seedAt("2026-10-10T00:00:00Z");
    const [intent] = await db
      .insert(schema.fxIntents)
      .values({ userId: a.user.id, fromAsset: "USAT", toAsset: "WARS", amountAtomic: "1000", reason: "top_up", status: "executing" })
      .returning();
    const dry = await retireParaBetaData(db, { createdBefore: CUTOFF, apply: false });
    expect(dry.blockers).toEqual([expect.stringContaining(intent.id)]);
    const summary = await retireParaBetaData(db, { createdBefore: CUTOFF, apply: true });
    expect(summary.blockers).toHaveLength(1);
    expect((await snapshot(a.user.id)).wallet).toBe("ready");
  });

  it("apply is idempotent", async () => {
    await seedAt("2026-10-10T00:00:00Z");
    await retireParaBetaData(db, { createdBefore: CUTOFF, apply: true });
    const second = await retireParaBetaData(db, { createdBefore: CUTOFF, apply: true });
    expect(second).toEqual({ wallets: 0, rulesDisabled: 0, recurringStopped: 0, invoicesCancelled: 0, blockers: [] });
  });
});
