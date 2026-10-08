import { CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/invoices/dates";
import { findPublicInvoice } from "@/lib/invoices/repo";
import { formatMoney } from "@/lib/money/format";
import { PayInvoice } from "./pay-invoice";

export const metadata: Metadata = { title: `${t("pay.title")} · ${t("app.name")}`, robots: { index: false, follow: false } };

export default function PayPage(props: PageProps<"/pay/[slug]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <p className="text-sm font-semibold text-primary">{t("app.name")}</p>
      <Suspense fallback={<Skeleton className="h-[28rem] w-full" />}>
        <Pay params={props.params} />
      </Suspense>
    </main>
  );
}

async function Pay({ params }: { params: PageProps<"/pay/[slug]">["params"] }) {
  const { slug } = await params;
  const invoice = await findPublicInvoice(getDb(), slug);
  if (!invoice) notFound();

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("pay.from", { name: invoice.freelancerName ?? t("app.name") })}</p>
          <h1 className="text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(invoice.amount, invoice.currency)}</h1>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("invoice.for")}</dt>
              <dd className="text-base">{invoice.description}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("pay.billedTo")}</dt>
              <dd className="text-base">{invoice.clientName}</dd>
            </div>
            {invoice.dueDate && (
              <div>
                <dt className="sr-only">{t("invoiceForm.dueDate")}</dt>
                <dd>{t("invoices.due", { date: formatDate(invoice.dueDate) })}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {invoice.status === "paid" ? (
        <p role="status" className="flex items-start gap-2 font-medium text-success">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {t("pay.alreadyPaid")}
          {invoice.recurringSlug && (
            <Link href={`/r/${invoice.recurringSlug}`} className="ml-1 text-primary underline underline-offset-4">
              {t("recurring.history")}
            </Link>
          )}
        </p>
      ) : invoice.status === "cancelled" || !invoice.payTo ? (
        <p role="alert" className="flex items-start gap-2 text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {invoice.status === "cancelled" ? t("pay.cancelled") : t("pay.notReady")}
        </p>
      ) : (
        <WalletProviders>
          <PayInvoice slug={invoice.slug} />
        </WalletProviders>
      )}
    </>
  );
}
