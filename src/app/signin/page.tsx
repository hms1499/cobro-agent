import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ParaProviders } from "@/components/providers/para-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { readPublicEnv } from "@/lib/config/public";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: `${t("signin.title")} · ${t("app.name")}` };

export default function SignInPage() {
  const env = readPublicEnv();
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center px-4 py-12 md:px-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">{t("signin.title")}</CardTitle>
          <CardDescription>{t("signin.intro")}</CardDescription>
        </CardHeader>
        <CardContent>
          {env.NEXT_PUBLIC_PARA_API_KEY ? (
            <ParaProviders apiKey={env.NEXT_PUBLIC_PARA_API_KEY} environment={env.NEXT_PUBLIC_PARA_ENVIRONMENT}>
              {/* useSearchParams suspends during prerender */}
              <Suspense fallback={<p className="text-muted-foreground">{t("common.loading")}</p>}>
                <SignIn />
              </Suspense>
            </ParaProviders>
          ) : (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t("signin.missingKey")}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
