"use client";

import { WarningCircle } from "@phosphor-icons/react/ssr";
import { useActionState, useState, type FormEvent } from "react";
import { CurrencyIcon } from "@/components/currency-icon";
import { FormField, fieldA11y } from "@/components/form-field";
import { InvoiceDocument } from "@/components/invoice-document";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { FIAT_CURRENCIES, isFiatCurrency, type FiatCurrency } from "@/lib/money/currencies";
import { parseFiatInput } from "@/lib/money/input";
import { createInvoiceAction, type InvoiceFormState } from "./actions";

const REPEATS = ["none", "weekly", "monthly"] as const;
const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive";

interface Draft {
  clientName: string;
  description: string;
  amount: string;
  currency: FiatCurrency;
  dueDate: string;
}

function readDraft(form: HTMLFormElement): Draft {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? "");
  const currency = text("currency");
  return {
    clientName: text("clientName"),
    description: text("description"),
    amount: text("amount"),
    currency: isFiatCurrency(currency) ? currency : "USD",
    dueDate: text("dueDate"),
  };
}

/**
 * The new-invoice form with a live preview of the invoice the client will get (spec 4f item C, desktop
 * only). Inputs stay uncontrolled for the server action; the preview reads the form on every change.
 */
export function InvoiceForm({
  defaultCurrency,
  from,
  today,
}: {
  defaultCurrency: FiatCurrency;
  from: { name: string; email: string | null };
  /** YYYY-MM-DD from the server, so the preview's issue date matches the server render. */
  today: string;
}) {
  const [state, action] = useActionState(createInvoiceAction, {
    errors: {},
    values: { currency: defaultCurrency, repeat: "none" },
  } satisfies InvoiceFormState);
  const { errors, values } = state;
  const [draft, setDraft] = useState<Draft>({
    clientName: values.clientName ?? "",
    description: values.description ?? "",
    amount: values.amount ?? "",
    currency: isFiatCurrency(values.currency) ? values.currency : defaultCurrency,
    dueDate: values.dueDate ?? "",
  });
  const onChange = (event: FormEvent<HTMLFormElement>) => setDraft(readDraft(event.currentTarget));
  const amount = parseFiatInput(draft.amount);
  const amountHelp = t("invoiceForm.amountHelp");
  const repeatHelp = t("invoiceForm.repeatHelp");

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={action} onChange={onChange} noValidate className="flex flex-col gap-6">
        <div aria-live="polite">
          {state.notReady && (
            <p className="enter-in flex items-start gap-2 text-destructive" role="alert">
              <WarningCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
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

        <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
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
            {/* An <option> cannot hold an icon, so the chosen currency's flag sits inside the field. */}
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
                <CurrencyIcon code={draft.currency} size="sm" />
              </span>
              <select
                {...fieldA11y("currency", { error: errors.currency })}
                defaultValue={values.currency}
                className={`${selectClass} pl-11`}
              >
                {FIAT_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {t(`currency.${code}` as const)}
                  </option>
                ))}
              </select>
            </div>
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
      <section aria-label={t("invoiceForm.preview")} className="hidden flex-col gap-3 lg:sticky lg:top-8 lg:flex">
        <h2 className="text-sm text-muted-foreground">{t("invoiceForm.preview")}</h2>
        <InvoiceDocument
          number={null}
          from={from}
          to={draft.clientName.trim()}
          issued={today}
          due={/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) ? draft.dueDate : null}
          description={draft.description.trim()}
          amount={amount.ok ? amount.value : "0"}
          currency={draft.currency}
        />
      </section>
    </div>
  );
}
