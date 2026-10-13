import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { displayAmount } from "@/lib/money/display";
import { formatMoney } from "@/lib/money/format";
import { loadTreasuryView } from "@/lib/treasury/view";
import type { AppUser } from "@/lib/users/queries";

const secondaryLink =
  "inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-primary px-4 font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Spec §17.2 Dashboard: total in local currency, Spending and Savings buckets with a reserve bar, value protected. */
export async function TreasurySummary({ user }: { user: AppUser }) {
  let loaded: Awaited<ReturnType<typeof loadTreasuryView>>;
  try {
    loaded = await loadTreasuryView(user);
  } catch (error) {
    console.error("Treasury view failed:", error instanceof Error ? error.message : error);
    return (
      <p role="alert" className="flex items-start gap-2 text-destructive">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {t("treasury.loadError")}
      </p>
    );
  }
  if (!loaded) return null;
  const { view, rates } = loaded;
  const local = view.local;
  const currencyName = t(`event.target.${local}` as const);
  return (
    <section aria-labelledby="treasury-heading" className="flex flex-col gap-4">
      <h2 id="treasury-heading" className="sr-only">
        {t("treasury.title")}
      </h2>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("treasury.total")}</p>
          <Money size="lg" amount={displayAmount(view.totalUsd, "USD", local, rates)} />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t("treasury.spending", { currency: currencyName })}</p>
            <Money amount={displayAmount(view.spending, local, local, rates)} />
            {view.reservePercent !== null && (
              <>
                <div
                  role="progressbar"
                  aria-label={t("treasury.reserveLabel")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={view.reservePercent}
                  className="h-2 w-full rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${view.reservePercent}%` }} />
                </div>
                <p className="text-sm text-muted-foreground">{t("treasury.reserveOf", { reserve: formatMoney(view.reserve, local) })}</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t("treasury.savings")}</p>
            <Money amount={displayAmount(view.savingsUsd, "USD", local, rates)} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {view.protectedNegative ? t("treasury.behind", { currency: currencyName }) : t("treasury.protected")}
          </p>
          <Money amount={displayAmount(view.protectedUsd, "USD", local, rates)} />
          <p className="max-w-prose text-sm text-muted-foreground">{t("treasury.protectedHelp", { currency: currencyName })}</p>
        </CardContent>
      </Card>
      <Link href="/app/withdraw" className={secondaryLink}>
        {t("treasury.withdraw")}
      </Link>
    </section>
  );
}
