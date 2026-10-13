"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { formFields, type FieldErrors } from "@/lib/forms";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { parseWithdrawForm, withdraw, type WithdrawError, type WithdrawField } from "@/lib/treasury/withdraw";

export interface WithdrawState {
  errors: FieldErrors<WithdrawField>;
  values: Record<string, string>;
  outcome: { kind: "sent"; txHash: string; pending: boolean } | { kind: "error"; error: WithdrawError } | null;
}

export async function withdrawAction(_previous: WithdrawState, formData: FormData): Promise<WithdrawState> {
  const user = await requireUser();
  const fields = formFields(formData);
  if (!user.treasuryAddress) return { errors: {}, values: fields, outcome: { kind: "error", error: "not_ready" } };
  try {
    const deps = liveExecutorDeps();
    const parsed = parseWithdrawForm(fields, await deps.chain.readBalances(user.treasuryAddress));
    if (!parsed.ok) return { errors: parsed.errors, values: fields, outcome: null };
    const result = await withdraw(deps, user.id, parsed.data);
    if (!result.ok) return { errors: {}, values: fields, outcome: { kind: "error", error: result.error } };
    refresh();
    return { errors: {}, values: { asset: fields.asset }, outcome: { kind: "sent", txHash: result.txHash, pending: result.pending } };
  } catch (error) {
    console.error("Withdraw action failed:", error);
    return { errors: {}, values: fields, outcome: { kind: "error", error: "unconfirmed" } };
  }
}
