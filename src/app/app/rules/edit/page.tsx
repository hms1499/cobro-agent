import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import type { RulesRow } from "@/lib/db/schema";
import { getRulesRow } from "@/lib/treasury/request-reads";
import { rulesFormValues } from "@/lib/treasury/rules-form";
import type { AppUser } from "@/lib/users/queries";
import { loadDecisionText } from "../preview-text";
import { RulesForm } from "../rules-form";

export const metadata: Metadata = { title: `${t("rules.editTitle")} · ${t("app.name")}` };

export default function EditRulesPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Link
        href="/app/rules"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("rules.back")}
      </Link>
      <PageHeader title={t("rules.editTitle")} intro={t("rules.intro")} />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <EditRules />
      </Suspense>
    </main>
  );
}

async function EditRules() {
  const user = await requireUser();
  const row = await getRulesRow(user.id);
  if (!row) redirect("/app/onboarding");
  // A dollars freelancer has no reserve to edit; the summary on the Agent tab explains why.
  if (row.localCurrency === "USD") redirect("/app/rules");
  return (
    <Card>
      <CardContent>
        <section aria-labelledby="rules-heading" className="flex flex-col gap-4">
          <h2 id="rules-heading" className="text-lg font-semibold">
            {t("rules.formTitle")}
          </h2>
          <Suspense fallback={<Skeleton className="h-16 w-full" />}>
            <Preview user={user} row={row} />
          </Suspense>
          <RulesForm currency={row.localCurrency} values={rulesFormValues(row)} />
        </section>
      </CardContent>
    </Card>
  );
}

async function Preview({ user, row }: { user: AppUser; row: RulesRow }) {
  if (!user.treasuryAddress) return null;
  const text = await loadDecisionText(user, row);
  if (text === null) return <p className="text-muted-foreground">{t("rules.previewUnavailable")}</p>;
  return (
    <p role="status" className="rounded-xl bg-muted p-4">
      <span className="font-medium">{t("rules.preview")}</span> {text}
    </p>
  );
}
