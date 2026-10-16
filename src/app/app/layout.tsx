import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { openProposal } from "@/lib/treasury/repo";
import { AppNav, AppNavLinks } from "./app-nav";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* usePathname can suspend and the proposal read needs the session; the fallback is the nav without marks */}
      <Suspense fallback={<AppNavLinks pathname={null} />}>
        <NavWithProposal />
      </Suspense>
      {/* pb-20 keeps content clear of the fixed mobile bar */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-0">{children}</div>
    </div>
  );
}

/** Trade approvals §6: a dot on the Agent tab while a proposal waits. Signed-out and onboarding visitors get none. */
async function NavWithProposal() {
  let hasProposal = false;
  try {
    const user = await getCurrentUser();
    hasProposal = user ? (await openProposal(getDb(), user.id)) !== null : false;
  } catch (error) {
    // Prerender and redirect signals must reach Next.js. The mark is a hint; the nav must work when the lookup fails.
    unstable_rethrow(error);
    console.error("Nav proposal lookup failed:", error instanceof Error ? error.message : error);
  }
  return <AppNav hasProposal={hasProposal} />;
}
