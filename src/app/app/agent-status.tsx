import { eq } from "drizzle-orm";
import { CircleCheck, FlaskConical, Pause } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { parseServerEnv } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatMoney } from "@/lib/money/format";
import { describeEvent } from "@/lib/treasury/explain";
import { listEvents } from "@/lib/treasury/repo";
import { agentState, type AgentState } from "@/lib/treasury/view";
import type { AppUser } from "@/lib/users/queries";
import { AgentToggle } from "./agent-toggle";

const CHIPS: Record<AgentState, { icon: typeof Pause; className: string }> = {
  active: { icon: CircleCheck, className: "text-success" },
  dry_run: { icon: FlaskConical, className: "text-muted-foreground" },
  paused: { icon: Pause, className: "text-muted-foreground" },
  off: { icon: Pause, className: "text-muted-foreground" },
};

/** Spec §17.1 principles 4 and 5: the agent's state, what it may do, its last action, and a pause control. */
export async function AgentStatus({ user }: { user: AppUser }) {
  const db = getDb();
  const env = parseServerEnv();
  const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
  if (!row) return null;
  const [[last], rates] = await Promise.all([listEvents(db, user.id, 1), getReferenceRatesOrNull()]);
  const state = agentState({ globalEnabled: env.TREASURY_ENABLED, dryRun: env.TREASURY_DRY_RUN, userEnabled: row.enabled });
  const { icon: Icon, className } = CHIPS[state];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("agent.title")}</h2>
          <span
            role="status"
            className={`inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium ${className}`}
          >
            <Icon aria-hidden="true" className="size-4" />
            {t(`agent.state.${state}` as const)}
          </span>
        </div>
        <p className="text-muted-foreground">{t(`agent.help.${state}` as const)}</p>
        <p className="text-sm">
          {t("agent.guardrails", {
            perTrade: formatMoney(String(row.perTradeMaxUsd), "USD"),
            daily: formatMoney(String(row.dailyMaxUsd), "USD"),
          })}
        </p>
        <p className="text-sm">
          {last
            ? t("agent.lastAction", { title: describeEvent(last, { local: user.localCurrency, rates }).title })
            : t("agent.noActivity")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {state !== "off" && <AgentToggle enabled={row.enabled} />}
          <Link href="/app/rules" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">
            {t("agent.settings")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
