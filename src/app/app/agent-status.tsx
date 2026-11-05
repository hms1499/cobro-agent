import { CheckCircle, Flask, Hand, Pause } from "@phosphor-icons/react/ssr";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { CHECK_INTERVAL_MINUTES } from "@/lib/cron/schedule";
import { parseServerEnv } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatMoney } from "@/lib/money/format";
import { describeEvent } from "@/lib/treasury/explain";
import { listEvents } from "@/lib/treasury/repo";
import { getOpenProposal, getRulesRow } from "@/lib/treasury/request-reads";
import { agentState, type AgentState } from "@/lib/treasury/view";
import type { RulesRow } from "@/lib/db/schema";
import type { AppUser } from "@/lib/users/queries";
import { wouldDoText } from "@/lib/treasury/would-do";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentToggle } from "./agent-toggle";
import { AutoConvertControl, ConfirmEnabled, ConfirmWaiting } from "./auto-convert-control";
import { loadDecisionText } from "./rules/preview-text";

const CHIPS: Record<AgentState, { icon: typeof Pause; className: string }> = {
  active: { icon: CheckCircle, className: "text-success" },
  dry_run: { icon: Flask, className: "text-muted-foreground" },
  awaiting: { icon: Hand, className: "text-warning" },
  paused: { icon: Pause, className: "text-muted-foreground" },
  auto_off: { icon: Pause, className: "text-warning" },
  off: { icon: Pause, className: "text-muted-foreground" },
};

/** The Agent tab's first card (spec §4.3): the agent's state, what it may do, its last action, and a pause control. */
export async function AgentStatus({ user }: { user: AppUser }) {
  const db = getDb();
  const env = parseServerEnv();
  const row = await getRulesRow(user.id);
  if (!row) return null;
  const [[last], rates, proposal] = await Promise.all([listEvents(db, user.id, 1), getReferenceRatesOrNull(), getOpenProposal(user.id)]);
  const state = agentState({
    globalEnabled: env.TREASURY_ENABLED,
    dryRun: env.TREASURY_DRY_RUN,
    userEnabled: row.enabled,
    awaitingApproval: proposal !== null,
    autoPaused: row.autoPausedAt !== null,
  });
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
        <p className="text-muted-foreground">{t(`agent.help.${state}` as const, { minutes: CHECK_INTERVAL_MINUTES })}</p>
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
        {state !== "off" && (
          <div className="flex flex-wrap items-center gap-3">
            {state === "auto_off" && <AutoConvertControl preview={<DecisionPreview user={user} row={row} />} />}
            <AgentToggle
              enabled={row.enabled}
              // Resume returns to the earlier state (spec §3.2): only a resume into Running asks first.
              resumePreview={!row.enabled && row.autoPausedAt === null ? <DecisionPreview user={user} row={row} /> : undefined}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "Your agent would …" on live balances. Streams on its own so the panel doesn't wait for the balance read; a failure reads as unavailable. */
function DecisionPreview({ user, row }: { user: AppUser; row: RulesRow }) {
  return (
    <Suspense
      fallback={
        <>
          <Skeleton className="h-5 w-full" />
          <ConfirmWaiting />
        </>
      }
    >
      <DecisionSentence user={user} row={row} />
    </Suspense>
  );
}

async function DecisionSentence({ user, row }: { user: AppUser; row: RulesRow }) {
  // Unavailable copy still enables Confirm: a failed balance read must not strand auto-convert off.
  return (
    <>
      <p role="status" className="w-full text-sm">
        {wouldDoText(await loadDecisionText(user, row))}
      </p>
      <ConfirmEnabled />
    </>
  );
}
