import { ArrowLeft, CircleCheck, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CopyLink } from "@/components/copy-link";
import { Money } from "@/components/money";
import { InvoiceStatusChip } from "@/components/status-chip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { readPublicEnv } from "@/lib/config/public";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDate } from "@/lib/invoices/dates";
import { getOwnedInvoice } from "@/lib/invoices/repo";
import { isPayAsset } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import { formatTokenAmount } from "@/lib/money/format";

export const metadata: Metadata = { title: `${t("invoices.title")} · ${t("app.name")}` };

export default function InvoicePage(props: PageProps<"/app/invoices/[id]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Link href="/app" className="flex min-h-11 w-fit items-center gap-2 rounded-sm text-primary focus-visible:outline-2 focus-visible:outline-ring">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("invoice.back")}
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Invoice params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Invoice({
  params,
  searchParams,
}: {
  params: PageProps<"/app/invoices/[id]">["params"];
  searchParams: PageProps<"/app/invoices/[id]">["searchParams"];
}) {
  const [{ id }, { created }, user] = await Promise.all([params, searchParams, requireUser()]);
  const owned = await getOwnedInvoice(getDb(), user.id, id);
  if (!owned) notFound();
  const { invoice, recurring, payments } = owned;
  const rates = await getReferenceRatesOrNull();
  const appUrl = readPublicEnv().NEXT_PUBLIC_APP_URL;
  const shareUrl = recurring ? `${appUrl}/r/${recurring.slug}` : `${appUrl}/pay/${invoice.slug}`;

  return (
    <>
      {created === "1" && (
        <p role="status" className="flex items-start gap-2 font-medium text-success">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {t("invoice.created")}
        </p>
      )}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-xl font-semibold">{invoice.clientName}</h1>
            <InvoiceStatusChip status={invoice.status} />
          </div>
          <Money size="lg" amount={displayAmount(invoice.amount, invoice.currency, user.localCurrency, rates)} />
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("invoice.for")}</dt>
              <dd className="text-base">{invoice.description}</dd>
            </div>
            {invoice.dueDate && (
              <div>
                <dt className="sr-only">{t("invoiceForm.dueDate")}</dt>
                <dd>{t("invoices.due", { date: formatDate(invoice.dueDate) })}</dd>
              </div>
            )}
            {recurring && (
              <div>
                <dt className="sr-only">{t("invoiceForm.repeat")}</dt>
                <dd>{t(recurring.interval === "weekly" ? "invoice.repeatsWeekly" : "invoice.repeatsMonthly")}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {invoice.status !== "paid" && invoice.status !== "cancelled" && (
        <section className="flex flex-col gap-3">
          <CopyLink url={shareUrl} label={recurring ? t("invoice.recurringShareLabel") : t("invoice.shareLabel")} />
          <Link
            href={`/pay/${invoice.slug}`}
            target="_blank"
            className="flex min-h-11 w-fit items-center gap-2 rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t("invoice.open")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </Link>
        </section>
      )}

      <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
        <h2 id="payments-heading" className="text-lg font-semibold">
          {t("invoice.payments")}
        </h2>
        {payments.length === 0 ? (
          <p className="text-muted-foreground">{t("invoice.noPayments")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payments.map((payment) => (
              <li key={payment.id} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
                <p className="font-medium">
                  {t("invoice.paidWith", {
                    amount: isPayAsset(payment.asset) ? formatTokenAmount(BigInt(payment.amountAtomic), payment.asset) : payment.amountAtomic,
                    date: formatDate(payment.settledAt),
                  })}
                </p>
                <details className="mt-2 text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
                  <dl className="grid gap-2">
                    <div>
                      <dt className="text-muted-foreground">{t("invoice.payer")}</dt>
                      <dd className="break-all font-mono">{payment.payer}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("invoice.tx")}</dt>
                      <dd>
                        <a
                          href={`https://celoscan.io/tx/${payment.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 break-all font-mono text-primary underline underline-offset-4"
                        >
                          {payment.txHash}
                          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                          <span className="sr-only">{t("invoice.viewTx")}</span>
                        </a>
                      </dd>
                    </div>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
