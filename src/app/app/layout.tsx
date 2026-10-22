import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { LogoMark } from "@/components/logo-mark";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOpenProposal } from "@/lib/treasury/request-reads";
import { AppNav, AppNavLinks, type NavAccount } from "./app-nav";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* usePathname can suspend and the proposal read needs the session; the fallback is the nav without marks */}
      <Suspense fallback={<AppNavLinks pathname={null} />}>
        <NavWithProposal />
      </Suspense>
      {/* pb-20 keeps content clear of the fixed mobile bar */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 flex min-h-14 items-center border-b border-border bg-card/90 px-4 backdrop-blur lg:hidden">
          <Link href="/app" className="flex min-h-11 items-center gap-2 font-semibold focus-visible:outline-2 focus-visible:outline-ring">
            <LogoMark className="size-6" />
            {t("app.name")}
          </Link>
        </header>
        {/*
          Spec 4f §4.3: the page area crossfades when the nav switches pages, while the nav stays put (CSS in
          globals.css). Only navigations tagged "app-nav" animate: Suspense reveals and form actions inside the
          page must not, or every streamed section would flicker and block clicks for the fade's duration.
        */}
        <ViewTransition default="none" update={{ "app-nav": "app-page", default: "none" }}>
          {children}
        </ViewTransition>
      </div>
    </div>
  );
}

/** Trade approvals §6: a dot on the Agent tab while a proposal waits. Signed-out and onboarding visitors get none. */
async function NavWithProposal() {
  let hasProposal = false;
  let account: NavAccount | null = null;
  try {
    const user = await getCurrentUser();
    if (user) account = { name: user.displayName ?? user.email ?? t("app.name"), email: user.email };
    hasProposal = user ? (await getOpenProposal(user.id)) !== null : false;
  } catch (error) {
    // Prerender and redirect signals must reach Next.js. The mark is a hint; the nav must work when the lookup fails.
    unstable_rethrow(error);
    console.error("Nav proposal lookup failed:", error instanceof Error ? error.message : error);
  }
  return <AppNav hasProposal={hasProposal} account={account} />;
}
