"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { formFields, type FieldErrors } from "@/lib/forms";
import { parseRulesForm, saveRules, type RulesField } from "@/lib/treasury/rules-form";

export interface RulesState {
  errors: FieldErrors<RulesField>;
  values: Record<string, string>;
  saved: boolean;
}

export async function saveRulesAction(_previous: RulesState, formData: FormData): Promise<RulesState> {
  const user = await requireUser();
  const fields = formFields(formData);
  const parsed = parseRulesForm(fields);
  if (!parsed.ok) return { errors: parsed.errors, values: fields, saved: false };
  await saveRules(getDb(), user.id, parsed.data, new Date());
  refresh();
  return { errors: {}, values: fields, saved: true };
}
