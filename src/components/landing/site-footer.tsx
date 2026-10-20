import { t } from "@/i18n";
import { container, ghostLink } from "./styles";

const REPO_URL = "https://github.com/hms1499/cobro-agent";

export function SiteFooter() {
  return (
    <footer className="border-t py-10 text-sm text-muted-foreground">
      <div className={`${container} flex flex-wrap items-start justify-between gap-6`}>
        <div>
          <p className="font-bold text-foreground">{t("app.name")}</p>
          <p>{t("landing.footer.about")}</p>
        </div>
        <nav aria-label={t("landing.footer.label")} className="flex flex-wrap gap-1">
          <a href="/agent-card.json" className={ghostLink}>
            {t("landing.footer.agentCard")}
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={ghostLink}>
            {t("landing.footer.github")}
          </a>
          <a href="/signin" className={ghostLink}>
            {t("landing.nav.signIn")}
          </a>
        </nav>
      </div>
    </footer>
  );
}
