# Database performance (design)

- **Date:** 2026-10-23. The user asked for a senior-backend review of the database for quality and speed,
  then chose to skip the questions and go straight to a spec **(user)**. Their process is
  ask → spec → plan → code **(user)**.
- Marks: **(user)** = decided by the user; **(builder's call)** = chosen by the builder, may change with a
  reason; unmarked = context or fact found in the code.

## 1. Intent

Cobro feels slow mainly on the first screen after a pause. The review found that the database code is
sound (indexes on every list, transactions around every money write, one user and proposal read per
request through React `cache`, reference rates cached in memory). The time goes to three places:

1. **Infrastructure latency.** Neon Free suspends the compute after 5 idle minutes and the cron runs every
   20 minutes, so most visits wake a cold database. Each new Vercel instance also opens a WebSocket
   (`@neondatabase/serverless` `Pool`) before its first query. No Vercel region is configured, so
   functions run in the default region, which may be far from the Neon region (not yet checked).
2. **Invoice numbers computed on every read.** `invoiceNumber` in `src/lib/invoices/repo.ts` is a
   correlated `count(*)` per row, so a list of n invoices costs about n²/2 row visits. Home and Invoices
   both load up to 500 numbered invoices. Harmless today, slow once a freelancer has a few hundred.
3. **A few queries that cannot use an index**, run by the cron every 20 minutes.

The goal is a faster app that stays exactly as correct as it is: no change to money paths, and no
invoice number a freelancer has already sent may change.

## 2. Goals

1. **Measure first.** A repeatable benchmark gives before/after numbers, so every change is justified by
   a measurement and not a guess.
2. **Store invoice numbers.** Each invoice gets a persisted per-user `number`, assigned once at insert,
   and existing invoices are backfilled with exactly the number they show today.
3. **Index the cron's scans** that today read whole tables.
4. **Match regions** so that Vercel functions and Neon run in the same region.
5. **Evaluate the connection driver** for Vercel Fluid compute, and adopt it only if the benchmark shows
   a clear win.

## 3. Non-goals

- A caching layer (Redis, `use cache` on user data). Per-request `cache()` already removes duplicate
  reads, and caching user money data adds staleness risk for little gain at this scale.
- Changing the cron frequency or keeping Neon warm around the clock. The 20-minute cron was chosen to stay
  inside Neon Free compute hours (see the infra cron notes), and an always-on 0.25 CU compute exceeds them.
- A paid Neon plan, read replicas, or a schema redesign.
- Moving the invoice summary (open / overdue / received) into SQL. It converts mixed currencies with
  live rates and depends on "today", so the JavaScript version stays. Once numbers are stored, loading
  500 rows is cheap.

## 4. Anti-goals (a failure even if it is faster)

- Any visible invoice number changes (on the detail page, the pay page, a PDF or a link already sent).
- Any change in behaviour of payments, claims, treasury transactions or the agent loop.
- A migration applied to production (Neon **main**) without the user confirming it first.
- A driver change that breaks interactive transactions (`db.transaction`, nested savepoints in
  `src/lib/addresses/codes.ts`, the `.for("update")` row lock in `src/lib/treasury/repo.ts`).

## 5. Design

### 5.1 Benchmark (goal 1)

- `scripts/db-bench.mts`, run with `npx tsx --env-file=.env.local scripts/db-bench.mts`. It runs only
  **reads** against the Neon **dev** branch and reports p50 / p95 per call, separately for the first
  call (cold connection) and the following ones (warm). The calls are the ones a Home and an Invoices
  visit make: `loadAppUser`, `getOpenProposal`, `listInvoices(…, 500)`, `listRecentInvoices`,
  `listEvents`, plus a trivial `select 1` as the network floor. The user id comes from a CLI argument;
  the script prints no secrets and no personal data, only timings **(builder's call)**.
- An algorithmic check in PGlite (`createTestDb()`): seed one user with 1,000 invoices and compare
  `EXPLAIN ANALYZE` for the numbered list before and after the change. PGlite proves the n² → n change,
  while the network numbers come from Neon dev **(builder's call)**.
- Results go in the plan's progress file, so the before/after story is recorded.

### 5.2 Stored invoice numbers (goal 2)

- `invoices.number integer not null` with a unique index on `(user_id, number)`.
- A per-user counter `users.invoice_seq integer not null default 0`. Each insert into `invoices` takes the
  next number with `update users set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq`,
  in the same transaction as the insert. The row lock on the user serialises concurrent inserts for the
  same freelancer, so no retry loop is needed **(builder's call; `max(number)+1` with retries was
  rejected because it races)**.
- All three insert sites go through one helper: `createInvoice`, `createRecurring` (its first invoice),
  and `issueDueRecurring` (cron).
- **Migration** (one drizzle-kit migration, hand-edited for the backfill):
  1. Add `users.invoice_seq` (default 0) and a nullable `invoices.number`.
  2. Backfill: `row_number() over (partition by user_id order by created_at, id)`. This is exactly the
     ordering of today's `count(*)` subquery, so every invoice keeps its current number.
  3. Set `users.invoice_seq` to each user's invoice count.
  4. Make `invoices.number` not null and add the unique index.
- Reads select the column. The `invoiceNumber` subquery and its comment are removed, and
  `NumberedInvoice` keeps its shape, so callers do not change.
- Tests: the three existing numbering tests in `repo.test.ts` keep passing unchanged. New tests cover
  the migration backfill matching the old ordering (including two invoices with the same `created_at`),
  numbers continuing after the backfill, and recurring issuance taking numbers from the same sequence.

### 5.3 Indexes for the cron (goal 3)

| Query | Today | Index |
|---|---|---|
| `reconcileSettlements`: invoices `status = 'settling' and settling_until < now` | scans `invoices` | partial `invoices (settling_until) where status = 'settling'` |
| same function: `lower(payments.tx_hash) in (…)` | the unique index on `tx_hash` cannot serve `lower()`, so it scans `payments` | expression index on `lower(tx_hash)` |
| `usersWithPendingTxs`: `treasury_txs where status = 'pending'` | the `(user_id, status)` index does not lead with status | partial `treasury_txs (user_id) where status = 'pending'` |

They go in the same migration as 5.2 or in a second one; the plan decides **(builder's call)**. Each is
checked with `EXPLAIN` in PGlite, where an index scan must replace the sequential scan once the table
has enough rows (or with `enable_seqscan = off`).

### 5.4 Region alignment (goal 4)

- Read the Neon project's region in the Neon console (the user can do this; the builder must not print
  `DATABASE_URL`).
- Pin Vercel functions to the matching region in the project configuration, as the closest Vercel region
  to the Neon one. Prefer `vercel.ts` (`regions`) if the project adopts it; otherwise use the project
  setting. The plan picks whichever the current Vercel CLI supports **(builder's call)**.
- Verify with the benchmark from a deployed preview, or with Vercel function logs, that `select 1` drops.
  If the regions already match, this step records that and changes nothing.

### 5.5 Connection driver (goal 5, gated by measurement)

- Today: `drizzle-orm/neon-serverless` with `@neondatabase/serverless` `Pool` (WebSocket), cached per
  instance in `src/lib/db/client.ts`.
- Candidate: `drizzle-orm/node-postgres` with `pg` `Pool` over TCP to Neon's pooled (`-pooler`) host,
  with the pool attached through `attachDatabasePool` from `@vercel/functions`, so that Fluid compute
  closes idle clients before an instance suspends. The builder confirms this API against the installed
  `@vercel/functions` docs and Neon's current Vercel guide before relying on it.
- Adopt it only if the benchmark on a preview deployment shows the warm p50 for the Home calls improving
  by **30% or more**, and the full gate plus a manual money-path check (create an invoice, pay it on the
  dev branch, cancel one) pass **(builder's call on the threshold)**. Otherwise record the numbers and
  keep the current driver.
- `Db` stays the driver-neutral type, so tests (PGlite) and callers do not change.

## 6. Constraints

- Migrations: `npm run db:generate`, then `npm run db:migrate` (Neon **dev**). Production uses Neon
  **main**, where the migration must also be applied, **after the user confirms** (CLAUDE.md asks before
  destructive DB operations; a backfill rewrites production rows, so it is confirmed too).
- Full gate on the branch and again on the merge: `npm test && npm run typecheck && npm run lint && npm run build`.
- Secrets: print names, lengths or host prefixes only. The project hook blocks reading `.env.local`.
- One branch for the plan: `plan-5-db-performance`, merged `--no-ff` into `main` when done.

## 7. Left to the builder

- Task order inside the plan. Suggested: benchmark → stored numbers → indexes → region → driver, so that
  the cheap, certain wins land before the measured experiment.
- Whether the indexes share the numbering migration.
- The exact output format of the benchmark script.
