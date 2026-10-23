"use client";

import { ArrowSquareOut, CheckCircle, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { Money } from "@/components/money";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { PayAsset } from "@/lib/money/currencies";
import type { DisplayAmount } from "@/lib/money/display";
import { destinationName, type WithdrawDestination } from "./options";
import { withdrawAction, type WithdrawState } from "./actions";

export interface WithdrawOption {
  asset: PayAsset;
  label: string;
  available: DisplayAmount;
}

export function WithdrawForm({ options, destinations }: { options: WithdrawOption[]; destinations: WithdrawDestination[] }) {
  const [state, action] = useActionState(withdrawAction, {
    errors: {},
    values: { asset: options[0].asset },
    outcome: null,
  } satisfies WithdrawState);
  const firstUsable = destinations.find((d) => d.usableInHours === null)?.value;
  const chosenTo = destinations.find((d) => d.value === state.values.to && d.usableInHours === null)?.value ?? firstUsable;
  const sentTo = destinationName(destinations, state.values.to);
  const hasSaved = destinations.some((d) => d.value !== "personal");
  const amountHelp = t("withdraw.amountHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2" aria-describedby={state.errors.asset ? "asset-error" : undefined}>
        <legend className="mb-2 text-sm font-medium">{t("withdraw.asset")}</legend>
        {options.map((option) => (
          <label
            key={option.asset}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-card px-4 py-3 transition-colors duration-[20ms] ease-in hover:bg-primary/6 has-checked:border-primary has-checked:bg-tint/35 has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
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

      <fieldset className="flex flex-col gap-2" aria-describedby={state.errors.to ? "to-error" : undefined}>
        <legend className="mb-2 text-sm font-medium">{t("withdraw.to")}</legend>
        {destinations.map((d) => {
          const waiting = d.usableInHours !== null;
          return (
            <label
              key={d.value}
              className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border border-input bg-card px-4 py-3 transition-colors duration-[20ms] ease-in has-checked:border-primary has-checked:bg-tint/35 has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring ${waiting ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-primary/6"}`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="to"
                  value={d.value}
                  disabled={waiting}
                  defaultChecked={d.value === chosenTo}
                  className="size-4 accent-primary"
                />
                <span className="font-medium">{d.label}</span>
              </span>
              {waiting && <span className="text-xs text-muted-foreground">{t("withdraw.waiting", { hours: d.usableInHours ?? 0 })}</span>}
            </label>
          );
        })}
        {state.errors.to && (
          <p id="to-error" role="alert" className="text-sm text-destructive">
            {t(state.errors.to)}
          </p>
        )}
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-primary">{t("common.details")}</summary>
          <ul className="flex flex-col gap-2 text-sm">
            {destinations.map((d) => (
              <li key={d.value}>
                <span className="text-muted-foreground">{d.label}</span>
                <p className="break-all font-mono">{d.address}</p>
              </li>
            ))}
          </ul>
        </details>
        {hasSaved && <p className="text-sm text-muted-foreground">{t("addresses.warning")}</p>}
        <Link href="/app/settings/addresses" className="inline-flex min-h-11 w-fit items-center text-sm text-primary underline underline-offset-4">
          {t("withdraw.addAddress")}
        </Link>
      </fieldset>

      <SubmitButton pendingLabel={t("withdraw.sending")}>{t("withdraw.submit")}</SubmitButton>

      <div aria-live="polite">
        {state.outcome?.kind === "sent" && (
          <div className="enter-in flex flex-col gap-2 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
            <p className="flex items-start gap-2 text-success">
              <CheckCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {state.outcome.pending ? t("withdraw.pending", { destination: sentTo }) : t("withdraw.sent", { destination: sentTo })}
            </p>
            <a
              href={`https://celoscan.io/tx/${state.outcome.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 w-fit items-center gap-1 text-primary underline underline-offset-4"
            >
              {t("withdraw.viewTx")}
              <ArrowSquareOut aria-hidden="true" className="size-4" />
            </a>
            <Link href="/app" className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4">
              {t("withdraw.back")}
            </Link>
          </div>
        )}
        {state.outcome?.kind === "error" && (
          <p role="alert" className="enter-in flex items-start gap-2 text-destructive">
            <WarningCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t(`withdraw.error.${state.outcome.error}` as const)}
          </p>
        )}
      </div>
    </form>
  );
}
