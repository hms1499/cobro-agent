import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import { claimInvoice, recordPayment, releaseInvoice } from "./invoice-claim";

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
    expect(await invoice()).toMatchObject({ status: "settling", settlingUntil: at("12:03:00") });
    expect(await claimInvoice(db, invoiceId, at("12:01:00"))).toBe(false);
  });

  it("lets two simultaneous claims produce one winner", async () => {
    const results = await Promise.all([claimInvoice(db, invoiceId, at("12:00:00")), claimInvoice(db, invoiceId, at("12:00:00"))]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("frees a hold that has expired", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    expect(await claimInvoice(db, invoiceId, at("12:03:01"))).toBe(true);
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
});
