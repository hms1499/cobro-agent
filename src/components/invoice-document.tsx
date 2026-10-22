import { LogoMark } from "@/components/logo-mark";
import { t } from "@/i18n";
import { formatDate } from "@/lib/invoices/dates";
import { formatInvoiceNumber } from "@/lib/invoices/view";
import type { FiatCurrency } from "@/lib/money/currencies";
import { formatMoney } from "@/lib/money/format";

export interface InvoiceDocumentProps {
  /** Null while drafting (the new-invoice preview). */
  number: number | null;
  from: { name: string; email?: string | null };
  to: string;
  issued: Date | string;
  due: string | null;
  description: string;
  amount: string;
  currency: FiatCurrency;
  /** The pay page shows parties and the line item only; its own card carries the amount and number. */
  compact?: boolean;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * An invoice that reads like a paper invoice (spec 4f item C): who, to whom, when, what, how much.
 * One component for the detail page, the live preview and the client pay page.
 */
export function InvoiceDocument(props: InvoiceDocumentProps) {
  const { number, from, to, issued, due, description, amount, currency, compact = false } = props;
  const total = formatMoney(amount, currency);
  const body = (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label={t("doc.from")}>
          <span className="font-medium">{from.name}</span>
          {from.email && <span className="block truncate text-muted-foreground">{from.email}</span>}
        </Field>
        <Field label={t("doc.billedTo")}>
          <span className="font-medium">{to || "—"}</span>
        </Field>
        {!compact && (
          <>
            <Field label={t("doc.issued")}>{formatDate(issued)}</Field>
            <Field label={t("doc.due")}>{due ? formatDate(due) : t("doc.onReceipt")}</Field>
          </>
        )}
      </dl>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="pb-2 text-left font-normal">
              {t("doc.description")}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {t("doc.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="py-3 pr-4 align-top break-words">{description || "—"}</td>
            <td className="py-3 text-right align-top whitespace-nowrap tabular-nums">{total}</td>
          </tr>
        </tbody>
        {!compact && (
          <tfoot>
            <tr>
              <th scope="row" className="pt-4 text-left font-medium">
                {t("doc.total")}
              </th>
              <td className="pt-4 text-right text-lg font-semibold whitespace-nowrap tabular-nums">{total}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </>
  );
  if (compact) return <div className="flex flex-col gap-5">{body}</div>;
  return (
    <article
      aria-label={number === null ? t("doc.draft") : formatInvoiceNumber(number)}
      className="flex flex-col gap-7 overflow-hidden rounded-xl border-t-4 border-primary bg-card p-6 shadow-md ring-1 ring-foreground/10 sm:p-8"
    >
      <header className="flex items-start justify-between gap-4">
        <span className="flex min-w-0 items-center gap-2.5">
          <LogoMark className="size-8 shrink-0" />
          <span className="truncate font-semibold">{from.name}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-2xl font-light tracking-tight">{t("doc.invoice")}</span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {number === null ? t("doc.draft") : formatInvoiceNumber(number)}
          </span>
        </span>
      </header>
      {body}
    </article>
  );
}
