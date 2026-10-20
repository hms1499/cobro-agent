import type { AgentEventRow, AgentEventType, InvoiceRow } from "@/lib/db/schema";

/** One row of Home's "Recent" list: an invoice or something the agent did. */
export type RecentItem =
  | { kind: "invoice"; at: Date; invoice: InvoiceRow }
  | { kind: "event"; at: Date; event: AgentEventRow };

// Routine events stay in the Agent tab's history; Recent shows what the freelancer cares about.
const NOT_RECENT: readonly AgentEventType[] = ["paused", "resumed", "gas_dripped", "payment_reconciled"];

/** Events whose title says everything, so the history shows no "Why?" for them. */
export const HIDE_WHY_EVENTS: readonly AgentEventType[] = ["paused", "resumed"];

/** Invoices (by payment time once paid) and agent events, newest first; on a tie the agent's action comes first. */
export function buildRecent(invoices: InvoiceRow[], events: AgentEventRow[], limit = 5): RecentItem[] {
  const items: RecentItem[] = [
    ...invoices.map((invoice): RecentItem => ({ kind: "invoice", at: invoice.paidAt ?? invoice.createdAt, invoice })),
    ...events
      .filter((event) => !NOT_RECENT.includes(event.type))
      .map((event): RecentItem => ({ kind: "event", at: event.createdAt, event })),
  ];
  const id = (item: RecentItem) => (item.kind === "invoice" ? item.invoice.id : item.event.id);
  return items
    .sort(
      (a, b) =>
        b.at.getTime() - a.at.getTime() ||
        (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1) ||
        id(a).localeCompare(id(b)),
    )
    .slice(0, limit);
}
