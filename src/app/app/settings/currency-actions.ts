"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { formFields, type FieldErrors } from "@/lib/forms";
import { changeHomeCurrency, parseHomeCurrencyForm, type HomeCurrencyField } from "@/lib/users/home-currency";

export interface CurrencyFormState {
  errors: FieldErrors<HomeCurrencyField>;
  saved: boolean;
}

/** Settings → "Your currency" (USD home currency spec §4.3). */
export async function changeHomeCurrencyAction(_previous: CurrencyFormState, formData: FormData): Promise<CurrencyFormState> {
  const user = await requireUser();
  const parsed = parseHomeCurrencyForm(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors, saved: false };
  await changeHomeCurrency(getDb(), user.id, parsed.data, new Date());
  refresh();
  return { errors: {}, saved: true };
}
