import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { retireParaBetaData, usersCreatedBefore } from "./lib/retire-para-beta";

/** `a…@domain`: first character, an ellipsis, then the domain. */
function maskEmail(email: string | null): string {
  if (!email) return "(no email)";
  const at = email.lastIndexOf("@");
  if (at < 1) return "(invalid email)";
  return `${email[0]}…${email.slice(at)}`;
}

function parseArgs(argv: string[]): { createdBefore: Date; apply: boolean } {
  const raw = argv.find((a) => a.startsWith("--created-before="))?.slice("--created-before=".length);
  if (!raw) throw new Error("Missing --created-before=<ISO 8601 timestamp>");
  const createdBefore = new Date(raw);
  if (Number.isNaN(createdBefore.getTime())) throw new Error(`Invalid --created-before value: ${raw}`);
  return { createdBefore, apply: argv.includes("--apply") };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: requireValue(parseServerEnv().DATABASE_URL, "DATABASE_URL") });
  try {
    const db = drizzle({ client: pool, schema }) as unknown as Db;
    const inScope = await usersCreatedBefore(db, opts.createdBefore);
    console.log(`${opts.apply ? "APPLY" : "DRY RUN"}: ${inScope.length} user(s) created before ${opts.createdBefore.toISOString()}`);
    for (const user of inScope) console.log(`  ${maskEmail(user.email)}`);
    const summary = await retireParaBetaData(db, opts);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.blockers.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
