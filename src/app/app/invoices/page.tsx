import { Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { InvoicesIllustration } from "@/components/illustrations";
import { InitialAvatar } from "@/components/initial-avatar";
import { ListRow } from "@/components/list-row";
import { LoadingRows } from "@/components/loading-rows";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCards } from "@/components/summary-cards";
import { PageHeader } from "@/components/page-header";
import { InvoiceStatusChip } from "@/components/status-chip";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { isoDate } from "@/lib/invoices/dates";
import { listInvoices } from "@/lib/invoices/repo";
import { displayStatus, filterInvoices, formatInvoiceNumber, INVOICE_FILTERS, parseInvoiceFilter, summarizeInvoices } from "@/lib/invoices/view";
import { displayAmount } from "@/lib/money/display";
import { invoiceSubtitle } from "../recent";
import { FilterTabs } from "./filter-tabs";
import { InvoiceTable } from "./invoice-table";

export const metadata: Metadata = { title: `${t("invoices.title")} · ${t("app.name")}` };

const newInvoiceLink =
  "inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-colors duration-100 ease-in-out hover:bg-primary/90 active:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Every invoice, newest first, with totals and filters (spec 4f item B). */
export default function InvoicesPage(props: PageProps<"/app/invoices">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <PageHeader
        title={t("invoices.title")}
        intro={t("invoices.pageIntro")}
        action={
          <Link href="/app/invoices/new" className={newInvoiceLink}>
            <Plus aria-hidden="true" className="size-4" />
            {t("invoices.new")}
          </Link>
        }
      />
      <Suspense
        fallback={
          <div className="flex flex-col gap-6" aria-busy="true" aria-label={t("common.loading")}>
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-13 w-80 rounded-lg" />
            <LoadingRows count={5} />
          </div>
        }
      >
        <Invoices searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

// Totals count every invoice; the list shows the newest 500 (spec 4f §4.1).
const LIMIT = 500;

async function Invoices({ searchParams }: { searchParams: PageProps<"/app/invoices">["searchParams"] }) {
  const [{ status }, user] = await Promise.all([searchParams, requireUser()]);
  const filter = parseInvoiceFilter(status);
  const [all, rates] = await Promise.all([listInvoices(getDb(), user.id, LIMIT), getReferenceRatesOrNull()]);
  const now = new Date();
  const today = isoDate(now);
  const rows = filterInvoices(all, filter, today);
  const counts = Object.fromEntries(INVOICE_FILTERS.map((f) => [f, filterInvoices(all, f, today).length])) as Record<
    (typeof INVOICE_FILTERS)[number],
    number
  >;
  return (
    <>
      <SummaryCards summary={summarizeInvoices(all, rates, now, user.localCurrency ?? "USD")} local={user.localCurrency} rates={rates} />
      <FilterTabs current={filter} counts={counts} />
      <Card className="py-0">
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <EmptyState
              illustration={<InvoicesIllustration />}
              title={t(`invoices.empty.${filter}.title` as const)}
              body={t(`invoices.empty.${filter}.body` as const)}
            />
          ) : (
            <>
              <div className="hidden md:block">
                <InvoiceTable rows={rows} local={user.localCurrency} rates={rates} today={today} />
              </div>
              <ul className="enter-stagger flex flex-col p-2 md:hidden">
                {rows.map((invoice) => (
                  <li key={invoice.id}>
                    <ListRow
                      href={`/app/invoices/${invoice.id}`}
                      leading={<InitialAvatar name={invoice.clientName} />}
                      title={invoice.clientName}
                      subtitle={`${formatInvoiceNumber(invoice.number)}, ${invoiceSubtitle(invoice)}`}
                      amount={displayAmount(invoice.amount, invoice.currency, user.localCurrency, rates, "billed")}
                      status={<InvoiceStatusChip status={displayStatus(invoice, today)} size="sm" />}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
