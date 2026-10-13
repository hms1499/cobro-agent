"use client";

import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { LocalCurrency } from "@/lib/money/currencies";
import { saveRulesAction, type RulesState } from "./actions";

const ADVANCED = [
  { id: "maxSlippagePct", label: "rules.maxSlippage", help: "rules.maxSlippageHelp", mode: "decimal" },
  { id: "hardMaxSlippagePct", label: "rules.hardMaxSlippage", help: "rules.hardMaxSlippageHelp", mode: "decimal" },
  { id: "maxWaitHours", label: "rules.maxWait", help: "rules.maxWaitHelp", mode: "numeric" },
  { id: "perTradeMaxUsd", label: "rules.perTrade", help: "rules.perTradeHelp", mode: "numeric" },
  { id: "dailyMaxUsd", label: "rules.daily", help: "rules.dailyHelp", mode: "numeric" },
] as const;

/** Spec §17.2 Rules: the reserve as a sentence, advanced settings collapsed (open when one has an error). */
export function RulesForm({ currency, values }: { currency: LocalCurrency; values: Record<string, string> }) {
  const [state, action] = useActionState(saveRulesAction, { errors: {}, values, saved: false } satisfies RulesState);
  const reserveHelp = t("rules.reserveHelp");
  const advancedError = ADVANCED.some((field) => state.errors[field.id]);

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <FormField id="reserveAmount" label={t("onboarding.reserveLabel")} help={reserveHelp} error={state.errors.reserveAmount}>
        <p className="flex flex-wrap items-center gap-2 text-base">
          <span aria-hidden="true">{t("onboarding.reserveBefore")}</span>
          <Input
            {...fieldA11y("reserveAmount", { help: reserveHelp, error: state.errors.reserveAmount })}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values.reserveAmount}
            className="h-11 w-40 text-base tabular-nums"
          />
          <span aria-hidden="true">
            {currency} {t("onboarding.reserveAfter")}
          </span>
        </p>
      </FormField>

      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" name="autoTopUp" defaultChecked={state.values.autoTopUp === "on"} className="mt-1 size-4 accent-primary" />
        <span>{t("rules.autoTopUp")}</span>
      </label>

      <details open={advancedError || undefined} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">{t("rules.advanced")}</summary>
        <div className="mt-4 flex flex-col gap-6">
          {ADVANCED.map((field) => (
            <FormField key={field.id} id={field.id} label={t(field.label)} help={t(field.help)} error={state.errors[field.id]}>
              <Input
                {...fieldA11y(field.id, { help: t(field.help), error: state.errors[field.id] })}
                inputMode={field.mode}
                autoComplete="off"
                defaultValue={state.values[field.id]}
                className="h-11 w-32 text-base tabular-nums"
              />
            </FormField>
          ))}
        </div>
      </details>

      <SubmitButton pendingLabel={t("rules.saving")}>{t("rules.save")}</SubmitButton>
      <div aria-live="polite">
        {state.saved && (
          <p className="flex items-center gap-2 text-success">
            <CircleCheck aria-hidden="true" className="size-5" />
            {t("rules.saved")}
          </p>
        )}
      </div>
    </form>
  );
}
