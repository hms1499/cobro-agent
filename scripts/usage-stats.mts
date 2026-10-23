import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { computeUsage, loadUsageRows, renderUsageMarkdown, replaceUsageBlock, type Exclusions } from "./lib/usage-stats";
import { fetchWalletHistory, type WalletHistory } from "./lib/wallet-history";

/**
 * Usage numbers for the hackathon submission, from the database the env file points at and Celo Blockscout.
 * Prints a markdown block (no emails, no bare addresses); --write-readme puts it between README.md's usage markers.
 * Run: npx tsx --env-file=<env file> scripts/usage-stats.mts --exclude=.superpowers/team-exclusions.json [--write-readme]
 */
const WINDOW_START = new Date("2026-10-06T12:00:00Z");
const USAGE = "usage: npx tsx --env-file=<env file> scripts/usage-stats.mts --exclude=<team-exclusions.json> [--write-readme]";

function readExclusions(path: string | undefined): Exclusions {
  if (!path) throw new Error(USAGE);
  const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as Partial<Exclusions>;
  if (!Array.isArray(parsed.emails) || !Array.isArray(parsed.wallets)) {
    throw new Error(`${path} must be {"emails": [...], "wallets": [...]}`);
  }
  return { emails: parsed.emails, wallets: parsed.wallets };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const args = process.argv.slice(2);
let exclusions: Exclusions;
try {
  exclusions = readExclusions(args.find((a) => a.startsWith("--exclude="))?.slice("--exclude=".length));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const rates = await getReferenceRatesOrNull();
if (!rates) {
  console.error("reference rates unavailable");
  process.exit(1);
}

const pool = new Pool({ connectionString: requireValue(parseServerEnv().DATABASE_URL, "DATABASE_URL") });
try {
  const rows = await loadUsageRows(drizzle({ client: pool, schema }) as unknown as Db);
  const histories = new Map<string, WalletHistory | "error">();
  for (const payer of new Set(rows.payments.map((p) => p.payer.toLowerCase()))) {
    try {
      histories.set(payer, await fetchWalletHistory(payer, fetch));
    } catch {
      histories.set(payer, "error");
    }
    await pause(250);
  }
  const report = computeUsage(rows, exclusions, histories, rates, WINDOW_START);
  const markdown = renderUsageMarkdown(report, new Date());
  console.log(markdown);
  const teamRows = (kind: string) => report.activity.filter((a) => a.role === "team" && a.kind === kind).length;
  const teamEmails = new Set(exclusions.emails.map((e) => e.toLowerCase()));
  const excludedUsers = rows.users.filter((u) => u.email && teamEmails.has(u.email.toLowerCase())).length;
  console.log(`\nexcluded: ${excludedUsers} users, ${teamRows("payment")} payments, ${teamRows("swap")} swaps, ${teamRows("withdrawal")} withdrawals`);
  if (args.includes("--write-readme")) {
    fs.writeFileSync("README.md", replaceUsageBlock(fs.readFileSync("README.md", "utf8"), markdown));
    console.log("README.md usage block updated");
  }
} finally {
  await pool.end();
}
