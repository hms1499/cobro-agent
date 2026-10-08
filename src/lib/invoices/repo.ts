import { and, asc, desc, eq, lte } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import {
  invoices,
  payments,
  recurringInvoices,
  treasuryWallets,
  users,
  type InvoiceRow,
  type InvoiceStatus,
  type PaymentRow,
  type RecurringInterval,
  type RecurringInvoiceRow,
} from "@/lib/db/schema";
import type { FiatCurrency } from "@/lib/money/currencies";
import { addDays, isoDate } from "./dates";
import type { InvoiceInput } from "./input";
import { nextIssueAt } from "./schedule";
import { newSlug } from "./slug";

export const RECURRING_DUE_DAYS = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OwnedInvoice {
  invoice: InvoiceRow;
  recurring: { slug: string; interval: RecurringInterval } | null;
  payments: PaymentRow[];
}

/** What the public payment page and the x402 route may know about an invoice. */
export interface PublicInvoice {
  id: string;
  slug: string;
  clientName: string;
  description: string;
  amount: string;
  currency: FiatCurrency;
  dueDate: string | null;
  status: InvoiceStatus;
  settlingUntil: Date | null;
  freelancerName: string | null;
  /** The owner's treasury wallet, or null while it is still being created. */
  payTo: Address | null;
  recurringSlug: string | null;
}

export type RecurringLink =
  | { kind: "open"; invoiceSlug: string }
  | {
      kind: "all-paid";
      clientName: string;
      description: string;
      freelancerName: string | null;
      paid: { slug: string; periodStart: Date | null; paidAt: Date | null; amount: string; currency: FiatCurrency }[];
    };

export async function createInvoice(db: Db, userId: string, input: InvoiceInput): Promise<InvoiceRow> {
  const [row] = await db
    .insert(invoices)
    .values({
      slug: newSlug(),
      userId,
      clientName: input.clientName,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate,
    })
    .returning();
  return row;
}

/** Inserts one period of a template; undefined when that period already exists. */
async function insertInstance(db: Db, recurring: RecurringInvoiceRow, periodStart: Date) {
  const [row] = await db
    .insert(invoices)
    .values({
      slug: newSlug(),
      userId: recurring.userId,
      recurringId: recurring.id,
      periodStart,
      clientName: recurring.clientName,
      description: recurring.description,
      amount: recurring.amount,
      currency: recurring.currency,
      dueDate: isoDate(addDays(periodStart, RECURRING_DUE_DAYS)),
    })
    .onConflictDoNothing({ target: [invoices.recurringId, invoices.periodStart] })
    .returning();
  return row as InvoiceRow | undefined;
}

export async function createRecurring(
  db: Db,
  userId: string,
  input: InvoiceInput,
  now: Date,
): Promise<{ recurring: RecurringInvoiceRow; first: InvoiceRow }> {
  if (input.repeat === "none") throw new Error("createRecurring needs a weekly or monthly invoice");
  const interval = input.repeat;
  return db.transaction(async (tx) => {
    const anchorDay = now.getUTCDate();
    const [recurring] = await tx
      .insert(recurringInvoices)
      .values({
        slug: newSlug(),
        userId,
        clientName: input.clientName,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        interval,
        anchorDay,
        nextIssueAt: nextIssueAt(now, interval, anchorDay),
      })
      .returning();
    const first = await insertInstance(tx, recurring, now);
    if (!first) throw new Error("First period of a new recurring invoice already exists");
    return { recurring, first };
  });
}

/**
 * Spec §9.1: for each active template whose next issue time has passed, insert that period and
 * advance the schedule by one interval. Advancing is conditional on the old value and the unique
 * (recurring_id, period_start) index backs it up, so overlapping runs issue each period once.
 */
