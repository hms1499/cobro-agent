import { describe, expect, it } from "vitest";
import type { InvoiceRow } from "@/lib/db/schema";
import type { ReferenceRates } from "@/lib/fx/rates";
import {
  displayStatus,
  filterInvoices,
  formatInvoiceNumber,
  invoiceTimeline,
  parseInvoiceFilter,
  summarizeInvoices,
} from "./view";

const NOW = new Date("2026-10-22T12:00:00Z");
const TODAY = "2026-10-22";

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: crypto.randomUUID(),
    slug: "abc",
    userId: "u1",
    recurringId: null,
    periodStart: null,
    clientName: "Acme",
    description: "Logo",
    amount: "100.00",
    currency: "USD",
    dueDate: null,
    status: "open",
    settlingUntil: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    paidAt: null,
    ...overrides,
  };
}

describe("formatInvoiceNumber", () => {
  it("pads to four digits and grows past them", () => {
    expect(formatInvoiceNumber(1)).toBe("INV-0001");
    expect(formatInvoiceNumber(42)).toBe("INV-0042");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
  });
});

describe("displayStatus", () => {
  it("is open on the due date and overdue the day after", () => {
    expect(displayStatus({ status: "open", dueDate: "2026-10-22" }, TODAY)).toBe("open");
    expect(displayStatus({ status: "open", dueDate: "2026-10-21" }, TODAY)).toBe("overdue");
  });

  it("is open without a due date and paid stays paid after the due date", () => {
    expect(displayStatus({ status: "open", dueDate: null }, TODAY)).toBe("open");
    expect(displayStatus({ status: "paid", dueDate: "2026-10-01" }, TODAY)).toBe("paid");
  });
});

describe("parseInvoiceFilter", () => {
  it("accepts known filters and falls back to all", () => {
    expect(parseInvoiceFilter("overdue")).toBe("overdue");
    expect(parseInvoiceFilter("x")).toBe("all");
    expect(parseInvoiceFilter(undefined)).toBe("all");
  });
});

describe("filterInvoices", () => {
  const rows = [
    row({ status: "open", dueDate: "2026-10-30" }),
    row({ status: "open", dueDate: "2026-10-01" }),
    row({ status: "settling" }),
    row({ status: "paid" }),
    row({ status: "cancelled" }),
  ];

  it("splits open (with settling), overdue and paid", () => {
    expect(filterInvoices(rows, "open", TODAY)).toEqual([rows[0], rows[2]]);
    expect(filterInvoices(rows, "overdue", TODAY)).toEqual([rows[1]]);
    expect(filterInvoices(rows, "paid", TODAY)).toEqual([rows[3]]);
    expect(filterInvoices(rows, "all", TODAY)).toHaveLength(5);
  });
});

describe("summarizeInvoices", () => {
  it("is all zeros for no invoices", () => {
    const zero = { count: 0, usd: "0.00" };
    expect(summarizeInvoices([], null, NOW)).toEqual({ open: zero, overdue: zero, receivedThisMonth: zero });
  });

  it("sums dollar invoices without rates and counts settling as open", () => {
    const summary = summarizeInvoices(
      [
        row({ amount: "100.00" }),
        row({ amount: "100.00", status: "settling" }),
        row({ amount: "50.00", dueDate: "2026-10-01" }),
        row({ status: "paid", paidAt: new Date("2026-10-05T10:00:00Z") }),
        row({ status: "paid", paidAt: new Date("2026-09-30T23:59:00Z") }),
      ],
      null,
      NOW,
    );
    expect(summary.open).toEqual({ count: 2, usd: "200.00" });
    expect(summary.overdue).toEqual({ count: 1, usd: "50.00" });
    expect(summary.receivedThisMonth).toEqual({ count: 1, usd: "100.00" });
  });

  it("shows counts only when a conversion needs rates that are missing", () => {
    const summary = summarizeInvoices([row({ currency: "ARS", amount: "1500.00" }), row()], null, NOW);
    expect(summary.open).toEqual({ count: 2, usd: null });
  });

  it("converts local-currency invoices to dollars with rates", () => {
    const rates: ReferenceRates = { perUsd: { ARS: 1500n * 10n ** 18n, BRL: 5n * 10n ** 18n }, fetchedAt: 0 };
    const summary = summarizeInvoices([row({ currency: "ARS", amount: "1500.00" })], rates, NOW);
    expect(summary.open).toEqual({ count: 1, usd: "1.00" });
  });
});

describe("invoiceTimeline", () => {
  it("shows created, due and a pending paid step for an open invoice", () => {
    const steps = invoiceTimeline(row({ dueDate: "2026-10-30" }), TODAY);
    expect(steps.map((s) => s.key)).toEqual(["created", "due", "paid"]);
    expect(steps[0].done).toBe(true);
    expect(steps[1].done).toBe(false);
    expect(steps[2]).toMatchObject({ done: false, at: null });
  });

  it("marks every step done once paid", () => {
    const paidAt = new Date("2026-10-10T00:00:00Z");
    const steps = invoiceTimeline(row({ dueDate: "2026-10-30", status: "paid", paidAt }), TODAY);
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps[2].at).toEqual(paidAt);
  });

  it("ends with cancelled for a cancelled invoice", () => {
    expect(invoiceTimeline(row({ status: "cancelled" }), TODAY).map((s) => s.key)).toEqual(["created", "cancelled"]);
  });

  it("shows the payment in progress while settling", () => {
    expect(invoiceTimeline(row({ status: "settling" }), TODAY).map((s) => s.key)).toEqual(["created", "settling", "paid"]);
  });
});
