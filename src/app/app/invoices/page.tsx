import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { ListRow } from "@/components/list-row";
import { LoadingRows } from "@/components/loading-rows";
import { PageHeader } from "@/components/page-header";
import { InvoiceStatusChip } from "@/components/status-chip";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { listInvoices } from "@/lib/invoices/repo";
import { displayAmount } from "@/lib/money/display";
import { invoiceSubtitle } from "../recent";

export const metadata: Metadata = { title: `${t("invoices.title")} · ${t("app.name")}` };

const newInvoiceLink =
  "inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-colors duration-100 ease-in-out hover:bg-primary/90 active:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Every invoice, newest first (spec §4.3, the Invoices tab). */
export default function InvoicesPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
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
      <Suspense fallback={<LoadingRows count={5} />}>
        <Invoices />
      </Suspense>
    </main>
  );
}

async function Invoices() {
  const user = await requireUser();
  const [invoices, rates] = await Promise.all([listInvoices(getDb(), user.id, 50), getReferenceRatesOrNull()]);
  return (
    <Card>
      <CardContent>
        {invoices.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden="true" className="size-6 text-muted-foreground" />}
            title={t("invoices.emptyTitle")}
            body={t("invoices.emptyBody")}
          />
        ) : (
          <ul className="flex flex-col">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <ListRow
                  href={`/app/invoices/${invoice.id}`}
                  title={invoice.clientName}
                  subtitle={invoiceSubtitle(invoice)}
                  amount={displayAmount(invoice.amount, invoice.currency, user.localCurrency, rates, "billed")}
                  status={<InvoiceStatusChip status={invoice.status} />}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
