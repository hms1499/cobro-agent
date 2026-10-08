import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { ParaLoginSpike } from "./para-login";
import { ParaSpikeProvider } from "./para-provider";

export const metadata: Metadata = { title: t("spike.title"), robots: { index: false, follow: false } };

export default function ParaLoginSpikePage() {
  const apiKey = process.env.NEXT_PUBLIC_PARA_API_KEY ?? "";
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center px-4 py-12 md:px-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">{t("spike.title")}</CardTitle>
          <CardDescription>{t("spike.intro")}</CardDescription>
        </CardHeader>
        <CardContent>
          {apiKey ? (
            <ParaSpikeProvider apiKey={apiKey}>
              <ParaLoginSpike />
            </ParaSpikeProvider>
          ) : (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t("spike.missingKey")}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
