import { Pool } from "@neondatabase/serverless";
import { parseServerEnv, requireValue } from "@/lib/config/server";

/**
 * After migration 0008: every stored invoice number must equal the number the old read-time count gave
 * (position among the owner's invoices by created_at, then id). Prints two counts and nothing else.
 * Only meaningful right after migrating: new invoices are numbered in lock order, so two created at the
 * same moment may legitimately differ from created_at order and count as mismatches.
 * Run: npx tsx --env-file=.env.local scripts/check-invoice-numbers.mts
 */
const pool = new Pool({ connectionString: requireValue(parseServerEnv().DATABASE_URL, "DATABASE_URL") });
try {
  const { rows } = await pool.query<{ total: number; mismatches: number }>(`
    select count(*)::int as total,
           count(*) filter (where number is distinct from (
             select count(*) from invoices i2
             where i2.user_id = invoices.user_id and (i2.created_at, i2.id) <= (invoices.created_at, invoices.id)
           ))::int as mismatches
    from invoices`);
  console.log(`invoices=${rows[0].total} mismatches=${rows[0].mismatches}`);
  if (rows[0].mismatches > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
