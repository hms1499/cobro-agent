import type { InvoiceRow } from "@/lib/db/schema";
import { convertFiat } from "@/lib/fx/convert";
import { RatesUnavailableError, type ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import { isoDate } from "./dates";

/** "INV-0001": the invoice's position among the freelancer's invoices (spec 4f §4.1). */
export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

/** The stored status plus "overdue", a display state: open and due before today (UTC). */
export type DisplayStatus = "open" | "overdue" | "settling" | "paid" | "cancelled";

export function displayStatus(inv: Pick<InvoiceRow, "status" | "dueDate">, today: string): DisplayStatus {
  if (inv.status === "open" && inv.dueDate !== null && inv.dueDate < today) return "overdue";
  return inv.status;
}

export const INVOICE_FILTERS = ["all", "open", "overdue", "paid"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export function parseInvoiceFilter(value: unknown): InvoiceFilter {
  return INVOICE_FILTERS.find((f) => f === value) ?? "all";
}

/** "open" holds open (not yet overdue) and settling invoices; cancelled ones only show under "all". */
export function filterInvoices<T extends Pick<InvoiceRow, "status" | "dueDate">>(rows: T[], filter: InvoiceFilter, today: string): T[] {
  if (filter === "all") return rows;
  return rows.filter((row) => {
    const status = displayStatus(row, today);
    return filter === "open" ? status === "open" || status === "settling" : status === filter;
  });
}

export interface SummaryFigure {
  count: number;
  /** Dollars with two decimals, or null when an amount could not be converted (no rates). */
  usd: string | null;
}

export interface InvoiceSummary {
  open: SummaryFigure;
  overdue: SummaryFigure;
  receivedThisMonth: SummaryFigure;
}

function figure(rows: InvoiceRow[], rates: ReferenceRates | null): SummaryFigure {
  let cents = 0n;
  try {
    for (const row of rows) cents += parseDecimal(convertFiat(row.amount, row.currency, "USD", rates), 2);
  } catch (error) {
    if (error instanceof RatesUnavailableError) return { count: rows.length, usd: null };
    throw error;
  }
  return { count: rows.length, usd: `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}` };
}

/** Home and Invoices summary cards (spec 4f §4.1): totals in dollars, converted with the reference rates. */
export function summarizeInvoices(rows: InvoiceRow[], rates: ReferenceRates | null, now: Date): InvoiceSummary {
  const today = isoDate(now);
  const month = today.slice(0, 7);
  return {
    open: figure(filterInvoices(rows, "open", today), rates),
    overdue: figure(filterInvoices(rows, "overdue", today), rates),
    receivedThisMonth: figure(
      rows.filter((row) => row.paidAt !== null && isoDate(row.paidAt).slice(0, 7) === month),
      rates,
    ),
  };
}

export type TimelineStep = { key: "created" | "due" | "settling" | "paid" | "cancelled"; at: Date | string | null; done: boolean };

/** Created → Due (if set) → payment in progress (while settling) → Paid, or Cancelled. Nothing records views. */
export function invoiceTimeline(inv: InvoiceRow, today: string): TimelineStep[] {
  const steps: TimelineStep[] = [{ key: "created", at: inv.createdAt, done: true }];
  if (inv.dueDate) steps.push({ key: "due", at: inv.dueDate, done: inv.status === "paid" || inv.dueDate < today });
  if (inv.status === "cancelled") {
    steps.push({ key: "cancelled", at: null, done: true });
    return steps;
  }
  if (inv.status === "settling") steps.push({ key: "settling", at: inv.settlingUntil, done: false });
  steps.push({ key: "paid", at: inv.paidAt, done: inv.status === "paid" });
  return steps;
}
