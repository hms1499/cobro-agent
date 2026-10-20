import { t } from "@/i18n";
import { formatMoney } from "@/lib/money/format";
import { FlapBoard } from "./flap-board";
import { container, primaryAction } from "./styles";

/**
 * Landing hero, option L3 (landing spec §3.2–3.3): headline, email capture, three true facts, and the
 * split-flap board. The form is a plain GET to /signin, so it works before the page hydrates.
 */
export function Hero({ agentId }: { agentId: number | undefined }) {
  const facts = [
    { value: "4", label: t("landing.hero.fact.currencies") },
    { value: formatMoney("0", "USD", undefined, { whole: true }), label: t("landing.hero.fact.fee") },
    ...(agentId !== undefined ? [{ value: `#${agentId}`, label: t("landing.hero.fact.identity") }] : []),
  ];
  return (
    <section className="pt-10 pb-16 md:pt-16 md:pb-24">
      <div className={`${container} grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14`}>
        <div>
          <h1 className="max-w-[12ch] text-[2.6rem] leading-[1.02] font-bold tracking-[-0.04em] text-balance sm:text-6xl lg:text-[4rem]">
            {t("landing.hero.title")}
          </h1>
          <p className="mt-5 max-w-[42ch] text-lg text-muted-foreground">{t("landing.hero.intro")}</p>
          <form action="/signin" method="get" className="mt-7 flex max-w-[460px] gap-2 rounded-xl bg-card p-1.5 ring-1 ring-foreground/10 focus-within:ring-2 focus-within:ring-ring">
            <label htmlFor="landing-email" className="sr-only">
              {t("landing.hero.emailLabel")}
            </label>
            <input
              id="landing-email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder={t("landing.hero.emailPlaceholder")}
              className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground"
            />
            <button type="submit" className={primaryAction}>
              {t("landing.start")}
            </button>
          </form>
          <dl aria-label={t("landing.hero.factsLabel")} className="mt-9 grid max-w-[520px] grid-cols-3 border-t">
            {facts.map((fact, i) => (
              <div key={fact.label} className={`flex flex-col pt-3.5 pr-2.5 sm:pr-3.5 ${i > 0 ? "border-l pl-2.5 sm:pl-3.5" : ""}`}>
                <dt className="order-2 text-xs text-muted-foreground sm:text-[0.8rem]">{fact.label}</dt>
                <dd className="order-1 text-lg font-bold tracking-tight tabular-nums sm:text-[1.375rem]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="grid place-items-center rounded-3xl bg-[linear-gradient(160deg,color-mix(in_oklch,var(--tint)_38%,transparent),color-mix(in_oklch,var(--tint)_8%,transparent)_60%,color-mix(in_oklch,var(--highlight)_35%,transparent))] p-5 sm:p-8">
          <FlapBoard />
        </div>
      </div>
    </section>
  );
}
