# Database performance (design)

- **Date:** 2026-10-23. The user asked for a senior-backend review of the database for quality and speed,
  skipped the questions, then cut the first draft down to two parts: stored invoice numbers and the cron
  indexes **(user)**. Their process is ask → spec → plan → code **(user)**.
- Marks: **(user)** = decided by the user; **(builder's call)** = chosen by the builder, may change with a
  reason; unmarked = context or fact found in the code.

## 1. Intent

The review found the database code sound: there are indexes on every list, transactions around every
money write, one user and proposal read per request through React `cache`, and reference rates cached in
memory. Two things will get slower as data grows, and this design fixes both:

1. **Invoice numbers are computed on every read.** `invoiceNumber` in `src/lib/invoices/repo.ts` is a
   correlated `count(*)` per row, so a list of n invoices costs about n²/2 row visits. Home and Invoices
   both load up to 500 numbered invoices, and the detail and pay pages compute it too. This is harmless
   today, but it gets slow once a freelancer has a few hundred invoices.
2. **The cron runs three queries that cannot use an index** every 20 minutes, so they read whole tables.

The app must stay exactly as correct as it is: there is no change to money paths, and no invoice number a
freelancer has already sent may change.

## 2. Goals

1. **Store invoice numbers.** Each invoice gets a persisted per-user `number`, assigned once at insert.
   Existing invoices are backfilled with exactly the number they show today.
2. **Index the cron's scans.**

## 3. Non-goals

- Dropped from the first draft by the user: a benchmark script, matching the Vercel and Neon regions, and
  changing the connection driver **(user)**.
- A caching layer, changing the cron frequency, keeping Neon warm, or a paid Neon plan.
- Moving the invoice summary (open / overdue / received) into SQL. It converts mixed currencies with live
  rates and depends on "today", so the JavaScript version stays; once numbers are stored, loading 500 rows
  is cheap.

## 4. Anti-goals (a failure even if it is faster)

- Any visible invoice number changes: on the detail page, the pay page, the invoices list, or a link
  already sent.
- Any change in behaviour of payments, claims, treasury transactions or the agent loop.
- The migration applied to production (Neon **main**) without the user confirming it first.

## 5. Design

### 5.1 Stored invoice numbers

- Add `invoices.number integer not null`, with a unique index on `(user_id, number)`.
- Add a per-user counter, `users.invoice_seq integer not null default 0`. Each insert into `invoices`
  takes the next number with `update users set invoice_seq = invoice_seq + 1 where id = $1 returning
  invoice_seq`, in the same transaction as the insert. The row lock on the user serialises concurrent
  inserts for the same freelancer, so no retry loop is needed **(builder's call; `max(number)+1` with
  retries was rejected because it races)**.
- All three insert sites go through one helper: `createInvoice`, `createRecurring` (its first invoice),
  and `issueDueRecurring` (the cron). `createInvoice` gains a transaction if it has none.
- **Numbers stay gapless**, as they are today. `insertInstance` uses `onConflictDoNothing` on
  `(recurring_id, period_start)`, so a period that already exists inserts nothing. When no row comes back,
  the helper gives the number back (`invoice_seq - 1`, safe because the transaction still holds the user
  row lock) **(builder's call; a savepoint around the insert works too)**. A test covers it: issuing the
  same period twice leaves the next manual invoice with the next consecutive number.
- **Migration**: one drizzle-kit migration, hand-edited for the backfill.
  1. Add `users.invoice_seq` (default 0) and a nullable `invoices.number`.
  2. Backfill with `row_number() over (partition by user_id order by created_at, id)`. This is exactly
     the ordering of today's `count(*)` subquery, so every invoice keeps its current number.
  3. Set each user's `invoice_seq` to their invoice count.
  4. Make `invoices.number` not null and add the unique index.
- Reads select the column. The `invoiceNumber` subquery and its comment are removed, and
  `NumberedInvoice` keeps its shape, so callers (pages, `findPublicInvoice`, `getOwnedInvoice`) do not
  change.
- **Tests (PGlite, `createTestDb()`):**
  - The three existing numbering tests in `repo.test.ts` pass unchanged.
  - The backfill gives the same numbers as the old subquery, including two invoices with the same
    `created_at` (decided by `id`). The test runs the old expression and the migrated column on the same
    seeded data.
  - New invoices continue the sequence after the backfill.
  - Recurring issuance from the cron takes numbers from the same sequence as manual invoices.
  - Two users' sequences are independent.

### 5.2 Indexes for the cron

| Query | Today | Index |
|---|---|---|
| `reconcileSettlements`: invoices with `status = 'settling' and settling_until < now` | scans `invoices` | partial `invoices (settling_until) where status = 'settling'` |
| same function: `lower(payments.tx_hash) in (…)` | the unique index on `tx_hash` cannot serve `lower()`, so it scans `payments` | expression index on `lower(tx_hash)` |
| `usersWithPendingTxs`: `treasury_txs where status = 'pending'` | the `(user_id, status)` index does not lead with `status` | partial `treasury_txs (user_id) where status = 'pending'` |

- The indexes are declared in `schema.ts` and generated by drizzle-kit, in the same migration as 5.1 or
  a second one **(builder's call)**.
- Each index is checked in PGlite with `EXPLAIN`: the plan must use the index, with
  `set enable_seqscan = off` so that a small test table does not hide it.

## 6. Constraints

- Migrations: `npm run db:generate`, then `npm run db:migrate` (Neon **dev**). Production uses Neon
  **main**, where the migration must also be applied. This happens **after the user confirms**: the
  backfill rewrites production rows.
- Run the full gate on the branch and again on the merge:
  `npm test && npm run typecheck && npm run lint && npm run build`.
- Secrets: print names, lengths or host prefixes only. The project hook blocks reading `.env.local`.
- One branch: `plan-5-db-performance`, merged `--no-ff` into `main` when done.

## 7. Left to the builder

- The task order inside the plan.
- Whether the indexes share the numbering migration.
- The name and location of the shared insert helper.
