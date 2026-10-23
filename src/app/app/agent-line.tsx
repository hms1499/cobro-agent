import { CaretRight } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { t } from "@/i18n";
import { parseServerEnv } from "@/lib/config/server";
import { CHECK_INTERVAL_MINUTES } from "@/lib/cron/schedule";
import { getOpenProposal, getRulesRow } from "@/lib/treasury/request-reads";
import { agentState, type AgentState } from "@/lib/treasury/view";
import type { AppUser } from "@/lib/users/queries";

const DOT: Record<AgentState, string> = {
  active: "bg-success",
  awaiting: "bg-warning",
  dry_run: "bg-muted-foreground",
  paused: "bg-muted-foreground",
  off: "bg-muted-foreground",
};

/** Home's one line about the agent (spec §4.2); limits, pause and history live on the Agent tab. */
export async function AgentLine({ user }: { user: AppUser }) {
  const env = parseServerEnv();
  const [row, proposal] = await Promise.all([getRulesRow(user.id), getOpenProposal(user.id)]);
  if (!row) return null;
  const state = agentState({
    globalEnabled: env.TREASURY_ENABLED,
    dryRun: env.TREASURY_DRY_RUN,
    userEnabled: row.enabled,
    awaitingApproval: proposal !== null,
  });
  return (
    <Link
      href="/app/rules"
      className="flex min-h-11 items-center gap-3 rounded-xl bg-highlight px-4 py-3 text-sm transition-[filter] duration-100 hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[state]}`} />
      <span className="flex-1">
        {t(`home.agentLine.${state}` as const, { minutes: CHECK_INTERVAL_MINUTES })}
      </span>
      <CaretRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
