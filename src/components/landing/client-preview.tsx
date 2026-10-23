import { Clock, CurrencyCircleDollar, Repeat } from "@phosphor-icons/react/ssr";
import { t } from "@/i18n";
import { EXAMPLE_ARS_PER_USD, EXAMPLE_BRL_PER_USD } from "@/lib/landing/examples";
import { formatMoney } from "@/lib/money/format";
import { container, sectionIntro, sectionTitle } from "./styles";

const PAID_USD = 300;
const POINTS = [
  { icon: CurrencyCircleDollar, title: "landing.clients.point1.title", body: "landing.clients.point1.body" },
  { icon: Clock, title: "landing.clients.point2.title", body: "landing.clients.point2.body" },
  { icon: Repeat, title: "landing.clients.point3.title", body: "landing.clients.point3.body" },
] as const;

/** "For your clients" (landing spec §3.5): three points beside a preview of the pay page. */
export function ClientPreview() {
  const options = [
    { name: t("asset.USAT.name"), note: t("landing.clients.preview.recommended"), amount: formatMoney(String(PAID_USD), "USD"), on: true },
    { name: t("asset.USDT.name"), amount: formatMoney(String(PAID_USD), "USD") },
    { name: t("asset.WARS.name"), amount: formatMoney(String(PAID_USD * EXAMPLE_ARS_PER_USD), "ARS", undefined, { whole: true }) },
    { name: t("asset.WBRL.name"), amount: formatMoney((PAID_USD * EXAMPLE_BRL_PER_USD).toFixed(2), "BRL") },
  ];
  return (
    <section id="clients" className="scroll-mt-20 border-y bg-card py-16 md:py-24">
      <div className={`${container} grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14`}>
        <div>
          <h2 data-reveal className={sectionTitle}>{t("landing.clients.title")}</h2>
          <p data-reveal data-reveal-delay={70} className={`mt-4 ${sectionIntro}`}>{t("landing.clients.intro")}</p>
          <ul className="mt-7 grid gap-4">
            {POINTS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} data-reveal data-reveal-delay={(i + 2) * 70} className="grid grid-cols-[24px_1fr] gap-3">
                <Icon aria-hidden="true" className="mt-0.5 size-5 text-primary" />
                <div>
                  <p className="font-semibold">{t(title)}</p>
                  <p className="text-[0.95rem] text-muted-foreground">{t(body)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden="true" data-reveal data-reveal-delay={140} className="w-full max-w-[400px] rounded-2xl bg-card p-5 ring-1 ring-foreground/10 lg:ml-auto">
          <p className="text-sm text-muted-foreground">{t("landing.clients.preview.from")}</p>
          <p className="mt-1 text-[2.1rem] leading-tight font-bold tracking-tight tabular-nums">{formatMoney(String(PAID_USD), "USD")}</p>
          <p className="text-sm text-muted-foreground">{t("landing.clients.preview.for")}</p>
          <ol className="mt-5 mb-3.5 grid grid-cols-4 gap-1.5 text-[0.7rem] text-muted-foreground">
            {(["pay.step.choose", "pay.step.connect", "pay.step.confirm", "pay.step.paid"] as const).map((key, i) => (
              <li key={key} className={`border-t-4 pt-1.5 ${i === 0 ? "border-primary" : "border-border"}`}>
                {t(key)}
              </li>
            ))}
          </ol>
          <ul className="grid gap-2">
            {options.map((option) => (
              <li
                key={option.name}
                className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 ${option.on ? "border-primary bg-tint/30 ring-1 ring-primary" : "border-input"}`}
              >
                <span className={`size-4 shrink-0 rounded-full ${option.on ? "border-[5px] border-primary" : "border-[1.5px] border-input"}`} />
                <span className="min-w-0 flex-1">
                  {option.name}
                  {option.note && <span className="block text-xs text-muted-foreground">{option.note}</span>}
                </span>
                <span className="font-semibold tabular-nums">{option.amount}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-sm text-muted-foreground">{t("landing.clients.preview.fee")}</p>
        </div>
      </div>
    </section>
  );
}
