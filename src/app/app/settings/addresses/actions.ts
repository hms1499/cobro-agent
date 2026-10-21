"use server";

import { refresh } from "next/cache";
import type { MessageKey } from "@/i18n";
import { confirmAddressCode, requestAddressCode, type CodeDeps } from "@/lib/addresses/codes";
import { listSavedAddresses, removeSavedAddress } from "@/lib/addresses/repo";
import { parseAddressForm, type AddressField } from "@/lib/addresses/validate";
import { requireUser } from "@/lib/auth/current-user";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { liveEmailSender } from "@/lib/email/send";
import { formFields, type FieldErrors } from "@/lib/forms";

export interface AddressState {
  step: "form" | "code" | "added";
  errors: FieldErrors<AddressField | "code">;
  values: Record<string, string>;
  message: MessageKey | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codeDeps(): CodeDeps {
  return {
    db: getDb(),
    now: () => new Date(),
    secret: requireValue(parseServerEnv().SESSION_SECRET, "SESSION_SECRET"),
    send: liveEmailSender(),
  };
}

/** Step 1 (and "send a new code"): validate the label and address, then email a code. */
export async function requestCodeAction(_previous: AddressState, formData: FormData): Promise<AddressState> {
  const user = await requireUser();
  const fields = formFields(formData);
  const values = { label: fields.label ?? "", address: fields.address ?? "" };
  const resend = fields.resend === "1";
  try {
    const db = getDb();
    const saved = await listSavedAddresses(db, user.id);
    // requestAddressCode trusts its caller, so only validated data reaches it.
    const parsed = parseAddressForm(fields, {
      treasury: user.treasuryAddress,
      personalWallet: user.personalWallet,
      saved: saved.map((a) => a.address),
    });
    if (!parsed.ok) return { step: "form", errors: parsed.errors, values, message: null };
    const result = await requestAddressCode(codeDeps(), user, parsed.data);
    if (!result.ok) {
      return { step: resend ? "code" : "form", errors: {}, values, message: `addresses.error.${result.error}` };
    }
    refresh();
    return { step: "code", errors: {}, values: { label: parsed.data.label, address: parsed.data.address }, message: null };
  } catch (error) {
    console.error("Address code action failed:", error instanceof Error ? error.message : "unknown error");
    return { step: resend ? "code" : "form", errors: {}, values, message: "addresses.error.send_failed" };
  }
}

/** Step 2: check the emailed code and save the address it was requested for. */
export async function confirmCodeAction(_previous: AddressState, formData: FormData): Promise<AddressState> {
  const user = await requireUser();
  const fields = formFields(formData);
  const values = { label: fields.label ?? "", address: fields.address ?? "" };
  try {
    const result = await confirmAddressCode(codeDeps(), user, fields.code ?? "");
    if (!result.ok) {
      if (result.error === "duplicate" || result.error === "full") {
        return { step: "form", errors: {}, values: {}, message: `addresses.error.${result.error}` };
      }
      return { step: "code", errors: { code: `addresses.error.${result.error}` }, values, message: null };
    }
    refresh();
    return { step: "added", errors: {}, values: {}, message: "addresses.added" };
  } catch (error) {
    console.error("Address confirm action failed:", error instanceof Error ? error.message : "unknown error");
    return { step: "code", errors: { code: "addresses.error.invalid" }, values, message: null };
  }
}

export async function removeAddressAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formData.get("id");
  // A crafted value must not reach Postgres as a uuid. The repository also scopes the row to this user.
  if (typeof id !== "string" || !UUID.test(id)) return;
  try {
    await removeSavedAddress(getDb(), user.id, id, new Date());
  } catch (error) {
    console.error("Remove address failed:", error instanceof Error ? error.message : "unknown error");
    return;
  }
  refresh();
}
