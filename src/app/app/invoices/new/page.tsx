import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { InvoiceForm } from "./invoice-form";

export const metadata: Metadata = { title: `${t("invoiceForm.title")} · ${t("app.name")}` };

export default function NewInvoicePage(props: PageProps<"/app/invoices/new">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
        <NewInvoice searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function NewInvoice({ searchParams }: { searchParams: PageProps<"/app/invoices/new">["searchParams"] }) {
  const [{ first }, user] = await Promise.all([searchParams, requireUser()]);
  const onboarding = first === "1";
  return (
    <>
      {onboarding && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">{t("onboarding.step", { step: 3, total: 3 })}</p>
          <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden="true">
            <div className="h-full w-full rounded-full bg-primary" />
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("invoiceForm.title")}</h1>
        {onboarding && (
          <Link href="/app" className="min-h-11 rounded-sm py-2 text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            {t("invoiceForm.skip")}
          </Link>
        )}
      </div>
      {onboarding && <p className="text-muted-foreground">{t("invoiceForm.firstStep")}</p>}
      <InvoiceForm defaultCurrency={user.localCurrency ?? "USD"} />
    </>
  );
}
