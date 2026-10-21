import { t } from "@/i18n";
import type { SavedAddress } from "./repo";
import type { NewAddress } from "./validate";

/** Plain text. Names the label and the full address so the owner spots one they don't know. */
export function addressCodeEmail(code: string, pending: NewAddress): { subject: string; text: string } {
  const vars = { code, label: pending.label, address: pending.address };
  // The subject carries no code: it shows in lock-screen previews without the warning in the body.
  return { subject: t("email.code.subject"), text: t("email.code.body", vars) };
}

export function addressAddedEmail(saved: SavedAddress): { subject: string; text: string } {
  const vars = { label: saved.label, address: saved.address };
  return { subject: t("email.added.subject"), text: t("email.added.body", vars) };
}
