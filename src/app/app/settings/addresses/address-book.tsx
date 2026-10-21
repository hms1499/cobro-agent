"use client";

import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { confirmCodeAction, removeAddressAction, requestCodeAction, type AddressState } from "./actions";

export interface AddressItem {
  id: string;
  label: string;
  address: string;
  /** Whole hours left before the address can receive money, rounded up; null when it is ready. */
  hoursLeft: number | null;
}

export function AddressList({ items }: { items: AddressItem[] }) {
  if (items.length === 0) return <p className="text-muted-foreground">{t("addresses.empty")}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* The label is user text: React text only, never HTML. */}
            <p className="min-w-0 break-words font-medium">{item.label}</p>
            {item.hoursLeft === null ? (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-success">
                <CircleCheck aria-hidden="true" className="size-4" />
                {t("addresses.ready")}
              </span>
            ) : (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-warning">
                <Clock aria-hidden="true" className="size-4" />
                {t("addresses.waiting", { hours: item.hoursLeft })}
              </span>
            )}
          </div>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
            <p className="break-all font-mono text-sm">{item.address}</p>
          </details>
          <form action={removeAddressAction}>
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" variant="outline" size="lg" className="min-h-11">
              {t("addresses.remove")}
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}

export function AddAddress({ email, pending }: { email: string; pending: { label: string; address: string } | null }) {
  const [state, action] = useActionState(
    async (previous: AddressState, formData: FormData): Promise<AddressState> => {
      const intent = formData.get("intent");
      if (intent === "reset") return { step: "form", errors: {}, values: {}, message: null };
      if (intent === "confirm") return confirmCodeAction(previous, formData);
      return requestCodeAction(previous, formData);
    },
    pending
      ? ({ step: "code", errors: {}, values: pending, message: null } satisfies AddressState)
      : ({ step: "form", errors: {}, values: {}, message: null } satisfies AddressState),
  );
  const labelHelp = t("addresses.labelHelp");
  const addressHelp = t("addresses.addressHelp");
  const problem = state.message && state.step !== "added" && (
    <p role="alert" className="flex items-start gap-2 text-destructive">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      {t(state.message)}
    </p>
  );

  if (state.step === "code") {
    const label = state.values.label ?? "";
    const address = state.values.address ?? "";
    return (
      <section aria-labelledby="add-title" className="flex flex-col gap-4">
        <h2 id="add-title" className="text-lg font-semibold">
          {t("addresses.addTitle")}
        </h2>
        <p>{t("addresses.codeSent", { email, label })}</p>
        <form action={action} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="confirm" />
          <input type="hidden" name="label" value={label} />
          <input type="hidden" name="address" value={address} />
          <FormField id="code" label={t("addresses.code")} error={state.errors.code}>
            <Input
              {...fieldA11y("code", { error: state.errors.code })}
              inputMode="numeric"
              autoComplete="one-time-code"
              defaultValue=""
              className="h-11 w-48 text-base tabular-nums"
            />
          </FormField>
          {problem}
          <SubmitButton pendingLabel={t("addresses.confirming")}>{t("addresses.confirm")}</SubmitButton>
        </form>
        <div className="flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="intent" value="request" />
            <input type="hidden" name="resend" value="1" />
            <input type="hidden" name="label" value={label} />
            <input type="hidden" name="address" value={address} />
            <Button type="submit" variant="outline" size="lg" className="min-h-11">
              {t("addresses.resend")}
            </Button>
          </form>
          <form action={action}>
            <input type="hidden" name="intent" value="reset" />
            <Button type="submit" variant="ghost" size="lg" className="min-h-11">
              {t("addresses.different")}
            </Button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="add-title" className="flex flex-col gap-4">
      <h2 id="add-title" className="text-lg font-semibold">
        {t("addresses.addTitle")}
      </h2>
      <div aria-live="polite">
        {state.step === "added" && state.message && (
          <p className="flex items-start gap-2 text-success">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t(state.message)}
          </p>
        )}
      </div>
      <form action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="request" />
        <FormField id="label" label={t("addresses.label")} help={labelHelp} error={state.errors.label}>
          <Input
            {...fieldA11y("label", { help: labelHelp, error: state.errors.label })}
            autoComplete="off"
            maxLength={80}
            defaultValue={state.values.label ?? ""}
            className="h-11 text-base"
          />
        </FormField>
        <FormField id="address" label={t("addresses.address")} help={addressHelp} error={state.errors.address}>
          <Input
            {...fieldA11y("address", { help: addressHelp, error: state.errors.address })}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.values.address ?? ""}
            className="h-11 font-mono text-base"
          />
        </FormField>
        {problem}
        <SubmitButton pendingLabel={t("addresses.sending")}>{t("addresses.sendCode")}</SubmitButton>
      </form>
    </section>
  );
}
