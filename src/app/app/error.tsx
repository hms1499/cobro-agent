"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-4 px-4 py-8 md:px-8">
      <p role="alert" className="flex items-start gap-2 text-destructive">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {t("invoices.loadError")}
      </p>
      <Button type="button" size="lg" className="min-h-11" onClick={() => retry()}>
        {t("common.retry")}
      </Button>
    </main>
  );
}
