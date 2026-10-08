"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { formFields, type FieldErrors } from "@/lib/forms";
import { parseOnboardingForm, saveOnboarding, type OnboardingField } from "@/lib/users/onboarding";

export interface OnboardingState {
  errors: FieldErrors<OnboardingField>;
  values: Record<string, string>;
}

export async function completeOnboarding(_previous: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const user = await requireUser({ allowOnboarding: true });
  const fields = formFields(formData);
  const parsed = parseOnboardingForm(fields);
  if (!parsed.ok) return { errors: parsed.errors, values: fields };
  await saveOnboarding(getDb(), user.id, parsed.data);
  redirect("/app/invoices/new?first=1");
}
