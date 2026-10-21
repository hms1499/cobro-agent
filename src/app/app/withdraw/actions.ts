"use server";

import { refresh } from "next/cache";
import { safeErrorTag } from "@/lib/addresses/safe-error";
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
  const fields: Record<string, string> = formFields(formData);
  if (!user.treasuryAddress) return { errors: {}, values: fields, outcome: { kind: "error", error: "not_ready" } };
  try {
    const deps = liveExecutorDeps();
    const parsed = parseWithdrawForm(fields, await deps.chain.readBalances(user.treasuryAddress));
    if (!parsed.ok) return { errors: parsed.errors, values: fields, outcome: null };
    const result = await withdraw(deps, user.id, parsed.data);
    if (!result.ok) return { errors: {}, values: fields, outcome: { kind: "error", error: result.error } };
    refresh();
    return { errors: {}, values: { asset: fields.asset, to: fields.to }, outcome: { kind: "sent", txHash: result.txHash, pending: result.pending } };
  } catch (error) {
    // Only a tag: the error can carry the destination address and label.
    console.error(`Withdraw action failed for ${user.id}:`, safeErrorTag(error));
    return { errors: {}, values: fields, outcome: { kind: "error", error: "unconfirmed" } };
  }
}
