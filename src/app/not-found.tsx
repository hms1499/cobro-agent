import { ArrowLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { t } from "@/i18n";

/** Unknown URLs and unknown pay or recurring links: say what may have happened and offer a way back. */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col items-start justify-center gap-5 px-4 py-16">
      <LogoMark className="size-10" />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary tabular-nums">404</p>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">{t("notFound.title")}</h1>
        <p className="text-muted-foreground">{t("notFound.body")}</p>
      </div>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-colors duration-100 ease-in-out hover:bg-primary/90 active:bg-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("signin.backHome")}
      </Link>
    </main>
  );
}
