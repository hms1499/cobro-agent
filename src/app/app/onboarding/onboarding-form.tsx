"use client";

import { useActionState, useState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { LOCAL_CURRENCIES, type LocalCurrency } from "@/lib/money/currencies";
import { completeOnboarding, type OnboardingState } from "./actions";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState(completeOnboarding, {
    errors: {},
    values: { displayName: defaultName, localCurrency: "ARS", reserveAmount: "" },
  } satisfies OnboardingState);
  const [currency, setCurrency] = useState<LocalCurrency>(state.values.localCurrency === "BRL" ? "BRL" : "ARS");
  const reserveHelp = t("onboarding.reserveHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <FormField id="displayName" label={t("onboarding.name")} help={t("onboarding.nameHelp")} error={state.errors.displayName}>
        <Input
          {...fieldA11y("displayName", { help: t("onboarding.nameHelp"), error: state.errors.displayName })}
          autoComplete="organization"
          defaultValue={state.values.displayName}
          className="h-11 text-base"
        />
      </FormField>

      <fieldset className="flex flex-col gap-2" aria-describedby={state.errors.localCurrency ? "localCurrency-error" : undefined}>
        <legend className="mb-2 text-sm font-medium">{t("onboarding.currency")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {LOCAL_CURRENCIES.map((code) => (
            <label
              key={code}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-4 py-3 has-checked:border-primary has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name="localCurrency"
                value={code}
                checked={currency === code}
                onChange={() => setCurrency(code)}
                className="size-4 accent-primary"
              />
              <span className="font-medium">{t(`currency.${code}` as const)}</span>
            </label>
          ))}
        </div>
        {state.errors.localCurrency && (
          <p id="localCurrency-error" className="text-sm text-destructive">
            {t(state.errors.localCurrency)}
          </p>
        )}
      </fieldset>

      <FormField id="reserveAmount" label={t("onboarding.reserveLabel")} help={reserveHelp} error={state.errors.reserveAmount}>
        <p className="flex flex-wrap items-center gap-2 text-base">
          <span aria-hidden="true">{t("onboarding.reserveBefore")}</span>
          <Input
            {...fieldA11y("reserveAmount", { help: reserveHelp, error: state.errors.reserveAmount })}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            defaultValue={state.values.reserveAmount}
            className="h-11 w-40 text-base tabular-nums"
          />
          <span aria-hidden="true">
            {currency} {t("onboarding.reserveAfter")}
          </span>
        </p>
      </FormField>

      <SubmitButton pendingLabel={t("onboarding.saving")}>{t("onboarding.submit")}</SubmitButton>
    </form>
  );
}
