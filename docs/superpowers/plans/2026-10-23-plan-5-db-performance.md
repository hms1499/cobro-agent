# Plan 5: Database Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each invoice's per-user number instead of recounting it on every read, and add three indexes for the cron's whole-table scans.

**Architecture:** A per-user counter (`users.invoice_seq`) hands out numbers inside the insert transaction; one helper, `insertNumberedInvoice`, is the only way to insert an invoice. Migration 0008 backfills every existing invoice with the number the old `count(*)` subquery gives it today. Migration 0009 adds three cron indexes declared in `schema.ts`.

**Tech Stack:** Drizzle ORM 0.45 + drizzle-kit, Neon Postgres (dev and main branches), PGlite for tests, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-db-performance-design.md`

## Global Constraints

- No existing invoice's number may change; numbers stay gapless per user (spec §4, §5.1).
- No behaviour change in payments, claims, treasury transactions or the agent loop (spec §4).
- Migrations: `npm run db:generate`, then `npm run db:migrate` (Neon **dev**). Neon **main** only after the user confirms (spec §6).
- Secrets: never print `DATABASE_URL` or any env value; the project hook blocks reading `.env.local`.
- Full gate before claiming done: `npm test && npm run typecheck && npm run lint && npm run build`.
- Branch `plan-5-db-performance`; merge `--no-ff` into `main`, gate on the merge, then push. Commit messages end with the `Co-Authored-By` trailer.

## Review Focus

1. **Two invoices with the same `created_at`** (one transaction, or clock ties): the backfill must break the tie by `id` exactly like the old subquery → Task 1, `backfill matches the old numbering, ties broken by id`.
2. **A recurring period that already exists**: the insert is skipped, and the next invoice must still get the next consecutive number → Task 1, `gives the number back when a recurring period already exists`.
3. **Cancelled invoices**: the old count included them, so they keep their numbers and still take part in the sequence → Task 1, `counts cancelled invoices in the sequence`.
4. **A freelancer with no invoices**, before and after the migration: the first invoice is number 1 → Task 1, `starts a user without invoices at 1`.
5. **Two inserts for one freelancer at the same moment** (two tabs, or the cron next to a manual create): the user row lock serialises them, but PGlite has one connection and cannot show it. The unique `(user_id, number)` index is the backstop, so a duplicate errors instead of being saved → Task 1, `rejects a duplicate number for the same user`.

---

### Task 1: Stored invoice numbers (schema, migration 0008, insert helper, reads)

**Files:**
- Create: `src/lib/invoices/numbering.ts`
- Create: `src/lib/invoices/numbering.test.ts`
- Create: `drizzle/0008_stored_invoice_numbers.sql` (generated, then hand-edited) and its `drizzle/meta` snapshot and journal entry
- Modify: `src/lib/db/schema.ts` (columns `users.invoiceSeq` and `invoices.number`, plus the unique index)
- Modify: `src/lib/invoices/repo.ts:25-34` (remove `invoiceNumber`, select the column), `:70-104` (`createInvoice`, `insertInstance` use the helper)
- Modify: `src/lib/db/testing.ts:48-66` (`seedInvoice` uses the helper)
- Modify: `src/lib/treasury/stats.test.ts:64-70` (replace the raw `insert(invoices)` with two `seedInvoice` calls)

**Interfaces:**
- Produces: in `src/lib/invoices/numbering.ts`:
  - `export type NewInvoice = Omit<typeof invoices.$inferInsert, "id" | "number">`
  - `export async function insertNumberedInvoice(tx: Db, values: NewInvoice, opts?: { skipExistingPeriod?: boolean }): Promise<InvoiceRow | undefined>`. It must be called inside a transaction. It takes the next number with `update users set invoice_seq = invoice_seq + 1 where id = values.userId returning invoice_seq`, then inserts. With `skipExistingPeriod`, the insert uses `onConflictDoNothing({ target: [invoices.recurringId, invoices.periodStart] })`; when no row comes back it runs `invoice_seq = invoice_seq - 1` and returns `undefined`. Without the option it always returns a row.
- Produces: `InvoiceRow` now has `number: number`. `NumberedInvoice` stays `InvoiceRow & { number: number }` (now redundant but kept, so callers do not change).

- [ ] **Step 1: Write the failing tests in `src/lib/invoices/numbering.test.ts`**

These use `createTestDb`, `resetDb`, `seedFreelancer` and `createInvoice`, `createRecurring`, `issueDueRecurring`, `listInvoices`, `cancelInvoice` from `repo.ts`.

- `starts a user without invoices at 1`: a new freelancer's first `createInvoice` gives `number === 1`, and `users.invoice_seq === 1`.
- `numbers manual and recurring invoices from one sequence`: `createInvoice` gives 1, then `createRecurring` (weekly) gives its first invoice 2. Advance the clock past `nextIssueAt` and call `issueDueRecurring`; the issued invoice is 3, and the next `createInvoice` is 4.
- `gives the number back when a recurring period already exists`: create a recurring template, then call `insertNumberedInvoice(tx, sameRecurringIdAndPeriodStart, { skipExistingPeriod: true })` inside `db.transaction`. It returns `undefined`, and the next `createInvoice` takes the next consecutive number (no gap).
- `counts cancelled invoices in the sequence`: create 1, cancel it with `cancelInvoice`, create again; the second invoice is 2.
- `keeps sequences independent per user`: two freelancers each get 1, 2.
- `rejects a duplicate number for the same user`: a raw `db.execute(sql\`insert into invoices (slug, user_id, client_name, description, amount, currency, number) values (…, 1)\`)` for a user that already has number 1 rejects (unique `invoices_user_number_uq`).
- `backfill matches the old numbering, ties broken by id` (migration test):
  1. Copy `drizzle/0000…0007*.sql` and `drizzle/meta` into a temp folder (`fs.mkdtempSync(path.join(os.tmpdir(), "cobro-mig-"))`), with `_journal.json` cut to `idx <= 7`.
  2. `migrate(drizzle({ client: new PGlite() }), { migrationsFolder: tmp })`.
  3. Seed through raw SQL (the old schema has no `number`): two users. User A has five invoices with mixed `created_at`; two share the same `created_at`, and one is cancelled. User B has two invoices. Also seed a user C with none.
  4. Record `expected` with the old expression: `select id, (select count(*) from invoices i2 where i2.user_id = invoices.user_id and (i2.created_at, i2.id) <= (invoices.created_at, invoices.id))::int as n from invoices`.
  5. `migrate(sameDb, { migrationsFolder: "drizzle" })`, which applies 0008 only.
  6. Assert every `select id, number from invoices` equals `expected`, `invoice_seq` is A = 5, B = 2, C = 0, and a new `createInvoice` for A gets 6.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/invoices/numbering`
Expected: FAIL, because `./numbering` does not exist and the `number` column is missing.

- [ ] **Step 3: Schema and migration 0008**

In `schema.ts`:
- `users`: `invoiceSeq: integer("invoice_seq").notNull().default(0)`.
- `invoices`: `number: integer("number").notNull()`, plus `uniqueIndex("invoices_user_number_uq").on(t.userId, t.number)` in the table's index list. Add a comment on `number`: per-user, gapless, taken from `users.invoice_seq` at insert by `insertNumberedInvoice`.

Run `npm run db:generate -- --name stored_invoice_numbers`, then replace the generated SQL with exactly this (the generated `ADD COLUMN … NOT NULL` would fail on existing rows):

```sql
ALTER TABLE "users" ADD COLUMN "invoice_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "invoices" SET "number" = ranked.n FROM (SELECT "id", row_number() OVER (PARTITION BY "user_id" ORDER BY "created_at", "id") AS n FROM "invoices") AS ranked WHERE ranked."id" = "invoices"."id";--> statement-breakpoint
UPDATE "users" SET "invoice_seq" = counts.c FROM (SELECT "user_id", count(*)::int AS c FROM "invoices" GROUP BY "user_id") AS counts WHERE counts."user_id" = "users"."id";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_user_number_uq" ON "invoices" USING btree ("user_id","number");
```

Leave the generated snapshot as drizzle-kit wrote it: it already describes the final schema.

- [ ] **Step 4: Implement `insertNumberedInvoice` in `src/lib/invoices/numbering.ts`, then route every insert through it**

- `createInvoice`: wrap in `db.transaction` and call the helper without options.
- `insertInstance`: call the helper with `{ skipExistingPeriod: true }`. Both callers already run inside a transaction.
- Remove `invoiceNumber` and `numberedColumns`. `listInvoices` and `getOwnedInvoice` select plain `invoices`, and `findPublicInvoice` selects `number: invoices.number`.
- `seedInvoice` (testing.ts): same signature, but `overrides` becomes `Partial<NewInvoice>`. Its body is `db.transaction((tx) => insertNumberedInvoice(tx, …))` and it returns the row.
- `stats.test.ts:64-70`: use two `seedInvoice(db, user.id, { slug, recurringId, periodStart, status: "paid", … })` calls.

- [ ] **Step 5: Run the new and the existing invoice tests**

Run: `npx vitest run src/lib/invoices src/lib/treasury/stats src/lib/db`
Expected: PASS. This includes the three unchanged tests in `repo.test.ts` (`numbers a user's invoices in creation order, per user`, `keeps numbers when the list is limited`, `gives the owned and public views the same number`).

- [ ] **Step 6: Full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files pass and `tsc` reports no errors. Any other test that inserted invoices directly is fixed the same way as `stats.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/invoices/numbering.ts src/lib/invoices/numbering.test.ts src/lib/invoices/repo.ts src/lib/db/schema.ts src/lib/db/testing.ts src/lib/treasury/stats.test.ts drizzle/
git commit -m "feat(invoices): store per-user invoice numbers instead of counting on every read"
```

---

### Task 2: Cron indexes (migration 0009)

**Files:**
- Create: `src/lib/db/indexes.test.ts`
- Create: `drizzle/0009_cron_indexes.sql` (generated) and its meta
- Modify: `src/lib/db/schema.ts` (index lists of `invoices`, `payments`, `treasuryTxs`)

**Interfaces:**
- Consumes: the schema from Task 1.
- Produces: indexes `invoices_settling_idx`, `payments_tx_hash_lower_idx` and `treasury_txs_pending_idx`.

- [ ] **Step 1: Write the failing tests in `src/lib/db/indexes.test.ts`**

Use a helper `explain(db, query: SQL): Promise<string>` that runs `set enable_seqscan = off`, then `explain <query>`, and joins the `QUERY PLAN` rows. Each test expects the plan to contain the index name:
- `uses the settling index for stuck claims`: `select id from invoices where status = 'settling' and settling_until < now()` → `invoices_settling_idx`.
- `uses the lower(tx_hash) index for reconciliation`: `select tx_hash from payments where lower(tx_hash) in ('0xabc', '0xdef')` → `payments_tx_hash_lower_idx`.
- `uses the pending index for unsettled wallet transactions`: `select distinct user_id from treasury_txs where status = 'pending' order by user_id` → `treasury_txs_pending_idx`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/db/indexes`
Expected: FAIL (the plans show other indexes or a sequential scan).

- [ ] **Step 3: Declare the indexes in `schema.ts` and generate**

- `invoices`: `index("invoices_settling_idx").on(t.settlingUntil).where(sql\`status = 'settling'\`)`
- `payments`: `index("payments_tx_hash_lower_idx").on(sql\`lower(${t.txHash})\`)`
- `treasuryTxs`: `index("treasury_txs_pending_idx").on(t.userId).where(sql\`status = 'pending'\`)`

Run `npm run db:generate -- --name cron_indexes`. Check that the SQL holds three `CREATE INDEX` statements carrying the `WHERE` clauses and the `lower(...)` expression, and nothing else.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/indexes.test.ts drizzle/
git commit -m "feat(db): index the cron's settling, tx-hash and pending-tx scans"
```

---

### Task 3: Apply, verify numbers unchanged, ship

**Files:**
- Create: `scripts/check-invoice-numbers.mts`

**Interfaces:**
- Consumes: migrations 0008 and 0009.

- [ ] **Step 1: Write `scripts/check-invoice-numbers.mts`**

The script reads `DATABASE_URL` through `parseServerEnv()` and prints only two integers: `invoices=<count> mismatches=<count>`. A mismatch is a row where the stored `number` differs from the old expression `(select count(*) from invoices i2 where i2.user_id = invoices.user_id and (i2.created_at, i2.id) <= (invoices.created_at, invoices.id))`. Use an async IIFE or top-level await in `.mts`, and end the pool.

- [ ] **Step 2: Migrate Neon dev and check**

Run: `npm run db:migrate`, then `npx tsx --env-file=.env.local scripts/check-invoice-numbers.mts`
Expected: `Migrations applied`, then `invoices=<n> mismatches=0`.

- [ ] **Step 3: Full gate on the branch**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: every command passes. On the Next.js security notice, rerun once.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/check-invoice-numbers.mts
git commit -m "chore: script to verify stored invoice numbers match the old numbering"
```

- [ ] **Step 5: Ask the user before touching Neon main**

Say that migration 0008 backfills production rows, and ask how they want it run against **main** (the same way 0007 was applied). Do not read or print the production URL.

Also tell them about the deploy window. Between migrating main and the new deployment going live (about 2–3 minutes of Vercel build), the old production code inserts invoices without `number`, so creating an invoice, or the cron issuing a recurring one, fails with an error. Nothing is lost: the action can be retried, and the cron retries on its next run. To keep the window short, run Step 6's merge and gate first, then migrate main, then push right away.

After they confirm, run the migration against main, then the check script against main. Expected: `mismatches=0`.

- [ ] **Step 6: Merge and push**

```bash
git checkout main && git merge --no-ff plan-5-db-performance
npm test && npm run typecheck && npm run lint && npm run build
git push origin main
```

Order: merge, then gate, then migrate main (Step 5), then push. Production must have migrations 0008 and 0009 **before** this push deploys, because the new code reads `invoices.number`.
