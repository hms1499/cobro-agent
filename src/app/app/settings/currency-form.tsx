"use client";

import { CheckCircle } from "@phosphor-icons/react/ssr";
import { useActionState, useState } from "react";
import { CurrencyIcon } from "@/components/currency-icon";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { formatMoney } from "@/lib/money/format";
import { HOME_CURRENCIES, type HomeCurrency } from "@/lib/money/currencies";
import type { SwitchConsequences } from "@/lib/users/home-currency";
import { changeHomeCurrencyAction, type CurrencyFormState } from "./currency-actions";

const IDLE: CurrencyFormState = { errors: {}, saved: false };
const radio =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-4 py-3 transition-colors duration-[20ms] ease-in hover:bg-primary/6 has-checked:border-primary has-checked:bg-tint/35 has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring";

/**
 * Change what the freelancer lives in (USD home currency spec §2.4–2.6). A different currency is only
 * saved after an inline confirmation that says what the agent will do with the money already held.
 */
export function CurrencyForm({
  current,
  reserve,
  consequences,
  minutes,
}: {
  current: HomeCurrency;
  /** The saved reserve, in `current`. */
  reserve: string;
  /** Per target currency, computed on the server from live balances. */
  consequences: Record<HomeCurrency, SwitchConsequences>;
  minutes: number;
}) {
  const [state, action] = useActionState(changeHomeCurrencyAction, IDLE);
  const [home, setHome] = useState<HomeCurrency>(current);
  const [asking, setAsking] = useState(false);
  const switching = home !== current;
  const reserveHelp = t("onboarding.reserveHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("onboarding.currency")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {HOME_CURRENCIES.map((code) => (
            <label key={code} className={radio}>
              <input
                type="radio"
                name="home"
                value={code}
                checked={home === code}
                onChange={() => {
                  setHome(code);
                  setAsking(false);
                }}
                className="size-4 accent-primary"
              />
              <CurrencyIcon code={code} />
              <span className="font-medium">{t(`currency.${code}` as const)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {home === "USD" ? (
        <p className="text-sm text-muted-foreground">{t("onboarding.usdHelp")}</p>
      ) : (
        <FormField id="reserveAmount" label={t("onboarding.reserveLabel")} help={reserveHelp} error={state.errors.reserveAmount}>
          <p className="flex flex-wrap items-center gap-2 text-base">
            <span aria-hidden="true">{t("onboarding.reserveBefore")}</span>
            <Input
              {...fieldA11y("reserveAmount", { help: reserveHelp, error: state.errors.reserveAmount })}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              key={home}
              defaultValue={home === current ? reserve : ""}
              className="h-11 w-40 text-base tabular-nums"
            />
            <span aria-hidden="true">
              {home} {t("onboarding.reserveAfter")}
            </span>
          </p>
        </FormField>
      )}

      {state.saved && !switching && (
        <p role="status" className="enter-in flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle aria-hidden="true" className="size-4" />
          {t("settings.currencySaved")}
        </p>
      )}

      {switching && asking ? (
        <div className="flex flex-col gap-3 rounded-lg bg-highlight/60 p-4 ring-1 ring-foreground/10">
          <p className="font-medium">{t("settings.currencyConfirmTitle", { currency: t(`currency.${home}` as const) })}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {consequences[home].converts.map((c) => (
              <li key={c.asset}>{t("settings.currencyConvertLine", { amount: formatMoney(c.amount, c.currency), minutes })}</li>
            ))}
            {home !== "USD" && <li>{t("settings.currencyBuyLine", { currency: home })}</li>}
            {home === "USD" && consequences.USD.converts.length === 0 && <li>{t("settings.currencyNothing")}</li>}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton pendingLabel={t("invoice.working")}>{t("settings.currencyYes")}</SubmitButton>
            <Button type="button" variant="ghost" size="lg" className="min-h-11" onClick={() => setAsking(false)}>
              {t("settings.currencyNo", { currency: t(`currency.${current}` as const) })}
            </Button>
          </div>
        </div>
      ) : switching ? (
        <Button type="button" variant="outline" size="lg" className="min-h-11 w-fit" onClick={() => setAsking(true)}>
          {t("settings.currencyChange")}
        </Button>
      ) : (
        home !== "USD" && (
          <SubmitButton variant="outline" pendingLabel={t("invoice.working")}>
            {t("settings.currencySaveReserve")}
          </SubmitButton>
        )
      )}
    </form>
  );
}
