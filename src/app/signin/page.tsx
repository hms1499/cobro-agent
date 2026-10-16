import { CircleAlert, HandCoins, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ParaProviders } from "@/components/providers/para-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { t } from "@/i18n";
import { readPublicEnv } from "@/lib/config/public";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: `${t("signin.title")} · ${t("app.name")}` };

const STEPS = ["signin.step1", "signin.step2", "signin.step3"] as const;

export default function SignInPage() {
  const env = readPublicEnv();
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Link
        href="/"
        aria-label={t("signin.home")}
        className="flex min-h-11 w-fit items-center gap-2 rounded-lg text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <HandCoins aria-hidden="true" className="size-5" />
        </span>
        {t("app.name")}
      </Link>
      <Card>
        <CardHeader className="gap-2">
          <h1 className="text-2xl font-semibold">{t("signin.title")}</h1>
          <p className="text-muted-foreground">{t("app.tagline")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ol aria-label={t("signin.stepsLabel")} className="flex flex-col gap-3">
            {STEPS.map((key, index) => (
              <li key={key} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-primary"
                >
                  {index + 1}
                </span>
                {t(key)}
              </li>
            ))}
          </ol>
          {env.NEXT_PUBLIC_PARA_API_KEY ? (
            // min-h-15 (60px: button + the error live region gap) holds the space while the Para SDK loads.
            <div className="min-h-15">
              <ParaProviders apiKey={env.NEXT_PUBLIC_PARA_API_KEY} environment={env.NEXT_PUBLIC_PARA_ENVIRONMENT}>
                {/* useSearchParams suspends during prerender */}
                <Suspense fallback={<p className="text-muted-foreground">{t("common.loading")}</p>}>
                  <SignIn />
                </Suspense>
              </ParaProviders>
            </div>
          ) : (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t("signin.missingKey")}
            </p>
          )}
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t("signin.reassure")}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
