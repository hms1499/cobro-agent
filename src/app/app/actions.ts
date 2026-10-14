"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { formFields } from "@/lib/forms";
import { intentEventData, parseProposalForm } from "@/lib/treasury/approvals";
import { runTreasuryAfterApproval } from "@/lib/treasury/live";
import { approveProposal, cancelProposals, dismissProposal, logEvent } from "@/lib/treasury/repo";
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
  // Trade approvals §5.3: a paused agent has nothing to propose; this is not a dismissal.
  if (!enabled) await cancelProposals(db, user.id, now);
  await logEvent(db, user.id, enabled ? "resumed" : "paused", {}, now);
  refresh();
}

export interface ProposalState {
  outcome: "approved" | "dismissed" | "changed" | null;
}

/** Trade approvals §5.2: approve what the banner showed, then run the agent at once. */
export async function approveProposalAction(_previous: ProposalState, formData: FormData): Promise<ProposalState> {
  const user = await requireUser();
  const form = parseProposalForm(formFields(formData));
  if (!form) {
    refresh();
    return { outcome: "changed" };
  }
  const db = getDb();
  const now = new Date();
  const intent = await db.transaction(async (tx) => {
    const row = await approveProposal(tx, user.id, form.intentId, form.seenAtomic, now);
    if (row) await logEvent(tx, user.id, "approved", intentEventData(row), now);
    return row;
  });
  if (!intent) {
    refresh();
    return { outcome: "changed" };
  }
  after(() => runTreasuryAfterApproval(user.id));
  refresh();
  return { outcome: "approved" };
}

/** Trade approvals §5.2: drop the proposal; its group stays quiet for 24 hours. */
export async function dismissProposalAction(_previous: ProposalState, formData: FormData): Promise<ProposalState> {
  const user = await requireUser();
  const form = parseProposalForm(formFields(formData));
  if (!form) {
    refresh();
    return { outcome: "changed" };
  }
  const db = getDb();
  const now = new Date();
  const intent = await db.transaction(async (tx) => {
    const row = await dismissProposal(tx, user.id, form.intentId, now);
    if (row) await logEvent(tx, user.id, "dismissed", intentEventData(row), now);
    return row;
  });
  if (!intent) {
    refresh();
    return { outcome: "changed" };
  }
  refresh();
  return { outcome: "dismissed" };
}
