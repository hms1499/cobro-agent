import type { Metadata } from "next";
import { LogoMark } from "@/components/logo-mark";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { t } from "@/i18n";
import { readPublicEnv } from "@/lib/config/public";
import { AgentAdmin } from "./agent-admin";

export const metadata: Metadata = {
  title: `${t("admin.title")} · ${t("app.name")}`,
  robots: { index: false, follow: false },
};

export default function AgentAdminPage() {
  const env = readPublicEnv();
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-6 px-4 py-12 md:px-8">
      <p className="flex min-h-11 items-center gap-2 font-semibold text-primary">
        <LogoMark className="size-7" />
        {t("app.name")}
      </p>
      <WalletProviders>
        <AgentAdmin
          appUrl={env.NEXT_PUBLIC_APP_URL}
          attributionCode={env.NEXT_PUBLIC_ATTRIBUTION_CODE}
          agentWallet={env.NEXT_PUBLIC_AGENT_WALLET}
          agentId={env.NEXT_PUBLIC_AGENT_ID}
        />
      </WalletProviders>
    </main>
  );
}
