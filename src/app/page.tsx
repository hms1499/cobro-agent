import Link from "next/link";
import { t } from "@/i18n";

export default function Home() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-6 px-4 py-16 md:px-8"
    >
      <p className="text-sm font-medium text-primary">{t("app.name")}</p>
      <h1 className="max-w-[20ch] text-balance text-3xl font-semibold tracking-tight md:text-5xl">
        {t("app.tagline")}
      </h1>
      <p className="max-w-prose text-muted-foreground">{t("home.how")}</p>
      <Link
        href="/signin"
        className="inline-flex min-h-11 w-fit items-center rounded-lg bg-primary px-5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t("home.start")}
      </Link>
      <Link
        href="/agent-card.json"
        className="w-fit rounded-sm text-primary underline underline-offset-4 transition-colors hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t("home.agentCard")}
      </Link>
    </main>
  );
}
