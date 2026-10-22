"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { cancelInvoice, stopRecurring } from "@/lib/invoices/repo";

export interface InvoiceActionState {
  outcome: "cancelled" | "stopped" | "not_cancellable" | null;
}

/** "Cancel invoice" on the invoice page. Only the owner's open invoice changes; see `cancelInvoice`. */
export async function cancelInvoiceAction(_previous: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const user = await requireUser();
  const result = await cancelInvoice(getDb(), user.id, String(formData.get("invoiceId") ?? ""), new Date());
  refresh();
  return { outcome: result === "cancelled" ? "cancelled" : "not_cancellable" };
}

/** "Stop repeating": no new periods for the recurring invoice; issued invoices are left as they are. */
export async function stopRecurringAction(_previous: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const user = await requireUser();
  const stopped = await stopRecurring(getDb(), user.id, String(formData.get("recurringId") ?? ""));
  refresh();
  return { outcome: stopped ? "stopped" : null };
}
