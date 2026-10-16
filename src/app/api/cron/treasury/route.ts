import { after } from "next/server";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { parseServerEnv } from "@/lib/config/server";
import { handleCronRequest, runCronTick } from "@/lib/cron/tick";
import { getDb } from "@/lib/db/client";
import { issueDueRecurring } from "@/lib/invoices/repo";
import { logTransferFinder, reconcileSettlements } from "@/lib/payments/reconcile";
import { reconcileWallets, runTreasuryForUser } from "@/lib/treasury/executor";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { listTreasuryUsers } from "@/lib/treasury/repo";

/** One RFQ can block up to 75 s and receipts take seconds; stay inside Vercel's 300 s (after() shares it). */
export const maxDuration = 300;
/** No new wallet is started after this, so the last ones can finish within maxDuration. */
const START_BUDGET_MS = 180_000;

/**
 * Called by cron-job.org with `?mode=async` (answers 202, runs in after()) and by
 * .github/workflows/treasury-cron.yml without it (runs inline, body says `ok`). Spec §7.1, §10.4.
 */
export async function POST(request: Request) {
  const env = parseServerEnv();
  const started = Date.now();
  return handleCronRequest(request, {
    secret: env.CRON_SECRET,
    schedule: (task) => after(task),
    tick: () => {
      const db = getDb();
      const deps = liveExecutorDeps();
      return runCronTick({
        issueDue: () => issueDueRecurring(db, new Date()),
        reconcileSettlements: () => reconcileSettlements(db, logTransferFinder(createCeloPublicClient(env.CELO_RPC_URL)), new Date()),
        reconcileWallets: () => reconcileWallets(deps),
        treasuryEnabled: env.TREASURY_ENABLED,
        listUsers: () => listTreasuryUsers(db),
        runUser: (userId) => runTreasuryForUser(deps, userId),
        deadline: started + START_BUDGET_MS,
      });
    },
  });
}
