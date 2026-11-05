import { t } from "@/i18n";

/** The sentence before a "turn it on" confirmation. `decision` is `loadDecisionText`'s output, null when it can't be worked out. */
export function wouldDoText(decision: string | null): string {
  return decision === null ? t("rules.previewUnavailable") : t("agent.wouldDo", { what: decision });
}
