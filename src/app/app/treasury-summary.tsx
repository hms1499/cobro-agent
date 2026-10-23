import { Plus, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { CurrencyBadge } from "@/components/currency-badge";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { displayAmount } from "@/lib/money/display";
import { volumeStats } from "@/lib/treasury/stats";
import { loadTreasuryView } from "@/lib/treasury/view";
import type { AppUser } from "@/lib/users/queries";

const linkBase =
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 font-medium transition-colors duration-100 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const primaryLink = `${linkBase} bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80`;
// Utilities, not `.hover-tint`: that class sits in @layer components and would lose to `bg-card`.
const outlineLink = `${linkBase} border border-secondary-accent bg-card text-primary hover:bg-primary/6 active:bg-primary/12`;

/**
 * Home's money card (spec §4.2, layout A): one total in the local currency, the split between spending
 * money and dollar savings, and the two things to do next. The actions show even when balances can't load.
 */
export async function MoneyCard({ user, primaryAction }: { user: AppUser; primaryAction: boolean }) {
  const actions = (
    <div className="flex gap-3">
      <Link href="/app/invoices/new" className={primaryAction ? primaryLink : outlineLink}>
        <Plus aria-hidden="true" className="size-4" />
        {t("invoices.new")}
      </Link>
      <Link href="/app/withdraw" className={outlineLink}>
        {t("treasury.withdraw")}
      </Link>
    </div>
  );
  let loaded: Awaited<ReturnType<typeof loadTreasuryView>> | "error";
  try {
    loaded = await loadTreasuryView(user);
  } catch (error) {
    console.error("Treasury view failed:", error instanceof Error ? error.message : error);
    loaded = "error";
  }
  const figures: ReactNode =
    loaded === "error" ? (
      <p role="alert" className="flex items-start gap-2 text-destructive">
        <WarningCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {t("treasury.loadError")}
      </p>
    ) : loaded ? (
      <Figures {...loaded} />
    ) : null;
  return (
    <section aria-labelledby="treasury-heading">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 id="treasury-heading" className="text-sm text-muted-foreground">
            {t("treasury.total")}
          </h2>
          {figures}
          {actions}
        </CardContent>
      </Card>
    </section>
  );
}

function Figures({ view, rates }: NonNullable<Awaited<ReturnType<typeof loadTreasuryView>>>) {
  const local = view.local;
  if (local === "USD") {
    return (
      <>
        <Money size="xl" countUp amount={displayAmount(view.totalUsd, "USD", local, rates)} />
        <DollarPockets view={view} rates={rates} />
      </>
    );
  }
  return (
    <>
      <Money size="xl" countUp amount={displayAmount(view.totalUsd, "USD", local, rates)} />
      {/* Spec 4f item D: the two pockets behind the total, each with its currency badge. */}
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        <li className="flex flex-col gap-2 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 text-sm">
              <CurrencyBadge code={local} size="sm" />
              {t("treasury.spending", { currency: local })}
            </span>
            <span className="font-semibold tabular-nums">{displayAmount(view.spending, local, local, rates).primary}</span>
          </div>
          {view.reservePercent !== null && (
            <div className="flex flex-col gap-1 pl-8.5">
              <div
                role="progressbar"
                aria-label={t("treasury.reserveLabel")}
                aria-valuenow={view.reservePercent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${view.reservePercent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("treasury.reserveOf", { reserve: displayAmount(view.reserve, local, local, rates).primary })}
              </p>
            </div>
          )}
        </li>
        <li className="flex items-center justify-between gap-3 py-3">
          <span className="flex items-center gap-2.5 text-sm">
            <CurrencyBadge code="USD" size="sm" />
            {t("treasury.savings")}
          </span>
          <span className="font-semibold tabular-nums">{displayAmount(view.savingsUsd, "USD", local, rates, "billed").primary}</span>
        </li>
      </ul>
    </>
  );
}

/** USD home: one dollars bucket, plus the pesos/reais the agent is about to convert (USD home spec §4.3). */
function DollarPockets({ view, rates }: NonNullable<Awaited<ReturnType<typeof loadTreasuryView>>>) {
  const waiting = Number(view.waitingUsd) > 0;
  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border">
      <li className="flex items-center justify-between gap-3 py-3">
        <span className="flex items-center gap-2.5 text-sm">
          <CurrencyBadge code="USD" size="sm" />
          {t("treasury.dollars")}
        </span>
        <span className="font-semibold tabular-nums">{displayAmount(view.savingsUsd, "USD", "USD", rates).primary}</span>
      </li>
      {waiting && (
        <li className="flex items-center justify-between gap-3 py-3">
          <span className="flex flex-col text-sm">
            {t("treasury.waiting")}
            <span className="text-xs text-muted-foreground">{t("treasury.waitingHelp")}</span>
          </span>
          <span className="font-semibold tabular-nums">{displayAmount(view.waitingUsd, "USD", "USD", rates).primary}</span>
        </li>
      )}
    </ul>
  );
}

/**
 * How the dollar savings compare with keeping every payment in the local currency (spec §10.5), on the
 * Agent tab. The RFQ volume sits behind "Details".
 */
export async function ProtectedCard({ user }: { user: AppUser }) {
  let loaded: Awaited<ReturnType<typeof loadTreasuryView>> | "error";
  let volume: Awaited<ReturnType<typeof volumeStats>> | null = null;
  try {
    [loaded, volume] = await Promise.all([loadTreasuryView(user), volumeStats(getDb(), user.id)]);
  } catch (error) {
    console.error("Value protected failed:", error instanceof Error ? error.message : error);
    loaded = "error";
  }
  if (!loaded || loaded === "error") return null;
  const { view, rates } = loaded;
  // Nothing is held in a local currency, so there is no inflation comparison to show.
  if (view.local === "USD") return null;
  const currencyName = t(`event.target.${view.local}` as const);
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          {view.protectedNegative ? t("treasury.behind", { currency: currencyName }) : t("treasury.protected")}
        </h2>
        <Money size="lg" amount={displayAmount(view.protectedUsd, "USD", view.local, rates)} />
        <p className="max-w-prose text-sm text-muted-foreground">{t("treasury.protectedHelp", { currency: currencyName })}</p>
        {volume && volume.requested > 0 && (
          <details className="text-sm">
            <summary className="hover-tint -mx-2 min-h-11 w-fit cursor-pointer rounded-md px-2 py-2 text-primary">
              {t("common.details")}
            </summary>
            <p className="text-muted-foreground">{t("conversions.volume", { filled: volume.filled, requested: volume.requested })}</p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
