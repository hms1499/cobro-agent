"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { logEvent } from "@/lib/treasury/repo";
import { paraRestClient } from "@/lib/users/para";
import { ensureTreasuryWallet } from "@/lib/users/provision";

/** Retries treasury wallet creation for the signed-in user ("Finish setup"). */
export async function finishSetup(): Promise<void> {
  const user = await requireUser({ allowOnboarding: true });
  try {
    await ensureTreasuryWallet(getDb(), user.id, paraRestClient());
  } catch (error) {
    console.error("Treasury wallet setup failed:", error instanceof Error ? error.message : error);
  }
  redirect(user.localCurrency ? "/app" : "/app/onboarding");
}

/** The "Pause agent" / "Resume agent" control (spec §17.1 principle 4). */
export async function setAgentEnabled(formData: FormData): Promise<void> {
  const user = await requireUser();
  const enabled = formData.get("enabled") === "true";
  const db = getDb();
  const now = new Date();
  await db.update(rules).set({ enabled, updatedAt: now }).where(eq(rules.userId, user.id));
  await logEvent(db, user.id, enabled ? "resumed" : "paused", {}, now);
  refresh();
}
