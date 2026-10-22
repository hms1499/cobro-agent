import { describe, expect, it } from "vitest";
import type { AgentEventRow, InvoiceRow } from "@/lib/db/schema";
import { buildRecent } from "./recent";

const at = (iso: string) => new Date(iso);

function invoice(id: string, createdAt: string, paidAt: string | null = null): InvoiceRow {
  return {
    id,
    slug: id,
    userId: "u1",
    recurringId: null,
    periodStart: null,
    clientName: "Acme",
    description: "Logo",
    amount: "100.00",
    currency: "USD",
    dueDate: null,
    status: paidAt ? "paid" : "open",
    settlingUntil: null,
    createdAt: at(createdAt),
    paidAt: paidAt ? at(paidAt) : null,
    cancelledAt: null,
  };
}

function event(id: string, type: AgentEventRow["type"], createdAt: string): AgentEventRow {
  return { id, userId: "u1", type, data: {}, createdAt: at(createdAt) };
}

const ids = (items: ReturnType<typeof buildRecent>) =>
  items.map((item) => (item.kind === "invoice" ? item.invoice.id : item.event.id));

describe("buildRecent", () => {
  it("is empty for a new freelancer", () => {
    expect(buildRecent([], [])).toEqual([]);
  });

  it("merges invoices and agent actions, newest first, five at most", () => {
    const invoices = [
      invoice("i1", "2026-10-01T00:00:00Z"),
      invoice("i2", "2026-10-02T00:00:00Z", "2026-10-09T00:00:00Z"),
      invoice("i3", "2026-10-05T00:00:00Z"),
    ];
    const events = [
      event("e1", "converted", "2026-10-10T00:00:00Z"),
      event("e2", "withdrawn", "2026-10-06T00:00:00Z"),
      event("e3", "waiting", "2026-10-03T00:00:00Z"),
      event("e4", "converted", "2026-09-30T00:00:00Z"),
    ];
    expect(ids(buildRecent(invoices, events))).toEqual(["e1", "i2", "e2", "i3", "e3"]);
    expect(buildRecent(invoices, events)[1]).toMatchObject({ kind: "invoice", at: at("2026-10-09T00:00:00Z") });
  });

  it("leaves out events that need no attention", () => {
    const events = [
      event("p", "paused", "2026-10-10T00:00:00Z"),
      event("r", "resumed", "2026-10-09T00:00:00Z"),
      event("g", "gas_dripped", "2026-10-08T00:00:00Z"),
      event("c", "payment_reconciled", "2026-10-07T00:00:00Z"),
      event("w", "withdrawn", "2026-10-06T00:00:00Z"),
    ];
    expect(ids(buildRecent([], events))).toEqual(["w"]);
  });

  it("puts the agent action first when times are equal", () => {
    const same = "2026-10-10T00:00:00Z";
    expect(ids(buildRecent([invoice("i", same)], [event("e", "converted", same)]))).toEqual(["e", "i"]);
  });
});
