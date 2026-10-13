import { parseServerEnv } from "@/lib/config/server";
import { isAuthorizedCron } from "@/lib/cron/auth";
import { getDb } from "@/lib/db/client";
import { issueDueRecurring } from "@/lib/invoices/repo";
import { runTreasuries, runTreasuryForUser, summarizeRuns } from "@/lib/treasury/executor";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { listTreasuryUsers } from "@/lib/treasury/repo";

/** One RFQ can block up to 75 s and receipts take seconds; stay inside Vercel's 300 s. */
export const maxDuration = 300;
/** No new wallet is started after this, so the last one can finish within maxDuration. */
const START_BUDGET_MS = 180_000;

/** Called every 10 minutes by .github/workflows/treasury-cron.yml (spec §7.1, §10.4). */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), parseServerEnv().CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const db = getDb();
  const issued = await issueDueRecurring(db, new Date());
  if (!parseServerEnv().TREASURY_ENABLED) return Response.json({ issued, treasury: "disabled" });

  const deps = liveExecutorDeps();
  const results = await runTreasuries(await listTreasuryUsers(db), (userId) => runTreasuryForUser(deps, userId), {
    deadline: started + START_BUDGET_MS,
  });
  return Response.json({ issued, treasury: summarizeRuns(results) });
}
