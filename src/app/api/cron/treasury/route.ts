import { parseServerEnv } from "@/lib/config/server";
import { isAuthorizedCron } from "@/lib/cron/auth";
import { getDb } from "@/lib/db/client";
import { issueDueRecurring } from "@/lib/invoices/repo";

/** Called every 10 minutes by .github/workflows/treasury-cron.yml (spec §7.1, §10.4). */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), parseServerEnv().CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const issued = await issueDueRecurring(getDb(), new Date());
  // Plan 3: run the treasury engine for every user with rules enabled.
  return Response.json({ issued });
}
