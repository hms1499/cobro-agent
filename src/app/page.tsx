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
      <p className="max-w-prose text-muted-foreground">{t("home.status")}</p>
    </main>
  );
}
