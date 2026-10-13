"use client";

import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { Money } from "@/components/money";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { PayAsset } from "@/lib/money/currencies";
import type { DisplayAmount } from "@/lib/money/display";
import { withdrawAction, type WithdrawState } from "./actions";

export interface WithdrawOption {
  asset: PayAsset;
  label: string;
  available: DisplayAmount;
}

export function WithdrawForm({ options, destination }: { options: WithdrawOption[]; destination: string | null }) {
  const [state, action] = useActionState(withdrawAction, {
    errors: {},
    values: { asset: options[0].asset },
    outcome: null,
  } satisfies WithdrawState);
  const amountHelp = t("withdraw.amountHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2" aria-describedby={state.errors.asset ? "asset-error" : undefined}>
        <legend className="mb-2 text-sm font-medium">{t("withdraw.asset")}</legend>
        {options.map((option) => (
          <label
            key={option.asset}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-card px-4 py-3 has-checked:border-primary has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="asset"
                value={option.asset}
                defaultChecked={(state.values.asset ?? options[0].asset) === option.asset}
                className="size-4 accent-primary"
              />
              <span className="font-medium">{option.label}</span>
            </span>
            <span className="flex flex-col items-end text-right">
              <span className="text-xs text-muted-foreground">{t("withdraw.available")}</span>
              <Money amount={option.available} />
            </span>
          </label>
        ))}
        {state.errors.asset && (
          <p id="asset-error" role="alert" className="text-sm text-destructive">
            {t(state.errors.asset)}
          </p>
        )}
      </fieldset>

      <FormField id="amount" label={t("withdraw.amount")} help={amountHelp} error={state.errors.amount}>
        <Input
          {...fieldA11y("amount", { help: amountHelp, error: state.errors.amount })}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={state.values.amount ?? ""}
          className="h-11 w-48 text-base tabular-nums"
        />
      </FormField>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" name="all" defaultChecked={state.values.all === "on"} className="size-4 accent-primary" />
        {t("withdraw.all")}
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <p>{t("withdraw.destination")}</p>
        {destination && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
            <p className="text-muted-foreground">{t("withdraw.address")}</p>
            <p className="break-all font-mono">{destination}</p>
          </details>
        )}
      </div>

      <SubmitButton pendingLabel={t("withdraw.sending")}>{t("withdraw.submit")}</SubmitButton>

      <div aria-live="polite">
        {state.outcome?.kind === "sent" && (
          <div className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
            <p className="flex items-start gap-2 text-success">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {state.outcome.pending ? t("withdraw.pending") : t("withdraw.sent")}
            </p>
            <a
              href={`https://celoscan.io/tx/${state.outcome.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 w-fit items-center gap-1 text-primary underline underline-offset-4"
            >
              {t("withdraw.viewTx")}
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
            <Link href="/app" className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4">
              {t("withdraw.back")}
            </Link>
          </div>
        )}
        {state.outcome?.kind === "error" && (
          <p role="alert" className="flex items-start gap-2 text-destructive">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t(`withdraw.error.${state.outcome.error}` as const)}
          </p>
        )}
      </div>
    </form>
  );
}
