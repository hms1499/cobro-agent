import { ExternalLink } from "lucide-react";
import { t } from "@/i18n";
import { IDENTITY_REGISTRY } from "@/lib/identity/registry";
import { container, sectionIntro, sectionTitle } from "./styles";

// Smoke D, the first unattended swap (docs/superpowers/smoke/2026-10-treasury.md).
const FIRST_SWAP_TX = "0xf3a8852e9ca48432b59c981c10f1fb7321d1d595ff81e6d5c79f5c965521b00c";
const ATTRIBUTION_TAG = "celo_bc3965e128ba";
const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-4)}`;

/** "Don't take our word for it" (landing spec §3.7): real, checkable on-chain facts. */
export function OnchainProof({ agentId }: { agentId: number | undefined }) {
  const rows = [
    ...(agentId !== undefined
      ? [{ title: t("landing.proof.identity.title"), body: t("landing.proof.identity.body", { agentId }), id: `eip155:42220:${short(IDENTITY_REGISTRY)}`, href: "/agent-card.json" }]
      : []),
    { title: t("landing.proof.swap.title"), body: t("landing.proof.swap.body"), id: short(FIRST_SWAP_TX), href: `https://celoscan.io/tx/${FIRST_SWAP_TX}` },
    { title: t("landing.proof.tag.title"), body: t("landing.proof.tag.body"), id: ATTRIBUTION_TAG, href: undefined },
  ];
  return (
    <section className="pb-16 md:pb-24">
      <div className={container}>
        <h2 className={sectionTitle}>{t("landing.proof.title")}</h2>
        <p className={`mt-4 ${sectionIntro}`}>{t("landing.proof.intro")}</p>
        <ul className="mt-9 divide-y rounded-2xl bg-card ring-1 ring-foreground/8">
          {rows.map((row) => {
            const body = (
              <>
                <span className="min-w-0">
                  <span className="block font-semibold">{row.title}</span>
                  <span className="block text-sm text-muted-foreground">{row.body}</span>
                </span>
                <span className="col-start-1 row-start-2 truncate font-mono text-[0.8rem] text-primary sm:col-start-auto sm:row-start-auto">{row.id}</span>
                {row.href ? (
                  <ExternalLink aria-hidden="true" className="col-start-2 row-span-2 row-start-1 size-4 self-center text-muted-foreground sm:col-start-auto sm:row-span-1 sm:row-start-auto" />
                ) : (
                  <span />
                )}
              </>
            );
            const layout = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:px-6 sm:py-5";
            return (
              <li key={row.title}>
                {row.href ? (
                  <a
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    className={`${layout} transition-colors duration-[20ms] ease-in first:rounded-t-2xl last:rounded-b-2xl hover:bg-primary/4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
                  >
                    {body}
                    <span className="sr-only">({t("landing.proof.opens")})</span>
                  </a>
                ) : (
                  <div className={layout}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
