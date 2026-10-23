import { sql, type SQL } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client";
import { createTestDb } from "./testing";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

/** The planner's plan for `query`, with sequential scans priced out so a small table cannot hide an index. */
async function explain(query: SQL): Promise<string> {
  await db.execute(sql`set enable_seqscan = off`);
  const result = await db.execute<{ "QUERY PLAN": string }>(sql`explain ${query}`);
  return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

describe("cron indexes", () => {
  it("uses the settling index for stuck claims", async () => {
    expect(await explain(sql`select id from invoices where status = 'settling' and settling_until < now()`)).toContain(
      "invoices_settling_idx",
    );
  });

  it("uses the lower(tx_hash) index for reconciliation", async () => {
    expect(await explain(sql`select tx_hash from payments where lower(tx_hash) in ('0xabc', '0xdef')`)).toContain(
      "payments_tx_hash_lower_idx",
    );
  });

  it("uses the pending index for unsettled wallet transactions", async () => {
    expect(await explain(sql`select distinct user_id from treasury_txs where status = 'pending' order by user_id`)).toContain(
      "treasury_txs_pending_idx",
    );
  });
});
