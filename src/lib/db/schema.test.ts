import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./client";
import { invoiceQuotes, payments, recurringInvoices, rules } from "./schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice as seedInvoiceIn } from "./testing";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const seedInvoice = (userId: string, overrides: Parameters<typeof seedInvoiceIn>[2] = {}) =>
  seedInvoiceIn(db, userId, overrides);

describe("schema", () => {
  it("applies the migrations and the column defaults", async () => {
    const user = await seedFreelancer(db);
    const invoice = await seedInvoice(user.id);
    expect(invoice.status).toBe("open");
    expect(invoice.amount).toBe("300.00");
    const [userRules] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(userRules).toMatchObject({ localCurrency: "ARS", reserveAmount: "0.00", perTradeMaxUsd: 50, enabled: true });
  });

  it("keeps one quote per invoice and asset", async () => {
    const user = await seedFreelancer(db);
    const invoice = await seedInvoice(user.id);
    const quote = { invoiceId: invoice.id, asset: "USDT" as const, amountAtomic: "300000000", rate: "1", expiresAt: new Date() };
    await db.insert(invoiceQuotes).values(quote);
    await expect(db.insert(invoiceQuotes).values(quote)).rejects.toThrow();
  });

  it("refuses to record the same settlement transaction twice", async () => {
    const user = await seedFreelancer(db);
    const invoice = await seedInvoice(user.id);
    const payment = { invoiceId: invoice.id, payer: "0xabc", asset: "USDT" as const, amountAtomic: "1", txHash: "0x01" };
    await db.insert(payments).values(payment);
    await expect(db.insert(payments).values(payment)).rejects.toThrow();
  });

  it("allows many one-off invoices but one instance per recurring period", async () => {
    const user = await seedFreelancer(db);
    await seedInvoice(user.id);
    await seedInvoice(user.id);
    const [template] = await db
      .insert(recurringInvoices)
      .values({
        slug: "rTemplate01",
        userId: user.id,
        clientName: "Acme",
        description: "Maintenance",
        amount: "100",
        currency: "USD",
        interval: "weekly",
        anchorDay: 8,
        nextIssueAt: new Date("2026-10-15T00:00:00Z"),
      })
      .returning();
    const periodStart = new Date("2026-10-08T00:00:00Z");
    await seedInvoice(user.id, { recurringId: template.id, periodStart });
    await expect(seedInvoice(user.id, { recurringId: template.id, periodStart })).rejects.toThrow();
  });
});
