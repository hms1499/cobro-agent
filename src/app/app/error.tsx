"use client";

import { WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/** Any page in the app that fails to load: what happened, a retry, and a way home. The nav stays usable. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-8 md:px-8">
      <section role="alert" className="enter-in flex flex-col items-start gap-4 rounded-xl bg-card p-6 shadow-sm ring-1 ring-foreground/10">
        <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <WarningCircle aria-hidden="true" weight="fill" className="size-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{t("error.title")}</h1>
          <p className="max-w-prose text-muted-foreground">{t("error.body")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="lg" className="min-h-11 px-4" onClick={() => retry()}>
            {t("common.retry")}
          </Button>
          <Button asChild variant="outline" size="lg" className="min-h-11 px-4">
            <Link href="/app">{t("nav.home")}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
