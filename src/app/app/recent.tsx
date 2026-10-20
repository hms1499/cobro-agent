import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ListRow } from "@/components/list-row";
import { InvoiceStatusChip } from "@/components/status-chip";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { buildRecent } from "@/lib/dashboard/recent";
import { getDb } from "@/lib/db/client";
import type { InvoiceRow } from "@/lib/db/schema";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDate } from "@/lib/invoices/dates";
import { listInvoices } from "@/lib/invoices/repo";
import { displayAmount } from "@/lib/money/display";
import { describeEvent } from "@/lib/treasury/explain";
import { listEvents } from "@/lib/treasury/repo";
import type { AppUser } from "@/lib/users/queries";
import { TONES } from "./activity-feed";

const footerLink =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 hover-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** "Description, due Oct 23" or "Description, paid Oct 9" (an invoice row's second line). */
export function invoiceSubtitle(invoice: InvoiceRow): string {
  if (invoice.paidAt) return t("invoices.rowPaid", { description: invoice.description, date: formatDate(invoice.paidAt) });
  if (invoice.dueDate && invoice.status === "open") {
    return t("invoices.rowDue", { description: invoice.description, date: formatDate(invoice.dueDate) });
  }
  return invoice.description;
}

/** Home's "Recent" (spec §4.2): invoices and agent actions together, newest first. */
export async function Recent({ user }: { user: AppUser }) {
  const db = getDb();
  const [invoices, events, rates] = await Promise.all([listInvoices(db, user.id, 10), listEvents(db, user.id, 10), getReferenceRatesOrNull()]);
  const items = buildRecent(invoices, events);
  return (
    <section aria-labelledby="recent-heading">
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 id="recent-heading" className="px-3 text-lg font-semibold">
            {t("home.recent.title")}
          </h2>
          {items.length === 0 ? (
            <EmptyState
              icon={<FileText aria-hidden="true" className="size-6 text-muted-foreground" />}
              title={t("invoices.emptyTitle")}
              body={t("home.recent.empty")}
              action={
                <Link href="/app/invoices/new" className={footerLink}>
                  <Plus aria-hidden="true" className="mr-1 size-4" />
                  {t("invoices.emptyAction")}
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col">
              {items.map((item) => {
                if (item.kind === "invoice") {
                  const invoice = item.invoice;
                  return (
                    <li key={`i-${invoice.id}`}>
                      <ListRow
                        href={`/app/invoices/${invoice.id}`}
                        title={invoice.clientName}
                        subtitle={invoiceSubtitle(invoice)}
                        amount={displayAmount(invoice.amount, invoice.currency, user.localCurrency, rates, "billed")}
                        status={<InvoiceStatusChip status={invoice.status} />}
                      />
                    </li>
                  );
                }
                const view = describeEvent(item.event, { local: user.localCurrency, rates });
                const { icon: Icon, className } = TONES[view.tone];
                return (
                  <li key={`e-${item.event.id}`}>
                    <ListRow
                      href="/app/rules#history"
                      icon={<Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${className}`} />}
                      title={view.title}
                      subtitle={formatDate(item.event.createdAt)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t pt-2">
              <Link href="/app/invoices" className={footerLink}>
                {t("home.recent.allInvoices")}
              </Link>
              <Link href="/app/rules#history" className={footerLink}>
                {t("home.recent.agentHistory")}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
