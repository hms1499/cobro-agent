import { CheckCircle, ShieldCheck, WarningCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InvoiceDocument } from "@/components/invoice-document";
import { LogoMark } from "@/components/logo-mark";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/invoices/dates";
import { findPublicInvoice } from "@/lib/invoices/repo";
import { formatInvoiceNumber } from "@/lib/invoices/view";
import { formatMoney } from "@/lib/money/format";
import { PayInvoice } from "./pay-invoice";

export const metadata: Metadata = { title: `${t("pay.title")} · ${t("app.name")}`, robots: { index: false, follow: false } };

/** Spec 4f item E (Stripe's hosted invoice): a brand band, the invoice, then the payment card. */
export default function PayPage(props: PageProps<"/pay/[slug]">) {
  return (
    <div className="relative flex flex-1 flex-col">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-56 bg-primary" />
      <main id="main" className="relative mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-8 md:px-8">
        <Suspense fallback={<Skeleton className="h-[28rem] w-full rounded-xl" />}>
          <Pay params={props.params} />
        </Suspense>
        <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="size-4" />
          {t("pay.trust")}
        </p>
      </main>
    </div>
  );
}

async function Pay({ params }: { params: PageProps<"/pay/[slug]">["params"] }) {
  const { slug } = await params;
  const invoice = await findPublicInvoice(getDb(), slug);
  if (!invoice) notFound();
  const freelancer = invoice.freelancerName ?? t("app.name");

  return (
    <>
      <header className="flex min-h-11 items-center gap-3 pb-2 text-primary-foreground">
        <span className="rounded-[10px] bg-primary-foreground p-0.5">
          <LogoMark className="size-7" />
        </span>
        <span className="font-semibold">{freelancer}</span>
      </header>
      <Card className="shadow-md">
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-4xl font-semibold tracking-tight tabular-nums">{formatMoney(invoice.amount, invoice.currency)}</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {invoice.dueDate ? t("invoices.due", { date: formatDate(invoice.dueDate) }) : t("pay.dueOnReceipt")}
              <span aria-hidden="true" className="px-2">
                /
              </span>
              {formatInvoiceNumber(invoice.number)}
            </p>
          </div>
          <InvoiceDocument
            compact
            number={invoice.number}
            from={{ name: freelancer }}
            to={invoice.clientName}
            due={invoice.dueDate}
            description={invoice.description}
            amount={invoice.amount}
            currency={invoice.currency}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {invoice.status === "paid" ? (
            <p role="status" className="flex items-start gap-2 font-medium text-success">
              <CheckCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t("pay.alreadyPaid")}
              {invoice.recurringSlug && (
                <Link href={`/r/${invoice.recurringSlug}`} className="ml-1 text-primary underline underline-offset-4">
                  {t("recurring.history")}
                </Link>
              )}
            </p>
          ) : invoice.status === "cancelled" || !invoice.payTo ? (
            <p role="alert" className="flex items-start gap-2 text-destructive">
              <WarningCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {invoice.status === "cancelled" ? t("pay.cancelled") : t("pay.notReady")}
            </p>
          ) : (
            <WalletProviders>
              <PayInvoice slug={invoice.slug} />
            </WalletProviders>
          )}
        </CardContent>
      </Card>
    </>
  );
}
