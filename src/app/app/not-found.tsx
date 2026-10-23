import { ArrowLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { InvoicesIllustration } from "@/components/illustrations";
import { t } from "@/i18n";

/** Inside the app (an invoice that is not yours or no longer exists): the nav stays, Invoices is one tap away. */
export default function AppNotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-8 md:px-8">
      <EmptyState
        illustration={<InvoicesIllustration />}
        title={t("notFound.appTitle")}
        body={t("notFound.appBody")}
        action={
          <Link
            href="/app/invoices"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-colors duration-100 ease-in-out hover:bg-primary/90 active:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("notFound.toInvoices")}
          </Link>
        }
      />
    </main>
  );
}
