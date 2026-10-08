import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rules, users } from "@/lib/db/schema";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { isLocalCurrency, type LocalCurrency } from "@/lib/money/currencies";
import { parseFiatInput } from "@/lib/money/input";

export interface OnboardingInput {
  displayName: string;
  localCurrency: LocalCurrency;
  reserveAmount: string;
}
export type OnboardingField = "displayName" | "localCurrency" | "reserveAmount";

export function parseOnboardingForm(fields: Record<string, string>): FormResult<OnboardingInput, OnboardingField> {
  const errors: FieldErrors<OnboardingField> = {};
  const displayName = (fields.displayName ?? "").trim();
  if (displayName === "") errors.displayName = "onboarding.error.name";
  else if (displayName.length > 60) errors.displayName = "onboarding.error.nameLong";

  const localCurrency = fields.localCurrency;
  if (!isLocalCurrency(localCurrency)) errors.localCurrency = "onboarding.error.currency";

  const rawReserve = (fields.reserveAmount ?? "").trim();
  const reserve = parseFiatInput(rawReserve === "" ? "0" : rawReserve, { allowZero: true });
  if (!reserve.ok) errors.reserveAmount = `money.error.${reserve.error}`;

  if (Object.keys(errors).length > 0 || !isLocalCurrency(localCurrency) || !reserve.ok) return { ok: false, errors };
  return { ok: true, data: { displayName, localCurrency, reserveAmount: reserve.value } };
}

export async function saveOnboarding(db: Db, userId: string, input: OnboardingInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, userId));
    await tx
      .insert(rules)
      .values({ userId, localCurrency: input.localCurrency, reserveAmount: input.reserveAmount })
      .onConflictDoUpdate({
        target: rules.userId,
        set: { localCurrency: input.localCurrency, reserveAmount: input.reserveAmount, updatedAt: new Date() },
      });
  });
}