export async function issueDueRecurring(db: Db, now: Date, limit = 100): Promise<number> {
  const due = await db
    .select()
    .from(recurringInvoices)
    .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.nextIssueAt, now)))
    .orderBy(asc(recurringInvoices.nextIssueAt))
    .limit(limit);
  let issued = 0;
  for (const recurring of due) {
    await db.transaction(async (tx) => {
      const advanced = await tx
        .update(recurringInvoices)
        .set({ nextIssueAt: nextIssueAt(recurring.nextIssueAt, recurring.interval, recurring.anchorDay) })
        .where(and(eq(recurringInvoices.id, recurring.id), eq(recurringInvoices.nextIssueAt, recurring.nextIssueAt)))
        .returning({ id: recurringInvoices.id });
      if (advanced.length === 0) return;
      if (await insertInstance(tx, recurring, recurring.nextIssueAt)) issued += 1;
    });
  }
  return issued;
}

export async function listInvoices(db: Db, userId: string, limit = 50): Promise<InvoiceRow[]> {
  return db.select().from(invoices).where(eq(invoices.userId, userId)).orderBy(desc(invoices.createdAt)).limit(limit);
}

export async function getOwnedInvoice(db: Db, userId: string, invoiceId: string): Promise<OwnedInvoice | null> {
  if (!UUID.test(invoiceId)) return null;
  const [row] = await db
    .select({ invoice: invoices, recurringSlug: recurringInvoices.slug, interval: recurringInvoices.interval })
    .from(invoices)
    .leftJoin(recurringInvoices, eq(recurringInvoices.id, invoices.recurringId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)));
  if (!row) return null;
  const paid = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(asc(payments.settledAt));
  return {
    invoice: row.invoice,
    recurring: row.recurringSlug && row.interval ? { slug: row.recurringSlug, interval: row.interval } : null,
    payments: paid,
  };
}

export async function findPublicInvoice(db: Db, slug: string): Promise<PublicInvoice | null> {
  const [row] = await db
    .select({
      invoice: invoices,
      freelancerName: users.displayName,
      walletStatus: treasuryWallets.status,
      walletAddress: treasuryWallets.address,
      recurringSlug: recurringInvoices.slug,
    })
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.userId))
    .leftJoin(treasuryWallets, eq(treasuryWallets.userId, invoices.userId))
    .leftJoin(recurringInvoices, eq(recurringInvoices.id, invoices.recurringId))
    .where(eq(invoices.slug, slug));
  if (!row) return null;
  const { invoice } = row;
  return {
    id: invoice.id,
    slug: invoice.slug,
    clientName: invoice.clientName,
    description: invoice.description,
    amount: invoice.amount,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    status: invoice.status,
    settlingUntil: invoice.settlingUntil,
    freelancerName: row.freelancerName,
    payTo: row.walletStatus === "ready" && row.walletAddress ? getAddress(row.walletAddress) : null,
    recurringSlug: row.recurringSlug,
  };
}

export async function resolveRecurringLink(db: Db, slug: string): Promise<RecurringLink | null> {
  const [template] = await db
    .select({ recurring: recurringInvoices, freelancerName: users.displayName })
    .from(recurringInvoices)
    .innerJoin(users, eq(users.id, recurringInvoices.userId))
    .where(eq(recurringInvoices.slug, slug));
  if (!template) return null;
  const instances = await db
    .select()
    .from(invoices)
    .where(eq(invoices.recurringId, template.recurring.id))
    .orderBy(asc(invoices.periodStart));
  const open = instances.find((i) => i.status === "open" || i.status === "settling");
  if (open) return { kind: "open", invoiceSlug: open.slug };
  return {
    kind: "all-paid",
    clientName: template.recurring.clientName,
    description: template.recurring.description,
    freelancerName: template.freelancerName,
    paid: instances
      .filter((i) => i.status === "paid")
      .reverse()
      .map((i) => ({ slug: i.slug, periodStart: i.periodStart, paidAt: i.paidAt, amount: i.amount, currency: i.currency })),
  };
}
