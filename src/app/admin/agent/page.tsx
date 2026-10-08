import type { Metadata } from "next";
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
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center px-4 py-12 md:px-8">
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
