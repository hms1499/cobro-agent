import { Plus } from "lucide-react";
import { t } from "@/i18n";
import { container, sectionTitle } from "./styles";

const ITEMS = ["bank", "cost", "currencies", "badTrade", "cashOut"] as const;

/** Questions (landing spec §3.8): native <details>, the first one open. */
export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 pb-16 md:pb-24">
      <div className={`${container} grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14`}>
        <h2 className={sectionTitle}>{t("landing.faq.title")}</h2>
        <div className="border-t">
          {ITEMS.map((item, i) => (
            <details key={item} open={i === 0} className="group border-b">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-2 py-5 text-lg font-semibold transition-colors duration-[20ms] ease-in hover:bg-primary/4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                {t(`landing.faq.${item}.q`)}
                <Plus aria-hidden="true" className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-open:rotate-45" />
              </summary>
              <p className="mx-2 mb-5 max-w-[70ch] text-muted-foreground">{t(`landing.faq.${item}.a`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
