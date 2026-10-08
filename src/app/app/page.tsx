import { CircleAlert, Clock, FileText, Plus, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Money } from "@/components/money";
import { InvoiceStatusChip } from "@/components/status-chip";
import { SubmitButton } from "@/components/submit-button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDate } from "@/lib/invoices/dates";
import { listInvoices } from "@/lib/invoices/repo";
import { displayAmount } from "@/lib/money/display";
import type { AppUser } from "@/lib/users/queries";
import { finishSetup } from "./actions";

export const metadata: Metadata = { title: `${t("nav.home")} · ${t("app.name")}` };

const primaryLink =
  "inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function AppHomePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Suspense fallback={<HomeSkeleton />}>
        <Home />
      </Suspense>
    </main>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("common.loading")}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

async function Home() {
  const user = await requireUser();
  const [invoices, rates] = await Promise.all([listInvoices(getDb(), user.id), getReferenceRatesOrNull()]);
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("app.greeting", { name: user.displayName ?? user.email ?? "" })}</h1>
      <SetupBanner status={user.treasuryStatus} />
      <section aria-labelledby="invoices-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="invoices-heading" className="text-lg font-semibold">
            {t("invoices.title")}
          </h2>
          {invoices.length > 0 && (
            <Link href="/app/invoices/new" className={primaryLink}>
              <Plus aria-hidden="true" className="size-4" />
              {t("invoices.new")}
            </Link>
          )}
        </div>
        {invoices.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-card p-6 shadow-sm ring-1 ring-foreground/10">
            <FileText aria-hidden="true" className="size-6 text-muted-foreground" />
            <p className="font-semibold">{t("invoices.emptyTitle")}</p>
            <p className="max-w-prose text-muted-foreground">{t("invoices.emptyBody")}</p>
            <Link href="/app/invoices/new" className={primaryLink}>
              <Plus aria-hidden="true" className="size-4" />
              {t("invoices.emptyAction")}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/app/invoices/${invoice.id}`}
                  className="flex cursor-pointer items-start justify-between gap-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 font-medium">
                      {invoice.clientName}
                      {invoice.recurringId && (
                        <>
                          <Repeat aria-hidden="true" className="size-4 text-muted-foreground" />
                          <span className="sr-only">{t("invoices.repeats")}</span>
                        </>
                      )}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{invoice.description}</span>
                    <InvoiceStatusChip status={invoice.status} />
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <Money amount={displayAmount(invoice.amount, invoice.currency, user.localCurrency, rates)} />
                    {invoice.dueDate && invoice.status === "open" && (
                      <span className="text-sm text-muted-foreground">{t("invoices.due", { date: formatDate(invoice.dueDate) })}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// Not exported: a page module may only export Next.js page fields.
function SetupBanner({ status }: { status: AppUser["treasuryStatus"] }) {
  if (status === "ready") return null;
  const failed = status === "failed" || status === "missing";
  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className={`flex items-start gap-2 ${failed ? "text-destructive" : "text-warning"}`}>
        {failed ? (
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        ) : (
          <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        )}
        {failed ? t("setup.failed") : t("setup.creating")}
      </p>
      <form action={finishSetup}>
        <SubmitButton pendingLabel={t("setup.working")}>{t("setup.retry")}</SubmitButton>
      </form>
    </section>
  );
}
