import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { invoices, payments, recurringInvoices } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { InvoiceInput } from "./input";
import {
  createInvoice,
  createRecurring,
  findPublicInvoice,
  getOwnedInvoice,
  issueDueRecurring,
  listInvoices,
  resolveRecurringLink,
} from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const input: InvoiceInput = {
  clientName: "Acme",
  description: "Logo",
  amount: "300.00",
  currency: "USD",
  dueDate: "2026-10-20",
  repeat: "none",
};
const NOW = new Date("2026-10-15T12:00:00Z");

describe("one-off invoices", () => {
  it("creates, lists and finds an invoice", async () => {
    const user = await seedFreelancer(db);
    const invoice = await createInvoice(db, user.id, input);
    expect(invoice).toMatchObject({ status: "open", amount: "300.00", dueDate: "2026-10-20", recurringId: null });
    expect(invoice.slug).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
    expect((await listInvoices(db, user.id)).map((i) => i.id)).toEqual([invoice.id]);

    expect(await findPublicInvoice(db, invoice.slug)).toMatchObject({
      id: invoice.id,
      clientName: "Acme",
      currency: "USD",
      freelancerName: "Ana Diseño",
      payTo: TEST_TREASURY,
      recurringSlug: null,
    });
  });

  it("hides the pay-to address until the treasury wallet is ready", async () => {
    const user = await seedFreelancer(db, { treasuryAddress: null });
    const invoice = await createInvoice(db, user.id, input);
    expect((await findPublicInvoice(db, invoice.slug))?.payTo).toBeNull();
  });

  it("shows an invoice only to its owner", async () => {
    const owner = await seedFreelancer(db);
    const stranger = await seedFreelancer(db);
    const invoice = await createInvoice(db, owner.id, input);
    await db.insert(payments).values({ invoiceId: invoice.id, payer: "0xpayer", asset: "USDT", amountAtomic: "300000000", txHash: "0xaa" });
    expect(await getOwnedInvoice(db, owner.id, invoice.id)).toMatchObject({
      invoice: { id: invoice.id },
      recurring: null,
      payments: [{ txHash: "0xaa" }],
    });
    expect(await getOwnedInvoice(db, stranger.id, invoice.id)).toBeNull();
    expect(await getOwnedInvoice(db, owner.id, "not-a-uuid")).toBeNull();
    expect(await findPublicInvoice(db, "nope")).toBeNull();
  });
});

describe("recurring invoices", () => {
  it("issues the first instance now and schedules the next", async () => {
    const user = await seedFreelancer(db);
    const { recurring, first } = await createRecurring(db, user.id, { ...input, repeat: "weekly", dueDate: null }, NOW);
    expect(recurring).toMatchObject({ interval: "weekly", anchorDay: 15, nextIssueAt: new Date("2026-10-22T12:00:00Z") });
    expect(first).toMatchObject({ recurringId: recurring.id, periodStart: NOW, dueDate: "2026-10-22" });
    expect((await findPublicInvoice(db, first.slug))?.recurringSlug).toBe(recurring.slug);
    expect(await getOwnedInvoice(db, user.id, first.id)).toMatchObject({
      recurring: { slug: recurring.slug, interval: "weekly" },
    });
  });

  it("issues a due period exactly once, even when runs overlap", async () => {
    const user = await seedFreelancer(db);
    const { recurring } = await createRecurring(db, user.id, { ...input, repeat: "weekly", dueDate: null }, NOW);
    expect(await issueDueRecurring(db, new Date("2026-10-22T11:59:59Z"))).toBe(0);

    const due = new Date("2026-10-22T12:05:00Z");
    const counts = await Promise.all([issueDueRecurring(db, due), issueDueRecurring(db, due)]);
    expect(counts[0] + counts[1]).toBe(1);
    expect(await issueDueRecurring(db, due)).toBe(0);

    const instances = await db.select().from(invoices).where(eq(invoices.recurringId, recurring.id));
    expect(instances.map((i) => i.periodStart?.toISOString()).sort()).toEqual([
      "2026-10-15T12:00:00.000Z",
      "2026-10-22T12:00:00.000Z",
    ]);
    const [template] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, recurring.id));
    expect(template.nextIssueAt).toEqual(new Date("2026-10-29T12:00:00Z"));
  });

  it("skips paused templates", async () => {
    const user = await seedFreelancer(db);
    const { recurring } = await createRecurring(db, user.id, { ...input, repeat: "monthly", dueDate: null }, NOW);
    await db.update(recurringInvoices).set({ active: false }).where(eq(recurringInvoices.id, recurring.id));
    expect(await issueDueRecurring(db, new Date("2026-12-01T00:00:00Z"))).toBe(0);
  });

  it("sends the stable link to the oldest open period, or lists paid periods", async () => {
    const user = await seedFreelancer(db);
    const { recurring, first } = await createRecurring(db, user.id, { ...input, repeat: "weekly", dueDate: null }, NOW);
    await issueDueRecurring(db, new Date("2026-10-22T12:00:00Z"));
    expect(await resolveRecurringLink(db, recurring.slug)).toEqual({ kind: "open", invoiceSlug: first.slug });

    const paidAt = new Date("2026-10-23T10:00:00Z");
    await db.update(invoices).set({ status: "paid", paidAt }).where(eq(invoices.recurringId, recurring.id));
    const link = await resolveRecurringLink(db, recurring.slug);
    expect(link).toMatchObject({ kind: "all-paid", clientName: "Acme", freelancerName: "Ana Diseño" });
    expect(link?.kind === "all-paid" && link.paid.map((p) => p.periodStart?.toISOString())).toEqual([
      "2026-10-22T12:00:00.000Z",
      "2026-10-15T12:00:00.000Z",
    ]);
    expect(await resolveRecurringLink(db, "unknown")).toBeNull();
  });
});
