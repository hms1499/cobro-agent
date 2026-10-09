"use client";

import { House, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type MessageKey } from "@/i18n";

// Plan 3 adds "Agent" (rules) between these, as MASTER.md lists: Home, Invoices, Agent, Settings.
const ITEMS: { href: string; label: MessageKey; icon: typeof House }[] = [
  { href: "/app", label: "nav.home", icon: House },
  { href: "/app/settings", label: "nav.settings", icon: Settings },
];

export function AppNav() {
  return <AppNavLinks pathname={usePathname()} />;
}

export function AppNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label={t("nav.label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card lg:static lg:w-60 lg:shrink-0 lg:border-r lg:border-t-0"
    >
      <p className="hidden px-6 py-6 text-lg font-semibold text-primary lg:block">{t("app.name")}</p>
      <ul className="flex lg:flex-col">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname !== null && (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
          return (
            <li key={href} className="flex-1 lg:flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-6 lg:text-sm ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon aria-hidden="true" className="size-5" />
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
