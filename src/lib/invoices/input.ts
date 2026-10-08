import type { RecurringInterval } from "@/lib/db/schema";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { isFiatCurrency, type FiatCurrency } from "@/lib/money/currencies";
import { parseFiatInput } from "@/lib/money/input";
import { isoDate } from "./dates";

export interface InvoiceInput {
  clientName: string;
  description: string;
  amount: string;
  currency: FiatCurrency;
  dueDate: string | null;
  repeat: "none" | RecurringInterval;
}
export type InvoiceField = keyof InvoiceInput;

const REPEATS = ["none", "weekly", "monthly"] as const;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && isoDate(date) === value;
}

export function parseInvoiceForm(fields: Record<string, string>, today: string): FormResult<InvoiceInput, InvoiceField> {
  const errors: FieldErrors<InvoiceField> = {};
  const clientName = (fields.clientName ?? "").trim();
  if (clientName === "") errors.clientName = "invoiceForm.error.client";
  else if (clientName.length > 80) errors.clientName = "invoiceForm.error.clientLong";

  const description = (fields.description ?? "").trim();
  if (description === "") errors.description = "invoiceForm.error.description";
  else if (description.length > 200) errors.description = "invoiceForm.error.descriptionLong";

  const amount = parseFiatInput(fields.amount ?? "");
  if (!amount.ok) errors.amount = `money.error.${amount.error}`;

  const currency = fields.currency;
  if (!isFiatCurrency(currency)) errors.currency = "invoiceForm.error.currency";

  const repeat = fields.repeat ?? "none";
  const validRepeat = (REPEATS as readonly string[]).includes(repeat);
  if (!validRepeat) errors.repeat = "invoiceForm.error.repeat";

  // Recurring periods are due RECURRING_DUE_DAYS after issue, so their due date field is ignored.
  const rawDue = (fields.dueDate ?? "").trim();
  const recurring = repeat === "weekly" || repeat === "monthly";
  let dueDate: string | null = null;
  if (rawDue !== "" && !recurring) {
    if (!isRealDate(rawDue)) errors.dueDate = "invoiceForm.error.dueDate";
    else if (rawDue < today) errors.dueDate = "invoiceForm.error.duePast";
    else dueDate = rawDue;
  }

  if (Object.keys(errors).length > 0 || !amount.ok || !isFiatCurrency(currency)) return { ok: false, errors };
  return {
    ok: true,
    data: { clientName, description, amount: amount.value, currency, dueDate, repeat: repeat as InvoiceInput["repeat"] },
  };
}
