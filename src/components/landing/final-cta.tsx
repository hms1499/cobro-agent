import Link from "next/link";
import { t } from "@/i18n";
import { container } from "./styles";

/** The closing call to action (landing spec §3.9). */
export function FinalCta() {
  return (
    <section className="pb-16 md:pb-24">
      <div className={container}>
        <div className="grid grid-cols-1 items-end gap-8 rounded-3xl bg-primary px-6 py-10 text-primary-foreground md:grid-cols-[minmax(0,1fr)_auto] md:px-14 md:py-16">
          <div>
            <h2 className="max-w-[20ch] text-[2rem] leading-[1.08] font-bold tracking-[-0.03em] md:text-[2.75rem]">{t("landing.final.title")}</h2>
            <p className="mt-2.5 text-lg text-primary-foreground/80">{t("landing.final.body")}</p>
          </div>
          <Link
            href="/signin"
            className="inline-flex min-h-11 w-fit items-center rounded-lg bg-highlight px-5 font-semibold text-foreground transition-[filter] duration-100 ease-in-out hover:brightness-95 active:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
          >
            {t("landing.start")}
          </Link>
        </div>
      </div>
    </section>
  );
}
