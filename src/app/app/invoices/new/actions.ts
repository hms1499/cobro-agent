"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { formFields, type FieldErrors } from "@/lib/forms";
import { isoDate } from "@/lib/invoices/dates";
import { parseInvoiceForm, type InvoiceField } from "@/lib/invoices/input";
import { createInvoice, createRecurring } from "@/lib/invoices/repo";

export interface InvoiceFormState {
  errors: FieldErrors<InvoiceField>;
  values: Record<string, string>;
  /** The treasury wallet is not ready, so no payment address exists yet. */
  notReady?: boolean;
}

export async function createInvoiceAction(_previous: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  const fields = formFields(formData);
  const parsed = parseInvoiceForm(fields, isoDate(new Date()));
  if (!parsed.ok) return { errors: parsed.errors, values: fields };
  if (user.treasuryStatus !== "ready") return { errors: {}, values: fields, notReady: true };

  const db = getDb();
  const invoice =
    parsed.data.repeat === "none"
      ? await createInvoice(db, user.id, parsed.data)
      : (await createRecurring(db, user.id, parsed.data, new Date())).first;
  redirect(`/app/invoices/${invoice.id}?created=1`);
}
