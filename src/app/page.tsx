import type { Metadata } from "next";
import { AgentPanel } from "@/components/landing/agent-panel";
import { ClientPreview } from "@/components/landing/client-preview";
import { Faq } from "@/components/landing/faq";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { OnchainProof } from "@/components/landing/onchain-proof";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { t } from "@/i18n";
import { readPublicEnv } from "@/lib/config/public";

export const metadata: Metadata = { title: t("landing.meta.title"), description: t("landing.meta.description") };

/** The landing page (docs/superpowers/specs/2026-10-20-landing-design.md). Signed-in visitors are sent to /app by the proxy. */
export default function Home() {
  const agentId = readPublicEnv().NEXT_PUBLIC_AGENT_ID;
  return (
    <>
      <SiteNav />
      <main id="main" className="flex-1">
        <Hero agentId={agentId} />
        <HowItWorks />
        <ClientPreview />
        <AgentPanel />
        <OnchainProof agentId={agentId} />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
