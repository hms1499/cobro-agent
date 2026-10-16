import type { ReconcileResult } from "@/lib/payments/reconcile";
import { runTreasuries, summarizeRuns, type RunOutcome, type RunResult } from "@/lib/treasury/executor";
import { isAuthorizedCron } from "./auth";

/** Below Textile's 4 outstanding RFQs per taker; each run holds at most one. */
export const TREASURY_CONCURRENCY = 3;

export interface PendingResult {
  settled: number;
  stillPending: number;
  errors: number;
}

export interface TickResult {
  issued: number;
  reconciled: ReconcileResult | "error";
  pending: PendingResult | "error";
  treasury: Partial<Record<RunOutcome, number>> | "disabled";
}

export interface TickDeps {
  issueDue(): Promise<number>;
  reconcileSettlements(): Promise<ReconcileResult>;
  reconcileWallets(): Promise<PendingResult>;
  treasuryEnabled: boolean;
  listUsers(): Promise<string[]>;
  runUser(userId: string): Promise<RunResult>;
  /** No new wallet starts after this (epoch ms). */
  deadline: number;
  now?: () => number;
  random?: () => number;
}

/** Fisher–Yates on a copy, so no wallet is always last when the start budget runs out. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One cron tick (spec §7.1, §10.4): recurring invoices, settlement and wallet reconciliation, then the agents. */
export async function runCronTick(deps: TickDeps): Promise<TickResult> {
  const issued = await deps.issueDue();
  let reconciled: TickResult["reconciled"];
  try {
    reconciled = await deps.reconcileSettlements();
  } catch (error) {
    console.error("Settlement reconciliation failed:", error);
    reconciled = "error";
  }
  // Transactions already sent are settled whatever the switches say; this signs and trades nothing.
  let pending: TickResult["pending"];
  try {
    pending = await deps.reconcileWallets();
  } catch (error) {
    console.error("Treasury reconciliation failed:", error);
    pending = "error";
  }
  if (!deps.treasuryEnabled) return { issued, reconciled, pending, treasury: "disabled" };
  const results = await runTreasuries(shuffled(await deps.listUsers(), deps.random), (userId) => deps.runUser(userId), {
    deadline: deps.deadline,
    now: deps.now,
    concurrency: TREASURY_CONCURRENCY,
  });
  return { issued, reconciled, pending, treasury: summarizeRuns(results) };
}

/** What makes the GitHub workflow fail (and email the owner). `locked` is normal when two triggers overlap. */
export function tickHasErrors(result: TickResult): boolean {
  if (result.reconciled === "error" || result.reconciled.errors > 0) return true;
  if (result.pending === "error" || result.pending.errors > 0) return true;
  return result.treasury !== "disabled" && (result.treasury.failed ?? 0) > 0;
}

/**
 * `?mode=async` answers 202 at once and runs the tick in `schedule` (after() in the route), for
 * cron-job.org's 30 s request limit. Without it the tick runs inline and the body says `ok`, for the
 * GitHub workflow. The secret is checked before anything runs or is scheduled.
 */
export async function handleCronRequest(
  request: Request,
  opts: { secret: string | undefined; tick: () => Promise<TickResult>; schedule: (task: () => Promise<void>) => void },
): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), opts.secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (new URL(request.url).searchParams.get("mode") === "async") {
    opts.schedule(async () => {
      try {
        const result = await opts.tick();
        if (tickHasErrors(result)) console.error("CRON TICK HAD ERRORS", JSON.stringify(result));
        else console.log("Cron tick:", JSON.stringify(result));
      } catch (error) {
        console.error("CRON TICK FAILED", error);
      }
    });
    return Response.json({ accepted: true }, { status: 202 });
  }
  const result = await opts.tick();
  return Response.json({ ok: !tickHasErrors(result), ...result });
}
