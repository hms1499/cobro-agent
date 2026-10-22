import Link from "next/link";
import { t, type MessageKey } from "@/i18n";
import { INVOICE_FILTERS, type InvoiceFilter } from "@/lib/invoices/view";

const LABELS: Record<InvoiceFilter, MessageKey> = {
  all: "invoices.filter.all",
  open: "invoices.filter.open",
  overdue: "invoices.filter.overdue",
  paid: "invoices.filter.paid",
};

/** Spec 4f item B: server-rendered links, so a filter is a URL that can be shared or reloaded. */
export function FilterTabs({ current, counts }: { current: InvoiceFilter; counts: Record<InvoiceFilter, number> }) {
  return (
    <nav aria-label={t("invoices.filter.label")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1">
        {INVOICE_FILTERS.map((filter) => {
          const active = filter === current;
          return (
            <li key={filter}>
              <Link
                href={filter === "all" ? "/app/invoices" : `/app/invoices?status=${filter}`}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  active ? "bg-card text-foreground shadow-sm" : "hover-tint text-muted-foreground"
                }`}
              >
                {t(LABELS[filter])}
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-tint/45 text-primary" : "bg-card/70"}`}>
                  {counts[filter]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
