import { ArrowRight, Gauge, LockKeyhole, ShieldCheck } from "lucide-react";
import { t } from "@/i18n";
import { formatMoney } from "@/lib/money/format";
import { container, sectionIntro, sectionTitle } from "./styles";

// An example figure, labelled as such on the page (landing spec anti-goals).
const EXAMPLE_PROTECTED_ARS = "38940";
const RULES = [
  { icon: LockKeyhole, title: "landing.agent.ask.title", body: "landing.agent.ask.body" },
  { icon: Gauge, title: "landing.agent.limits.title", body: "landing.agent.limits.body" },
  { icon: ArrowRight, title: "landing.agent.onlyYou.title", body: "landing.agent.onlyYou.body" },
] as const;

/** "Your agent" (landing spec §3.6): the spending/savings split with an example figure, and three limits. */
export function AgentPanel() {
  return (
    <section className="py-16 md:py-24">
      <div className={container}>
        <h2 className={sectionTitle}>{t("landing.agent.title")}</h2>
        <p className={`mt-4 ${sectionIntro}`}>{t("landing.agent.intro")}</p>
        <div className="mt-11 grid grid-cols-1 gap-5 md:grid-cols-3">
          <div className="grid grid-cols-1 items-end gap-8 rounded-2xl bg-foreground p-7 text-primary-foreground md:col-span-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-10 md:p-9">
            <div>
              <span className="grid size-10 place-items-center rounded-xl bg-tint/15 text-tint">
                <ShieldCheck aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-3.5 text-xl font-semibold tracking-tight">{t("landing.agent.split.title")}</h3>
              <p className="mt-1.5 text-[0.95rem] text-primary-foreground/70">{t("landing.agent.split.body")}</p>
            </div>
            <div className="border-t border-primary-foreground/15 pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8">
              <p className="text-sm text-primary-foreground/60">{t("landing.agent.protected")}</p>
              <p className="text-[2.75rem] leading-tight font-bold tracking-tight tabular-nums">{formatMoney(EXAMPLE_PROTECTED_ARS, "ARS")}</p>
              <p className="text-sm text-primary-foreground/60">{t("landing.agent.protectedNote")}</p>
            </div>
          </div>
          {RULES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl bg-card p-6 ring-1 ring-foreground/8">
              <span className="grid size-10 place-items-center rounded-xl bg-tint/40 text-primary">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-3.5 text-lg font-semibold tracking-tight">{t(title)}</h3>
              <p className="mt-1.5 text-[0.95rem] text-muted-foreground">{t(body)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
