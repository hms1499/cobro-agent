import { CircleAlert, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { convertFiat } from "@/lib/fx/convert";
import { displayAmount } from "@/lib/money/display";
import { loadTreasuryView } from "@/lib/treasury/view";
import type { AppUser } from "@/lib/users/queries";

const linkBase =
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 font-medium transition-colors duration-100 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const primaryLink = `${linkBase} bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80`;
const outlineLink = `${linkBase} border border-secondary-accent bg-card text-primary hover-tint`;

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
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
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
  const spendingUsd = Number(convertFiat(view.spending, local, "USD", rates));
  const savingsUsd = Number(view.savingsUsd);
  const total = spendingUsd + savingsUsd;
  const spendingPercent = total > 0 ? Math.round((spendingUsd / total) * 100) : null;
  return (
    <>
      <Money size="xl" amount={displayAmount(view.totalUsd, "USD", local, rates)} />
      {spendingPercent !== null && (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="bg-primary" style={{ width: `${spendingPercent}%` }} />
            <div className="flex-1 bg-tint" />
          </div>
          <p className="flex justify-between gap-3 text-sm text-muted-foreground tabular-nums">
            <span>{t("treasury.legend.spending", { amount: displayAmount(view.spending, local, local, rates).primary })}</span>
            <span>{t("treasury.legend.savings", { amount: displayAmount(view.savingsUsd, "USD", local, rates, "billed").primary })}</span>
          </p>
        </div>
      )}
    </>
  );
}
