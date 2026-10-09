import type { RecurringInterval } from "@/lib/db/schema";
import { addDays } from "./dates";

/** Spec §9.1: the next issue time. Monthly invoices return to `anchorDay` whenever the month has it. */
export function nextIssueAt(previous: Date, interval: RecurringInterval, anchorDay: number): Date {
  if (interval === "weekly") return addDays(previous, 7);
  const year = previous.getUTCFullYear();
  const month = previous.getUTCMonth() + 1;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const next = new Date(previous);
  next.setUTCFullYear(year, month, Math.min(anchorDay, daysInMonth));
  return next;
}
