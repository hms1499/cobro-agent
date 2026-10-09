import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { InvoiceStatusChip } from "@/components/status-chip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/invoices/dates";
import { resolveRecurringLink } from "@/lib/invoices/repo";
import { formatMoney } from "@/lib/money/format";

export const metadata: Metadata = { title: `${t("pay.title")} · ${t("app.name")}`, robots: { index: false, follow: false } };

export default function RecurringPage(props: PageProps<"/r/[slug]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <p className="text-sm font-semibold text-primary">{t("app.name")}</p>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Recurring params={props.params} />
      </Suspense>
    </main>
  );
}

async function Recurring({ params }: { params: PageProps<"/r/[slug]">["params"] }) {
  const { slug } = await params;
  const link = await resolveRecurringLink(getDb(), slug);
  if (!link) notFound();
  // Spec §9.1: the stable link always opens the current period's invoice.
  if (link.kind === "open") redirect(`/pay/${link.invoiceSlug}`);

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("recurring.title", { name: link.freelancerName ?? t("app.name") })}</h1>
      <p className="text-muted-foreground">{link.description}</p>
      {link.paid.length === 0 ? (
        <p>{t("recurring.none")}</p>
      ) : (
        <>
          <p role="status" className="flex items-center gap-2 font-medium text-success">
            <CircleCheck aria-hidden="true" className="size-5" />
            {t("recurring.allPaid")}
          </p>
          <ul className="flex flex-col gap-3">
            {link.paid.map((period) => (
              <li key={period.slug}>
                <Card>
                  <CardContent className="flex items-start justify-between gap-4">
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">
                        {period.periodStart ? t("recurring.period", { date: formatDate(period.periodStart) }) : link.clientName}
                      </span>
                      {period.paidAt && (
                        <span className="text-sm text-muted-foreground">{t("recurring.paidOn", { date: formatDate(period.paidAt) })}</span>
                      )}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{formatMoney(period.amount, period.currency)}</span>
                      <InvoiceStatusChip status="paid" />
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
