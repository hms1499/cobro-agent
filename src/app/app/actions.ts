"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
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
