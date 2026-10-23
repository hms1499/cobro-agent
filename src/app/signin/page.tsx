import { ArrowLeft, Receipt, ShieldCheck, Vault, WarningCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LogoMark } from "@/components/logo-mark";
import { ParaProviders } from "@/components/providers/para-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { readPublicEnv } from "@/lib/config/public";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: `${t("signin.title")} · ${t("app.name")}` };

const STEPS = ["signin.step1", "signin.step2", "signin.step3"] as const;

const POINTS = [
  { icon: Receipt, key: "signin.panel.invoice" },
  { icon: Vault, key: "signin.panel.agent" },
  { icon: ShieldCheck, key: "signin.panel.receipts" },
] as const;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Sign-in: on desktop a brand panel (what Cobro does) beside the form; on mobile the form alone. Para's
 * email modal opens over it on load, so the page mostly frames that moment and explains the three steps.
 */
export default function SignInPage() {
  const env = readPublicEnv();
  return (
    <div className="flex flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <BrandPanel />
      <main id="main" className="flex flex-1 flex-col px-4 py-6 md:px-8">
        <Link
          href="/"
          className={`hover-tint -ml-3 flex min-h-11 w-fit items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground ${focusRing}`}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("signin.backHome")}
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
          <div className="flex flex-col gap-5">
            <LogoMark className="size-10 lg:hidden" />
            <div className="flex flex-col gap-2">
              <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{t("signin.title")}</h1>
              <p className="text-muted-foreground">{t("signin.subtitle")}</p>
            </div>
          </div>
          <ol aria-label={t("signin.stepsLabel")} className="flex flex-col">
            {STEPS.map((key, index) => (
              <li key={key} className="relative flex gap-3 pb-5 last:pb-0">
                {index < STEPS.length - 1 && (
                  <span aria-hidden="true" className="absolute top-8 bottom-1 left-3.5 w-px bg-border" />
                )}
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tint/35 text-sm font-semibold text-primary tabular-nums ring-1 ring-primary/15"
                >
                  {index + 1}
                </span>
                <span className="pt-0.5">{t(key)}</span>
              </li>
            ))}
          </ol>
          {env.NEXT_PUBLIC_PARA_API_KEY ? (
            // min-h-15 (60px: button + the error live region gap) holds the space while the Para SDK loads.
            <div className="min-h-15">
              <ParaProviders apiKey={env.NEXT_PUBLIC_PARA_API_KEY} environment={env.NEXT_PUBLIC_PARA_ENVIRONMENT}>
                {/* useSearchParams suspends during prerender; the skeleton has the button's shape */}
                <Suspense fallback={<Skeleton aria-label={t("common.loading")} className="h-11 w-full rounded-lg" />}>
                  <SignIn />
                </Suspense>
              </ParaProviders>
            </div>
          ) : (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <WarningCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t("signin.missingKey")}
            </p>
          )}
          <p className="flex items-start gap-2.5 border-t border-border pt-5 text-sm text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t("signin.reassure")}
          </p>
        </div>
      </main>
    </div>
  );
}

/** Desktop only: the promise and three plain facts on the brand blue. Decorative glow in token colours. */
function BrandPanel() {
  return (
    <aside
      aria-label={t("signin.panel.label")}
      className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -right-32 size-[34rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--tint)_45%,transparent),transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 -left-24 size-[28rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--highlight)_22%,transparent),transparent)]"
      />
      <Link href="/" aria-label={t("signin.home")} className="relative flex min-h-11 w-fit items-center gap-2.5 rounded-lg text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground">
        <span className="rounded-[10px] bg-primary-foreground p-0.5">
          <LogoMark className="size-8" />
        </span>
        {t("app.name")}
      </Link>
      <div className="relative flex max-w-md flex-col gap-10">
        <div className="flex flex-col gap-4">
          <p className="text-[2.5rem] leading-[1.05] font-bold tracking-[-0.03em] text-balance">{t("app.tagline")}</p>
          <p className="text-lg text-primary-foreground/80">{t("landing.hero.intro")}</p>
        </div>
        <ul className="flex flex-col gap-5">
          {POINTS.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/12 ring-1 ring-primary-foreground/20">
                <Icon aria-hidden="true" weight="duotone" className="size-5" />
              </span>
              <span className="pt-1.5 text-primary-foreground/90">{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-sm text-primary-foreground/75">{t("signin.panel.footer")}</p>
    </aside>
  );
}
