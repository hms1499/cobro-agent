"use client";

import { CircleAlert } from "lucide-react";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { FIAT_CURRENCIES, type FiatCurrency } from "@/lib/money/currencies";
import { createInvoiceAction, type InvoiceFormState } from "./actions";

const REPEATS = ["none", "weekly", "monthly"] as const;
const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive";

export function InvoiceForm({ defaultCurrency }: { defaultCurrency: FiatCurrency }) {
  const [state, action] = useActionState(createInvoiceAction, {
    errors: {},
    values: { currency: defaultCurrency, repeat: "none" },
  } satisfies InvoiceFormState);
  const { errors, values } = state;
  const amountHelp = t("invoiceForm.amountHelp");
  const repeatHelp = t("invoiceForm.repeatHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <div aria-live="polite">
        {state.notReady && (
          <p className="flex items-start gap-2 text-destructive" role="alert">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t("invoiceForm.notReady")}
          </p>
        )}
      </div>

      <FormField id="clientName" label={t("invoiceForm.client")} error={errors.clientName}>
        <Input {...fieldA11y("clientName", { error: errors.clientName })} autoComplete="organization" defaultValue={values.clientName} className="h-11 text-base" />
      </FormField>

      <FormField id="description" label={t("invoiceForm.description")} error={errors.description}>
        <Input {...fieldA11y("description", { error: errors.description })} autoComplete="off" defaultValue={values.description} className="h-11 text-base" />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <FormField id="amount" label={t("invoiceForm.amount")} help={amountHelp} error={errors.amount}>
          <Input
            {...fieldA11y("amount", { help: amountHelp, error: errors.amount })}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={values.amount}
            className="h-11 text-base tabular-nums"
          />
        </FormField>
        <FormField id="currency" label={t("invoiceForm.currency")} error={errors.currency}>
          <select {...fieldA11y("currency", { error: errors.currency })} defaultValue={values.currency} className={selectClass}>
            {FIAT_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {t(`currency.${code}` as const)}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="repeat" label={t("invoiceForm.repeat")} help={repeatHelp} error={errors.repeat}>
          <select {...fieldA11y("repeat", { help: repeatHelp, error: errors.repeat })} defaultValue={values.repeat} className={selectClass}>
            {REPEATS.map((repeat) => (
              <option key={repeat} value={repeat}>
                {t(`invoiceForm.repeat.${repeat}` as const)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="dueDate" label={t("invoiceForm.dueDate")} error={errors.dueDate}>
          <Input {...fieldA11y("dueDate", { error: errors.dueDate })} type="date" defaultValue={values.dueDate} className="h-11 text-base" />
        </FormField>
      </div>

      <SubmitButton pendingLabel={t("invoiceForm.saving")}>{t("invoiceForm.submit")}</SubmitButton>
    </form>
  );
}
