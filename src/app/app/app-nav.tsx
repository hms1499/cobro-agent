"use client";

import { GearSix, House, Receipt, Robot } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { InitialAvatar } from "@/components/initial-avatar";
import { LogoMark } from "@/components/logo-mark";
import { t, type MessageKey } from "@/i18n";
import { CommandPalette } from "./command-palette";

const ITEMS: { href: string; label: MessageKey; icon: typeof House }[] = [
  { href: "/app", label: "nav.home", icon: House },
  { href: "/app/invoices", label: "nav.invoices", icon: Receipt },
  { href: "/app/rules", label: "nav.agent", icon: Robot },
  { href: "/app/settings", label: "nav.settings", icon: GearSix },
];

/** Tags nav clicks so the layout's ViewTransition crossfades the page area (app/app/layout.tsx). */
const NAV_TRANSITION = ["app-nav"];

/** Who is signed in, for the sidebar's account block. */
export type NavAccount = { name: string; email: string | null };

export function AppNav({ hasProposal, account }: { hasProposal: boolean; account: NavAccount | null }) {
  return <AppNavLinks pathname={usePathname()} hasProposal={hasProposal} account={account} />;
}

export function AppNavLinks({
  pathname,
  hasProposal = false,
  account = null,
}: {
  pathname: string | null;
  hasProposal?: boolean;
  account?: NavAccount | null;
}) {
  return (
    <nav
      aria-label={t("nav.label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-t-0"
    >
      <Link
        href="/app"
        className="hidden min-h-11 items-center gap-2.5 px-6 pb-6 pt-7 text-lg font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:flex"
      >
        <LogoMark />
        {t("app.name")}
      </Link>
      <CommandPalette />
      <ul className="flex lg:flex-col lg:gap-0.5 lg:px-3">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname !== null && (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
          return (
            <li key={href} className="flex-1 lg:flex-none">
              <Link
                href={href}
                transitionTypes={NAV_TRANSITION}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-md lg:px-3 lg:text-sm ${
                  active ? "text-primary lg:bg-tint/35" : "hover-tint text-muted-foreground"
                }`}
              >
                <span className="relative">
                  <Icon aria-hidden="true" weight={active ? "fill" : "regular"} className="size-5" />
                  {hasProposal && href === "/app/rules" && (
                    <span aria-hidden="true" className="absolute -right-1 -top-1 size-2.5 rounded-full bg-destructive" />
                  )}
                </span>
                {t(label)}
                {hasProposal && href === "/app/rules" && <span className="sr-only">{t("nav.proposalWaiting")}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      {account && (
        <Link
          href="/app/settings"
          className="hover-tint mx-3 mb-4 mt-auto hidden min-h-11 items-center gap-3 rounded-lg border-t border-border px-3 pb-2 pt-4 focus-visible:outline-2 focus-visible:outline-ring lg:flex"
        >
          <InitialAvatar name={account.name} size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{account.name}</span>
            {account.email && account.email !== account.name && (
              <span className="truncate text-xs text-muted-foreground">{account.email}</span>
            )}
          </span>
        </Link>
      )}
    </nav>
  );
}
