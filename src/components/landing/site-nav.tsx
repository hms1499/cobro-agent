import Image from "next/image";
import Link from "next/link";
import { t } from "@/i18n";
import { container, ghostLink, primaryAction } from "./styles";

const ANCHORS = [
  { href: "#how", label: "landing.nav.how" },
  { href: "#clients", label: "landing.nav.clients" },
  { href: "#faq", label: "landing.nav.faq" },
] as const;

/** Sticky top bar: the mark, three section anchors (hidden on small screens), Sign in and Start free. */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md">
      <div className={`${container} flex h-17 items-center justify-between gap-4`}>
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-lg text-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <Image src="/cobro-mark.svg" alt="" width={30} height={30} priority />
          {t("app.name")}
        </Link>
        <nav aria-label={t("landing.nav.label")} className="flex items-center gap-1">
          {ANCHORS.map(({ href, label }) => (
            <a key={href} href={href} className={`${ghostLink} hidden min-[900px]:inline-flex`}>
              {t(label)}
            </a>
          ))}
          <Link href="/signin" className={ghostLink}>
            {t("landing.nav.signIn")}
          </Link>
          <Link href="/signin" className={`${primaryAction} hidden sm:inline-flex`}>
            {t("landing.start")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
