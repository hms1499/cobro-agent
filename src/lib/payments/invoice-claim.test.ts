import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import { claimInvoice, recordPayment, recordReconciledPayment, releaseInvoice, releaseSettling } from "./invoice-claim";

let db: Db;
let invoiceId: string;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  const user = await seedFreelancer(db);
  invoiceId = (await seedInvoice(db, user.id)).id;
});

const at = (iso: string) => new Date(`2026-10-15T${iso}Z`);
const invoice = async () => (await db.select().from(invoices).where(eq(invoices.id, invoiceId)))[0];

describe("claimInvoice", () => {
  it("lets exactly one payment hold an open invoice", async () => {
    expect(await claimInvoice(db, invoiceId, at("12:00:00"))).toBe(true);
    expect(await invoice()).toMatchObject({ status: "settling", settlingUntil: at("12:06:00") });
    expect(await claimInvoice(db, invoiceId, at("12:01:00"))).toBe(false);
  });

  it("lets two simultaneous claims produce one winner", async () => {
    const results = await Promise.all([claimInvoice(db, invoiceId, at("12:00:00")), claimInvoice(db, invoiceId, at("12:00:00"))]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("keeps an expired hold busy until the reconciler resolves it", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    expect(await claimInvoice(db, invoiceId, at("12:06:01"))).toBe(false);
  });

  it("never claims a paid invoice", async () => {
    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));
    expect(await claimInvoice(db, invoiceId, at("12:00:00"))).toBe(false);
  });
});

describe("releaseInvoice", () => {
  it("reopens a held invoice but leaves a paid one alone", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    await releaseInvoice(db, invoiceId);
    expect(await invoice()).toMatchObject({ status: "open", settlingUntil: null });

    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));
    await releaseInvoice(db, invoiceId);
    expect((await invoice()).status).toBe("paid");
  });
});

describe("recordPayment", () => {
  it("stores the payment and marks the invoice paid, once per transaction", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    const payment = {
      invoiceId,
      payer: "0x9999999999999999999999999999999999999999",
      asset: "USDT" as const,
      amountAtomic: 300_000000n,
      txHash: `0x${"ab".repeat(32)}`,
      now: at("12:00:20"),
    };
    await recordPayment(db, payment);
    await recordPayment(db, payment);
    expect(await invoice()).toMatchObject({ status: "paid", paidAt: at("12:00:20"), settlingUntil: null });
    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ asset: "USDT", amountAtomic: "300000000" });
  });

  it("keeps the reference rates the payment arrived at, for the P&L", async () => {
    await recordPayment(db, {
      invoiceId,
      payer: "0x9999999999999999999999999999999999999999",
      asset: "USDT",
      amountAtomic: 1n,
      txHash: `0x${"cd".repeat(32)}`,
      now: at("12:00:20"),
      ratesSnapshot: { ARS: "1600", BRL: "5" },
    });
    const [row] = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    expect(row.ratesSnapshot).toEqual({ ARS: "1600", BRL: "5" });
  });
});

describe("reconcile guards", () => {
  const until = at("12:06:00");
  const base = () => ({ invoiceId, settlingUntil: until, payer: "0xabc", asset: "USDT" as const, amountAtomic: 5n, txHash: "0x01", now: at("12:30:00") });

  it("releases only the claim that was read", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    expect(await releaseSettling(db, invoiceId, at("12:07:00"))).toBe(false);
    expect((await invoice()).status).toBe("settling");
    expect(await releaseSettling(db, invoiceId, until)).toBe(true);
  });

  it("does not mark paid, or insert, when the claim moved", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    expect(await recordReconciledPayment(db, { ...base(), settlingUntil: at("12:07:00") })).toBe("moved");
    expect((await invoice()).status).toBe("settling");
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it("never marks paid without a payment row when the transfer is already recorded", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    const other = await seedInvoice(db, (await invoice()).userId, { status: "paid" });
    await db.insert(payments).values({ invoiceId: other.id, payer: "0xabc", asset: "USDT", amountAtomic: "5", txHash: "0x01" });
    expect(await recordReconciledPayment(db, base())).toBe("duplicate");
    expect(await invoice()).toMatchObject({ status: "settling", settlingUntil: until });
    expect(await recordReconciledPayment(db, { ...base(), txHash: "0x02" })).toBe("recorded");
    expect((await invoice()).status).toBe("paid");
  });
});
