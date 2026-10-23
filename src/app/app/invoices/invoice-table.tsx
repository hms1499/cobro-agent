import Link from "next/link";
import { InitialAvatar } from "@/components/initial-avatar";
import { InvoiceStatusChip } from "@/components/status-chip";
import { t } from "@/i18n";
import type { ReferenceRates } from "@/lib/fx/rates";
import { formatDate } from "@/lib/invoices/dates";
import type { NumberedInvoice } from "@/lib/invoices/repo";
import { displayStatus, formatInvoiceNumber } from "@/lib/invoices/view";
import type { HomeCurrency } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";

const th = "px-4 py-3 text-left text-xs font-medium text-muted-foreground";
const td = "px-4 py-3 align-middle";

/**
 * Desktop invoice table (spec 4f item B). The client cell holds the row's link, stretched over the
 * whole row, so the row is one focus stop and one click target.
 */
export function InvoiceTable({
  rows,
  local,
  rates,
  today,
}: {
  rows: NumberedInvoice[];
  local: HomeCurrency | null;
  rates: ReferenceRates | null;
  today: string;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="border-b border-border">
        <tr>
          <th scope="col" className={th}>
            {t("invoices.col.client")}
          </th>
          <th scope="col" className={th}>
            {t("invoices.col.number")}
          </th>
          <th scope="col" className={th}>
            {t("invoices.col.issued")}
          </th>
          <th scope="col" className={th}>
            {t("invoices.col.due")}
          </th>
          <th scope="col" className={th}>
            {t("invoices.col.status")}
          </th>
          <th scope="col" className={`${th} text-right`}>
            {t("invoices.col.amount")}
          </th>
        </tr>
      </thead>
      <tbody className="enter-stagger divide-y divide-border">
        {rows.map((invoice) => {
          const amount = displayAmount(invoice.amount, invoice.currency, local, rates, "billed");
          return (
            <tr key={invoice.id} className="relative transition-colors duration-[20ms] ease-in hover:bg-primary/6 has-focus-visible:bg-primary/6">
              <td className={td}>
                <Link
                  href={`/app/invoices/${invoice.id}`}
                  className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                >
                  <InitialAvatar name={invoice.clientName} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{invoice.clientName}</span>
                    <span className="max-w-[18rem] truncate text-muted-foreground">{invoice.description}</span>
                  </span>
                </Link>
              </td>
              <td className={`${td} whitespace-nowrap text-muted-foreground tabular-nums`}>{formatInvoiceNumber(invoice.number)}</td>
              <td className={`${td} whitespace-nowrap`}>{formatDate(invoice.createdAt)}</td>
              <td className={`${td} whitespace-nowrap`}>{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</td>
              <td className={td}>
                <InvoiceStatusChip status={displayStatus(invoice, today)} size="sm" />
              </td>
              <td className={`${td} text-right tabular-nums`}>
                <span className="block whitespace-nowrap font-semibold">{amount.primary}</span>
                {amount.secondary && <span className="block whitespace-nowrap text-muted-foreground">{amount.secondary}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
