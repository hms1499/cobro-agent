# Plan 3: Treasury Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each freelancer's treasury wallet is run by an agent that follows their rules. It keeps a spending reserve in wARS or wBRL, saves the rest in USD₮ through Textile RFQ swaps that it signs and broadcasts itself (tagged, with gas paid in stablecoins), and accepts only prices within the freelancer's limits. The freelancer can withdraw to their own wallet, and the dashboard shows balances, value protected, conversions and an activity feed that explains every decision.

**Architecture:** A pure engine (`treasury/engine.ts`) turns balances, rules and Textile reference rates into one decision. The executor (`treasury/executor.ts`) carries it out under a per-wallet lock:
- It reconciles earlier transactions first.
- It requests a firm Textile quote, checks the price, then approves and swaps.
- It records every RFQ, transaction and event in Postgres.

Treasury transactions are CIP-64 transactions signed through `TreasurySigner` (Para `sign-raw`). Every call goes through one policy guard and carries our attribution tag. The GitHub Actions cron and a payment-triggered `after()` both call the same `runTreasuryForUser`. The pages read live balances inside `<Suspense>`.

**Tech Stack:** Everything from Plans 1–2, with no new dependencies: Next.js 16.4.0, React 19.3, viem 2.57.3 (`viem/celo` serializer), drizzle-orm 0.45.3, zod 4.6.5, @getpara REST via `ParaRestClient`, Vitest 5.0.3 with PGlite.

**Spec:** `docs/superpowers/specs/2026-10-08-cobro-design.md`. This plan covers the week 3 milestone in §14: §6.2 flows 4–5, §7.3, §8.3, §8.6, §10, §11, §12, §17.2 (Dashboard, Rules). It also covers two Plan 2 carry-overs:
- The §15 fix for the treasury wallet custom id.
- Reconciliation of unknown x402 settlements.

Signer facts come from `docs/superpowers/spikes/2026-10-11-para.md`. The Textile API facts come from the live OpenAPI document at `https://api.textilecredit.com/v2/openapi.json` (read 2026-10-09).

This is plan 3 of 4. Plan 4 covers chat, the landing page, polish and submission. Deliberate deviations from the spec, each small:

1. **`takerProof` is signed for every RFQ request**, not cached for 11 hours (§10.4 step 3). The OpenAPI document requires `issuedAt` within 60 seconds of Textile's clock. The 12-hour grant covers "the same caller", and on Vercel that is not a stable identity. One extra Para `sign-typed-data` call per RFQ is cheap.
2. **Approve and call `quote.spender`**, which is the reactor on an ordinary quote. The OpenAPI document says a vault-routed quote names a different spender. The executor allows only the known reactor `0xa9AA…35b3`, so such a quote is refused, never signed.
3. **Treasury gas is paid in stablecoins (CIP-64)**. This was a team decision on 2026-10-09; it replaces §8.6's CELO drip default.
   - The wallet pays with USD₮, then USA₮, then USDC, whichever holds at least 0.02.
   - When none does, the operator drips 0.05 USDC, at most once per 24 hours per wallet.
   - Para's `sign-transaction` accepts only types 0 and 2, so treasury transactions are signed with `sign-raw` over the CIP-64 digest (spike check 5).
   - `TreasurySigner` therefore exposes `signDigest` and `signTypedData` instead of `signTransaction`.
4. **`treasury_txs` table.** Every signed treasury transaction is stored, raw bytes included, before it is broadcast. A run with an unknown outcome re-sends the identical bytes, or settles the transaction by receipt or nonce (§10.4 step 7, §12). Withdrawals live here too, so there is no separate table. Para signing calls carry no idempotency key: signing has no side effect, and nothing is ever re-signed for a nonce already used.
5. **`fx_trades` logs every RFQ outcome**: `no_quote`, `rejected`, `expired`, `broadcast`, `filled` and `failed`. The §10.5 volume figures (requested, quoted, filled) come from this one table.
6. **`agent_events` stores `type` + `data` only.** The text is rendered from `en.ts` templates at display time (§8.8 "Default explanations are English templates"), so there is no `message` column.
7. **The intent deadline is computed** as `created_at + rules.maxWaitMinutes` (so a rules change applies at once), so there is no `deadline_at` column. `retry_after` is added for Textile's `retryAfterMs`.
8. **The engine also sells the *other* local token** (an ARS freelancer paid in wBRL) into USD₮, with reason `save_other`. The spec is silent; without this the wBRL would sit in the treasury forever.
9. **USA₮→USD₮ is priced against 1:1**, the same convention §9 uses for invoices. The `USAT_USDT` ticker is one-sided.
10. **`payments.rates_snapshot`** stores the reference rates at payment time. Without it, §10.5's "held in local currency from the moment it arrived" cannot be computed.
11. **The "Value protected" trend chart moves to Plan 4.** This plan shows the number with a text explanation.
12. **The §15 risk is fixed.** The treasury wallet's Para custom id becomes `para:<Para user id>`, and an existing wallet is adopted before a new one is created. Existing wallets, created with our user id, keep working.
13. **Unknown x402 settlements are reconciled** (Plan 2 ruling). After the hold expires, the cron looks for the matching on-chain transfer. It records the payment if the transfer is found, and reopens the invoice otherwise.
14. **No Para Guardrail policy is written.** The spike showed that an active policy is not enforced for REST signing (§8.4), so `encodeTreasuryCall` remains the only enforcement. Re-testing Guardrails stays a follow-up.

## Global Constraints

- Celo mainnet only: chain id `42220`, RPC `https://forno.celo.org`, explorer `https://celoscan.io`. Celo produces one block per second.
- Every transaction we broadcast carries our ERC-8021 tag `celo_bc3965e128ba`:
  - Treasury transactions get it through `tagCalldata` in `signTreasuryTx`.
  - Operator transactions get it through `createOperatorClient`.
  - Never derive the tag (spec §8.5).
- Tokens, decimals and fee-currency adapters come only from `TOKENS` in `src/lib/chain/tokens.ts`:
  - Pay assets are USAT, USDT, WARS and WBRL (6, 6, 18 and 18 decimals).
  - USDC appears only as a gas token and the operator's drip. It is never a bucket and never traded (spec §5).
- Textile: RFQ base `https://api.textilecredit.com/v2` (from env `TEXTILE_API_URL` + `/v2`), keyless with `takerProof`, client timeout 75 s, $1 minimum notional, at most 4 outstanding RFQs. Reactor `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`.
- The treasury signs only these calls (spec §6.1, §12), enforced in `encodeTreasuryCall`:
  - `approve(allowedSpender)` on a pay asset.
  - The quote's swap on an allowed spender, with value 0.
  - `transfer` of a pay asset to the freelancer's personal wallet.
- Global switches: `TREASURY_ENABLED` (default `false`) and `TREASURY_DRY_RUN` (default `true`). Per user, `rules.enabled`.
- Token amounts are `bigint` in code and base-10 strings in the database and JSON, never floats. USD values inside the treasury code are 18-decimal "wads". `Number()` is allowed only for cents and basis points, which are integers well below 2^31, and inside `formatMoney`.
- Secrets live only in `.env.local` (gitignored), Vercel env and GitHub Actions secrets: `DATABASE_URL`, `SESSION_SECRET`, `X402_API_KEY`, `CRON_SECRET`, `PARA_API_KEY`, `OPERATOR_PRIVATE_KEY`. Never print, log or commit them. Check names or lengths only. Push values through stdin.
- Next.js 16.4 runs with `cacheComponents: true`. Any component that reads `cookies()`, `params`, `searchParams`, the database or the chain sits inside `<Suspense>`, and it awaits the request value before doing I/O.
- All user-facing text goes through `t()` with keys in `src/i18n/en.ts`.
- UI follows `design-system/cobro/MASTER.md`:
  - Tokens only, Lucide icons with `aria-hidden`, `min-h-11` touch targets.
  - One primary button per screen.
  - `role="alert"` or `aria-live` for status.
  - Skeleton, empty, error and success states.
  - Token units, gas, hashes and addresses stay behind "Details" (or "Why?").
- Every fiat amount on screen goes through `formatMoney` or `displayAmount`.
- Tests are colocated `*.test.ts` run by `npm test`. Unit tests never touch the network: inject `fetch`, use fake viem transports, or use fake deps. DB tests use `createTestDb()`, which is PGlite with the real migrations and a single connection.
- Branch `plan-3-treasury`. Commit messages are `feat(scope): …` / `fix(scope): …` / `docs: …` / `chore: …`, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The repo-local author `hms1499` stays as configured.
- No mainnet transaction, Vercel env change, merge or push happens before Task 17, and in Task 17 only after the user says yes to that step.

## Review Focus

1. **A cron run and a payment-triggered run reach the same wallet in the same second.** Exactly one of them talks to Textile and signs; the other returns `locked`. A lock left by a killed function expires after 5 minutes. Pinned in Task 8 (lock) and Task 9 (executor returns `locked`).
2. **A swap is broadcast and the function dies before the receipt.** The next run makes no new RFQ and signs nothing. It re-sends the identical stored bytes, or settles the transaction from its receipt. If another transaction consumed the nonce, it marks the swap failed. Pinned in Task 9.
3. **The quote does not match what was asked.** It names another taker, charges more than the intent amount, targets an unknown spender, or is priced beyond the limit. Nothing is approved or signed, and the RFQ is cancelled. Pinned in Tasks 6 and 9.
4. **Small and odd balances**:
   - reserve 0;
   - balances under $1;
   - the daily cap used up;
   - a freelancer paid in the other local currency;
   - USD₮ that must also pay gas.

   No RFQ goes out below Textile's $1 minimum or above the caps, and the gas reserve is never sold. Pinned in Task 4.
5. **A withdrawal names an address other than the freelancer's own wallet, or more than is available after gas.** It is refused before anything is signed. Pinned in Tasks 6 and 11.

---

## File Structure

```
drizzle/0001_*.sql, drizzle/meta/*            generated migration (Task 1)
src/lib/db/schema.ts                          + fx_intents, fx_trades, treasury_txs, agent_events, wallet_locks, payments.rates_snapshot
src/lib/db/testing.ts                         resetDb truncates the new tables
src/lib/config/server.ts                      + TREASURY_ENABLED, TREASURY_DRY_RUN
src/lib/users/provision.ts                    custom id = para:<Para user id>; adopt before create (Task 2)
src/lib/treasury/value.ts                     USD wads, token ↔ fiat helpers (pure)
src/lib/treasury/engine.ts                    decide, planIntent, acceptQuote, slippageBps (pure)
src/lib/fx/rfq.ts                             Textile RFQ v2 client + TakerControl typed data
src/lib/signer/treasury-signer.ts             TreasurySigner: Para (sign-raw, sign-typed-data) and local key
src/lib/chain/treasury-tx.ts                  gas token choice, policy guard, CIP-64 signing with tag
src/lib/treasury/balances.ts                  token balances, spendable balances
src/lib/treasury/gas.ts                       operator USDC drip and its 24 h claim
src/lib/treasury/repo.ts                      locks, context, intents, trades, events, treasury txs
src/lib/treasury/executor.ts                  runTreasuryForUser, sendTreasuryTx, reconcile, runTreasuries
src/lib/treasury/live.ts                      real deps from env; runTreasuryAfterPayment
src/lib/treasury/withdraw.ts                  withdrawable amount, form parsing, withdraw()
src/lib/treasury/pnl.ts                       protected value (pure)
src/lib/treasury/stats.ts                     P&L inputs, volume, conversions, repeat clients (queries)
src/lib/treasury/explain.ts                   event and decision texts (pure)
src/lib/treasury/view.ts                      dashboard figures (pure) + loadTreasuryView (live)
src/lib/treasury/rules-form.ts                parseRulesForm, saveRules
src/lib/payments/reconcile.ts                 unknown-settlement reconciliation + log finder
src/app/api/cron/treasury/route.ts            issue recurring → reconcile → run treasuries
src/app/api/pay/[slug]/route.ts               after(): treasury run for the paid invoice's owner
src/app/app/page.tsx                          dashboard sections
src/app/app/treasury-summary.tsx, agent-status.tsx, activity-feed.tsx, conversions.tsx, repeat-clients.tsx
src/app/app/actions.ts                        + setAgentEnabled
src/app/app/withdraw/page.tsx, withdraw-form.tsx, actions.ts
src/app/app/rules/page.tsx, rules-form.tsx, actions.ts
src/app/app/app-nav.tsx                       + Agent
.github/workflows/treasury-cron.yml           longer timeout
docs/superpowers/smoke/2026-10-treasury.md    mainnet smoke results (Task 17)
```

---

### Task 1: Schema, migration and treasury switches

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/testing.ts`, `src/lib/db/schema.test.ts`, `src/lib/config/server.ts`, `src/lib/config/config.test.ts`, `.env.example`
- Create: `drizzle/0001_*.sql`, `drizzle/meta/0001_snapshot.json` (generated)

**Interfaces:**
- Consumes: `createdAt()`, `atomic()`, `payAsset`, `users`, `treasuryWallets` (existing schema helpers).
- Produces:
  - Enums `intentStatus` (`waiting|executing|filled|blocked|cancelled`), `intentReason` (`save_excess|save_other|top_up|hub_route`), `tradeStatus` (`no_quote|rejected|expired|broadcast|filled|failed`), `txKind` (`approve|swap|withdraw`), `txStatus` (`pending|success|reverted`).
  - Tables `fxIntents`, `fxTrades`, `treasuryTxs`, `agentEvents`, `walletLocks`; column `payments.ratesSnapshot` (`jsonb`, `Record<string, string> | null`).
  - `AGENT_EVENT_TYPES` and `type AgentEventType`.
  - Row types `FxIntentRow`, `FxTradeRow`, `TreasuryTxRow`, `AgentEventRow`, `IntentReason`, `TradeStatus`, `TxKind`.
  - Server env `TREASURY_ENABLED: boolean` (default false), `TREASURY_DRY_RUN: boolean` (default true).

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only && git checkout -b plan-3-treasury
```

(The plan file is committed on this branch before Task 1 starts.)

- [ ] **Step 2: Write the failing schema test**

Append to `src/lib/db/schema.test.ts`. Its `beforeAll` already creates `db` and `beforeEach` resets it. Extend the schema import to `import { fxIntents, invoiceQuotes, payments, recurringInvoices, rules } from "./schema";`, then add:

```ts
describe("treasury tables", () => {
  it("allows one open intent per user and keeps closed ones", async () => {
    const user = await seedFreelancer(db);
    const intent = {
      userId: user.id,
      fromAsset: "WARS",
      toAsset: "USDT",
      amountAtomic: "1000",
      reason: "save_excess",
    } as const;
    await db.insert(fxIntents).values({ ...intent, status: "filled" });
    await db.insert(fxIntents).values({ ...intent, status: "cancelled" });
    const [open] = await db.insert(fxIntents).values(intent).returning();
    expect(open).toMatchObject({ status: "waiting", attempts: 0, retryAfter: null });
    await expect(db.insert(fxIntents).values({ ...intent, status: "executing" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Write the failing env test**

Append to `src/lib/config/config.test.ts`:

```ts
describe("treasury switches", () => {
  it("defaults to off and dry run", () => {
    const env = parseServerEnv({});
    expect(env.TREASURY_ENABLED).toBe(false);
    expect(env.TREASURY_DRY_RUN).toBe(true);
  });

  it("reads true and false", () => {
    const env = parseServerEnv({ TREASURY_ENABLED: "true", TREASURY_DRY_RUN: "false" });
    expect(env.TREASURY_ENABLED).toBe(true);
    expect(env.TREASURY_DRY_RUN).toBe(false);
  });

  it("names the variable on anything else", () => {
    expect(() => parseServerEnv({ TREASURY_DRY_RUN: "yes" })).toThrow(/TREASURY_DRY_RUN/);
  });
});
```

- [ ] **Step 4: Run both to see them fail**

Run: `npx vitest run src/lib/db/schema.test.ts src/lib/config/config.test.ts`
Expected: FAIL. `fxIntents` is not exported from `./schema` (schema test), and `env.TREASURY_ENABLED` is `undefined` (config test).

- [ ] **Step 5: Add the switches to `src/lib/config/server.ts`**

Above `const serverEnvSchema`, add:

```ts
/** "true" / "false" only, so a typo never silently turns live trading on. */
const flag = (fallback: "true" | "false") =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(["true", "false"])
      .default(fallback)
      .transform((value) => value === "true"),
  );
```

Inside the `z.object({ … })`, after `TEXTILE_API_URL`, add:

```ts
  TREASURY_ENABLED: flag("false"),
  TREASURY_DRY_RUN: flag("true"),
```

Append to `.env.example`, under the `TEXTILE_API_URL` line:

```
# Treasury agent (spec §10.1): global switch and dry run. Production runs dry for a while before live swaps.
TREASURY_ENABLED=false
TREASURY_DRY_RUN=true
```

- [ ] **Step 6: Add the tables to `src/lib/db/schema.ts`**

Change the imports at the top to:

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
```

Add the new enums after `export const signerType = …`:

```ts
export const intentStatus = pgEnum("intent_status", ["waiting", "executing", "filled", "blocked", "cancelled"]);
export const intentReason = pgEnum("intent_reason", ["save_excess", "save_other", "top_up", "hub_route"]);
export const tradeStatus = pgEnum("trade_status", ["no_quote", "rejected", "expired", "broadcast", "filled", "failed"]);
export const txKind = pgEnum("tx_kind", ["approve", "swap", "withdraw"]);
export const txStatus = pgEnum("tx_status", ["pending", "success", "reverted"]);
```

In the `payments` table, add after `txHash`:

```ts
    /** Textile reference rates (local units per USD, decimal strings) when the payment settled; P&L input (spec §10.5). */
    ratesSnapshot: jsonb("rates_snapshot").$type<Record<string, string>>(),
```

Add the new tables after `payments` and before the row types:

```ts
/** Spec §10.2: at most one open (waiting or executing) intent per user. */
export const fxIntents = pgTable(
  "fx_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromAsset: payAsset("from_asset").notNull(),
    toAsset: payAsset("to_asset").notNull(),
    amountAtomic: atomic("amount_atomic").notNull(),
    reason: intentReason("reason").notNull(),
    status: intentStatus("status").notNull().default("waiting"),
    attempts: integer("attempts").notNull().default(0),
    lastSlippageBps: integer("last_slippage_bps"),
    /** Textile asked us to wait (retryAfterMs) or an RFQ just failed; no new RFQ before this time. */
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fx_intents_one_open_uq").on(t.userId).where(sql`status in ('waiting', 'executing')`)],
);

/** One row per RFQ we sent, whatever came of it (spec §10.5 volume: requested, quoted, filled). */
export const fxTrades = pgTable(
  "fx_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    intentId: uuid("intent_id").references(() => fxIntents.id, { onDelete: "set null" }),
    rfqId: text("rfq_id"),
    /** Textile's ownership proof for submit/cancel/status; returned once by /rfq/request. */
    claimToken: text("claim_token"),
    sellAsset: payAsset("sell_asset").notNull(),
    buyAsset: payAsset("buy_asset").notNull(),
    /** takerPays once quoted, the requested amount otherwise. */
    sellAmount: atomic("sell_amount").notNull(),
    buyAmount: atomic("buy_amount"),
    feeAmount: atomic("fee_amount"),
    slippageBps: integer("slippage_bps"),
    notionalUsdCents: integer("notional_usd_cents").notNull().default(0),
    status: tradeStatus("status").notNull(),
    detail: text("detail"),
    swapTxHash: text("swap_tx_hash").unique(),
    createdAt: createdAt(),
    filledAt: timestamp("filled_at", { withTimezone: true }),
  },
  (t) => [index("fx_trades_user_created_idx").on(t.userId, t.createdAt)],
);

/** Every transaction a treasury wallet signed, stored before broadcast so it can be re-sent or settled (spec §10.4 step 7). */
export const treasuryTxs = pgTable(
  "treasury_txs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: txKind("kind").notNull(),
    nonce: integer("nonce").notNull(),
    hash: text("hash").notNull().unique(),
    raw: text("raw").notNull(),
    feeToken: text("fee_token").notNull(),
    status: txStatus("status").notNull().default("pending"),
    /** Withdrawals only: what was sent, where, and its USD value then. */
    asset: payAsset("asset"),
    amountAtomic: atomic("amount_atomic"),
    toAddress: text("to_address"),
    usdCents: integer("usd_cents"),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [index("treasury_txs_user_status_idx").on(t.userId, t.status)],
);

export const AGENT_EVENT_TYPES = [
  "dry_run",
  "converted",
  "waiting",
  "no_quote",
  "blocked",
  "policy_rejected",
  "swap_failed",
  "gas_dripped",
  "needs_gas",
  "withdrawn",
  "withdraw_failed",
  "paused",
  "resumed",
  "payment_reconciled",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** The activity feed (spec §17.1 principle 4). Text comes from en.ts templates at display time. */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AgentEventType>().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("agent_events_user_created_idx").on(t.userId, t.createdAt)],
);

/** Spec §10.4 step 1: one treasury run per wallet at a time; a crashed holder's lock expires. */
export const walletLocks = pgTable("wallet_locks", {
  walletId: uuid("wallet_id")
    .primaryKey()
    .references(() => treasuryWallets.id, { onDelete: "cascade" }),
  holder: uuid("holder").notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
});
```

Add the row types after the existing ones:

```ts
export type FxIntentRow = typeof fxIntents.$inferSelect;
export type FxTradeRow = typeof fxTrades.$inferSelect;
export type TreasuryTxRow = typeof treasuryTxs.$inferSelect;
export type AgentEventRow = typeof agentEvents.$inferSelect;
export type IntentReason = (typeof intentReason.enumValues)[number];
export type TradeStatus = (typeof tradeStatus.enumValues)[number];
export type TxKind = (typeof txKind.enumValues)[number];
```

In `src/lib/db/testing.ts`, replace the `resetDb` body with:

```ts
  await db.execute(
    sql`TRUNCATE users, treasury_wallets, rules, recurring_invoices, invoices, invoice_quotes, payments, fx_intents, fx_trades, treasury_txs, agent_events, wallet_locks CASCADE`,
  );
```

- [ ] **Step 7: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0001_<random_name>.sql` containing `CREATE TYPE "public"."intent_status"`, `CREATE TABLE "fx_intents"`, `CREATE TABLE "treasury_txs"`, `ALTER TABLE "payments" ADD COLUMN "rates_snapshot" jsonb` and `CREATE UNIQUE INDEX "fx_intents_one_open_uq" … WHERE status in ('waiting', 'executing')`. Also `drizzle/meta/0001_snapshot.json` and an updated `_journal.json`.

- [ ] **Step 8: Run the tests to see them pass**

Run: `npx vitest run src/lib/db/schema.test.ts src/lib/config/config.test.ts`
Expected: PASS.

- [ ] **Step 9: Apply the migration to the Neon dev branch**

Run: `npm run db:migrate`
Expected: `Migrations applied`. The script reads `.env.local`, which points at the Neon **dev** branch. Production's Neon **main** branch is migrated in Task 17.

- [ ] **Step 10: Full suite and commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass; no type errors.

```bash
git add src/lib/db/schema.ts src/lib/db/testing.ts src/lib/db/schema.test.ts src/lib/config/server.ts src/lib/config/config.test.ts .env.example drizzle
git commit -m "feat(db): treasury tables, payment rate snapshot and treasury switches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Key the treasury wallet on the Para user (spec §15)

**Files:**
- Modify: `src/lib/users/provision.ts`, `src/lib/users/provision.test.ts`, `src/lib/signer/para-rest.ts`

**Interfaces:**
- Consumes: `users.paraUserId`, `TreasuryWalletProvider` (existing).
- Produces:
  - `treasuryCustomId(paraUserId: string): string` returns `` `para:${paraUserId}` ``.
  - `ensureTreasuryWallet(db, userId, provider, now?)` keeps its signature. It now looks the wallet up by `treasuryCustomId(...)` before creating one.

- [ ] **Step 1: Update the tests first**

In `src/lib/users/provision.test.ts`, make these changes.

Change the first `ensureTreasuryWallet` test to:

```ts
  it("creates one app-owned wallet keyed by the Para user, after checking none exists", async () => {
    const user = await upsertUser(db, session);
    const provider = fakeProvider();
    const state = await ensureTreasuryWallet(db, user.id, provider);
    expect(state).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.findWalletByCustomId).toHaveBeenCalledWith("para:para-123");
    expect(provider.createWallet).toHaveBeenCalledWith("para:para-123");
    expect(await walletRow(user.id)).toMatchObject({ status: "ready", paraWalletId: "para-w1", address: ADDRESS });
  });

  it("re-adopts the Para user's wallet after our user row was lost", async () => {
    const first = await upsertUser(db, session);
    await ensureTreasuryWallet(db, first.id, fakeProvider());
    await db.delete(users).where(eq(users.id, first.id));

    const again = await upsertUser(db, session);
    const provider = fakeProvider({
      findWalletByCustomId: vi.fn(async (): Promise<ParaWallet> => ({ id: "para-w1", type: "EVM", status: "ready", address: ADDRESS })),
    });
    expect(await ensureTreasuryWallet(db, again.id, provider)).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).not.toHaveBeenCalled();
    expect(await walletRow(again.id)).toMatchObject({ status: "ready", paraWalletId: "para-w1" });
  });
```

In the test "adopts the wallet Para already created when a dead request never stored its id", replace the `findWalletByCustomId` mock and its assertion:

```ts
      findWalletByCustomId: vi
        .fn<() => Promise<ParaWallet | null>>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "para-existing", type: "EVM", status: "creating" }),
```

```ts
    expect(provider.findWalletByCustomId).toHaveBeenNthCalledWith(2, "para:para-123");
```

In "does not look up a wallet for other creation errors", rename the test to "does not look up a wallet again for other creation errors" and replace the `not.toHaveBeenCalled()` line with:

```ts
    expect(provider.findWalletByCustomId).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/users/provision.test.ts`
Expected: FAIL. `createWallet` was called with the user's uuid instead of `"para:para-123"`, and the re-adopt test calls `createWallet`.

- [ ] **Step 3: Implement in `src/lib/users/provision.ts`**

Rename the provider parameters (types only):

```ts
export interface TreasuryWalletProvider {
  createWallet(customId: string): Promise<ParaWallet>;
  waitUntilReady(walletId: string): Promise<ParaWallet>;
  /** Finds the wallet Para already holds for this custom id (adopted after a lost row or a lost wallet id). */
  findWalletByCustomId(customId: string): Promise<ParaWallet | null>;
}
```

Replace the doc comment on `ensureTreasuryWallet` with:

```ts
/**
 * Spec §6.2 flow 1: one app-owned Para wallet per user. Its CUSTOM_ID is the Para user id (§15), so
 * email sign-in never claims it and a lost users row re-adopts it instead of orphaning its funds.
 * The row is inserted first as a claim, so concurrent sign-ins create one wallet.
 */
```

In `createOrResume`, replace

```ts
      walletId = await createOrRecoverWalletId(provider, userId);
```

with

```ts
      walletId = await adoptOrCreateWalletId(provider, await customIdFor(db, userId));
```

Replace the whole `createOrRecoverWalletId` function with:

```ts
export function treasuryCustomId(paraUserId: string): string {
  return `para:${paraUserId}`;
}

async function customIdFor(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ paraUserId: users.paraUserId }).from(users).where(eq(users.id, userId));
  if (!row) throw new Error(`User ${userId} not found`);
  return treasuryCustomId(row.paraUserId);
}

/**
 * Adopt first: the wallet may exist from an earlier users row (§15). If Para still answers 409
 * WALLET_ALREADY_EXISTS (a race with another request), look it up once more.
 */
async function adoptOrCreateWalletId(provider: TreasuryWalletProvider, customId: string): Promise<string> {
  const existing = await provider.findWalletByCustomId(customId);
  if (existing) return existing.id;
  try {
    return (await provider.createWallet(customId)).id;
  } catch (error) {
    if (!(error instanceof ParaRestError) || error.status !== 409 || error.code !== "WALLET_ALREADY_EXISTS") throw error;
    const created = await provider.findWalletByCustomId(customId);
    if (!created) throw error;
    return created.id;
  }
}
```

In `src/lib/signer/para-rest.ts`, rename the parameter of `createWallet(userId: string)` to `createWallet(customId: string)` and use `userIdentifier: customId`. Rename the parameter of `findWalletByCustomId(userId: string)` to `customId` and use `userIdentifier: customId`. Behaviour is unchanged.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/lib/users/provision.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/users/provision.ts src/lib/users/provision.test.ts src/lib/signer/para-rest.ts
git commit -m "fix(users): key treasury wallets on the Para user and adopt before creating

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: USD wads and token ↔ fiat helpers

**Files:**
- Create: `src/lib/treasury/value.ts`, `src/lib/treasury/value.test.ts`

**Interfaces:**
- Consumes: `TOKENS`, `ReferenceRates` (`perUsd: Record<"ARS"|"BRL", bigint>`, 18 decimals), `ASSET_DENOMINATION`, `parseDecimal`, `RATE_ONE`.
- Produces:
  - `WAD = 10n ** 18n` and `LOCAL_ASSET: Record<LocalCurrency, "WARS" | "WBRL">`.
  - `usdWad(asset: PayAsset, atomic: bigint, rates: ReferenceRates): bigint` and `atomicForUsdWad(asset, usd: bigint, rates): bigint` (rounded down).
  - `dollarsToWad(dollars: number): bigint`.
  - `fiatToAtomic(amount: string, asset: PayAsset): bigint`.
  - `formatCents(cents: bigint): string` and `usdWadToDollars(wad: bigint): string`.
  - `tokenFiatAmount(asset: PayAsset, atomic: bigint): { amount: string; currency: FiatCurrency }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/treasury/value.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import {
  atomicForUsdWad,
  dollarsToWad,
  fiatToAtomic,
  formatCents,
  tokenFiatAmount,
  usdWad,
  usdWadToDollars,
  WAD,
} from "./value";

const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;

describe("usdWad", () => {
  it("values dollar tokens one to one and local tokens at the reference mid", () => {
    expect(usdWad("USDT", 1_500_000n, RATES)).toBe(1_500_000_000_000_000_000n);
    expect(usdWad("USAT", 1n, RATES)).toBe(1_000_000_000_000n);
    expect(usdWad("WARS", pesos(3200n), RATES)).toBe(2n * WAD);
    expect(usdWad("WBRL", pesos(10n), RATES)).toBe(2n * WAD);
  });
});

describe("atomicForUsdWad", () => {
  it("inverts usdWad, rounding down", () => {
    expect(atomicForUsdWad("WARS", 2n * WAD, RATES)).toBe(pesos(3200n));
    expect(atomicForUsdWad("USDT", 2n * WAD, RATES)).toBe(2_000_000n);
    expect(atomicForUsdWad("USDT", 999_999_999_999n, RATES)).toBe(0n);
  });
});

describe("conversions for rules and display", () => {
  it("turns whole dollars and fiat strings into units", () => {
    expect(dollarsToWad(50)).toBe(50n * WAD);
    expect(fiatToAtomic("300000.00", "WARS")).toBe(pesos(300000n));
    expect(fiatToAtomic("12.5", "USDT")).toBe(12_500_000n);
  });

  it("formats cents, including negatives", () => {
    expect(formatCents(123456n)).toBe("1234.56");
    expect(formatCents(-5n)).toBe("-0.05");
    expect(usdWadToDollars(1_234_567_000_000_000_000n)).toBe("1.23");
  });

  it("gives a balance as a fiat amount rounded down to cents", () => {
    expect(tokenFiatAmount("WARS", 2_409_205_000_000_000_000_000n)).toEqual({ amount: "2409.20", currency: "ARS" });
    expect(tokenFiatAmount("USAT", 1_000_000n)).toEqual({ amount: "1.00", currency: "USD" });
    expect(tokenFiatAmount("WBRL", 0n)).toEqual({ amount: "0.00", currency: "BRL" });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/treasury/value.test.ts`
Expected: FAIL with "Failed to resolve import "./value"".

- [ ] **Step 3: Implement**

```ts
// src/lib/treasury/value.ts
import { TOKENS } from "@/lib/chain/tokens";
import type { ReferenceRates } from "@/lib/fx/rates";
import { ASSET_DENOMINATION, type FiatCurrency, type LocalCurrency, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal, RATE_ONE } from "@/lib/money/decimal";

/** USD amounts in the treasury code are "wads": 18-decimal fixed point. */
export const WAD = 10n ** 18n;

/** The spending token of each local currency (rules store ARS or BRL). */
export const LOCAL_ASSET: Record<LocalCurrency, "WARS" | "WBRL"> = { ARS: "WARS", BRL: "WBRL" };

const toEighteen = (asset: PayAsset) => 10n ** BigInt(18 - TOKENS[asset].decimals);

/** USD value with 18 decimals. USD₮ and USA₮ count one to one (spec §9); local tokens use the reference mid. */
export function usdWad(asset: PayAsset, atomic: bigint, rates: ReferenceRates): bigint {
  const units = atomic * toEighteen(asset);
  const currency = ASSET_DENOMINATION[asset];
  return currency === "USD" ? units : (units * RATE_ONE) / rates.perUsd[currency];
}

/** Atomic units of `asset` worth `usd` (18 decimals), rounded down. */
export function atomicForUsdWad(asset: PayAsset, usd: bigint, rates: ReferenceRates): bigint {
  const currency = ASSET_DENOMINATION[asset];
  const units = currency === "USD" ? usd : (usd * rates.perUsd[currency]) / RATE_ONE;
  return units / toEighteen(asset);
}

/** Rules hold whole dollars (perTradeMaxUsd, dailyMaxUsd). */
export function dollarsToWad(dollars: number): bigint {
  return BigInt(dollars) * WAD;
}

/** A fiat string such as "300000.00" as atomic units of the token that tracks it. */
export function fiatToAtomic(amount: string, asset: PayAsset): bigint {
  return parseDecimal(amount, TOKENS[asset].decimals);
}

export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** A USD wad as dollars with cents, truncated toward zero, ready for formatMoney. */
export function usdWadToDollars(wad: bigint): string {
  return formatCents(wad / 10n ** 16n);
}

/** A token balance as the fiat amount it tracks, rounded down to cents (USD₮ → USD, wARS → ARS). */
export function tokenFiatAmount(asset: PayAsset, atomic: bigint): { amount: string; currency: FiatCurrency } {
  return { amount: formatCents(atomic / 10n ** BigInt(TOKENS[asset].decimals - 2)), currency: ASSET_DENOMINATION[asset] };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/treasury/value.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/value.ts src/lib/treasury/value.test.ts
git commit -m "feat(treasury): USD wad and token-to-fiat helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Treasury engine (pure)

**Files:**
- Create: `src/lib/treasury/engine.ts`, `src/lib/treasury/engine.test.ts`

**Interfaces:**
- Consumes: Task 3 (`usdWad`, `atomicForUsdWad`, `dollarsToWad`, `fiatToAtomic`, `LOCAL_ASSET`, `WAD`), `ReferenceRates`, `PayAsset`, `LocalCurrency`.
- Produces:
  - `type Balances = Record<PayAsset, bigint>` (spendable).
  - `type ConvertReason = "save_excess" | "save_other" | "top_up" | "hub_route"` and `type IdleReason = "within_band" | "daily_cap" | "below_minimum" | "no_dollars"`.
  - `interface EngineRules { localCurrency; reserveAmount: string; autoTopUp: boolean; perTradeMaxUsd: number; dailyMaxUsd: number }` and `interface EngineInput { balances; rules; rates; filledUsdWad24h: bigint }`.
  - `type ConvertDecision = { kind: "convert"; from: PayAsset; to: PayAsset; amount: bigint; usdWad: bigint; reason: ConvertReason }` and `type Decision = { kind: "none"; reason: IdleReason } | ConvertDecision`.
  - `MIN_NOTIONAL_WAD` and `decide(input): Decision`.
  - `interface OpenIntent { id: string; fromAsset: PayAsset; toAsset: PayAsset }`, `type IntentPlan = { action: "none"; cancel: string | null } | { action: "convert"; keep: string | null; cancel: string | null; decision: ConvertDecision }` and `planIntent(open: OpenIntent | null, decision: Decision): IntentPlan`.
  - `type Acceptance = "accept" | "wait" | "block"` and `acceptQuote(input: { slippageBps: number; intentCreatedAt: Date; now: Date; maxSlippageBps: number; hardMaxSlippageBps: number; maxWaitMinutes: number }): Acceptance`.
  - `slippageBps(sellAsset: PayAsset, sellAtomic: bigint, buyAsset: PayAsset, buyAtomic: bigint, rates): number` (positive means worse than reference, rounded up).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/treasury/engine.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import { acceptQuote, decide, planIntent, slippageBps, type Balances, type EngineRules } from "./engine";
import { WAD } from "./value";

const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;
const dollars = (n: bigint) => n * 1_000_000n;
const balances = (b: Partial<Balances> = {}): Balances => ({ USDT: 0n, USAT: 0n, WARS: 0n, WBRL: 0n, ...b });
// Reserve 160,000 ARS = US$100; band = max(5% = 8,000 ARS, US$1 = 1,600 ARS) = 8,000 ARS.
const RULES: EngineRules = { localCurrency: "ARS", reserveAmount: "160000.00", autoTopUp: true, perTradeMaxUsd: 50, dailyMaxUsd: 200 };
const run = (b: Partial<Balances>, rules: Partial<EngineRules> = {}, filledUsdWad24h = 0n) =>
  decide({ balances: balances(b), rules: { ...RULES, ...rules }, rates: RATES, filledUsdWad24h });

describe("decide", () => {
  it("does nothing inside the band", () => {
    expect(run({ WARS: pesos(165_000n) })).toEqual({ kind: "none", reason: "within_band" });
    expect(run({ WARS: pesos(155_000n), USDT: dollars(100n) })).toEqual({ kind: "none", reason: "within_band" });
  });

  it("saves the excess above the reserve in USD₮", () => {
    expect(run({ WARS: pesos(200_000n) })).toEqual({
      kind: "convert",
      from: "WARS",
      to: "USDT",
      amount: pesos(40_000n),
      usdWad: 25n * WAD,
      reason: "save_excess",
    });
  });

  it("caps one trade at perTradeMaxUsd and splits the rest across runs", () => {
    expect(run({ WARS: pesos(400_000n) })).toMatchObject({ kind: "convert", amount: pesos(80_000n), usdWad: 50n * WAD });
  });

  it("caps by what is left of the daily limit", () => {
    expect(run({ WARS: pesos(400_000n) }, {}, 190n * WAD)).toMatchObject({ amount: pesos(16_000n), usdWad: 10n * WAD });
    expect(run({ WARS: pesos(400_000n) }, {}, 199n * WAD + WAD / 2n)).toEqual({ kind: "none", reason: "daily_cap" });
  });

  it("refills the reserve from USD₮", () => {
    expect(run({ WARS: pesos(100_000n), USDT: dollars(100n) })).toEqual({
      kind: "convert",
      from: "USDT",
      to: "WARS",
      amount: 37_500_000n,
      usdWad: 37n * WAD + WAD / 2n,
      reason: "top_up",
    });
    expect(run({ WARS: pesos(100_000n), USDT: dollars(10n) })).toMatchObject({ from: "USDT", amount: dollars(10n) });
  });

  it("routes USA₮ through USD₮ when USD₮ is short", () => {
    expect(run({ WARS: pesos(100_000n), USDT: 500_000n, USAT: dollars(80n) })).toMatchObject({
      kind: "convert",
      from: "USAT",
      to: "USDT",
      amount: 37_500_000n,
      reason: "hub_route",
    });
  });

  it("waits when there are no dollars to refill from, or refilling is off", () => {
    expect(run({ WARS: pesos(100_000n), USDT: 500_000n })).toEqual({ kind: "none", reason: "no_dollars" });
    expect(run({ WARS: pesos(100_000n), USDT: dollars(100n) }, { autoTopUp: false })).toEqual({ kind: "none", reason: "within_band" });
  });

  it("uses a US$1 band when the reserve is 0", () => {
    expect(run({ WARS: pesos(1_000n) }, { reserveAmount: "0.00" })).toEqual({ kind: "none", reason: "within_band" });
    expect(run({ WARS: pesos(3_200n) }, { reserveAmount: "0.00" })).toMatchObject({ amount: pesos(3_200n), usdWad: 2n * WAD });
  });

  it("saves the other local currency first, and ignores dust of it", () => {
    expect(run({ WARS: pesos(400_000n), WBRL: pesos(50n) })).toMatchObject({
      from: "WBRL",
      to: "USDT",
      amount: pesos(50n),
      usdWad: 10n * WAD,
      reason: "save_other",
    });
    expect(run({ WARS: pesos(165_000n), WBRL: pesos(2n) })).toEqual({ kind: "none", reason: "within_band" });
  });

  it("works the same for a Brazilian freelancer", () => {
    expect(run({ WBRL: pesos(1_000n) }, { localCurrency: "BRL", reserveAmount: "500.00" })).toMatchObject({
      from: "WBRL",
      to: "USDT",
      amount: pesos(250n),
      usdWad: 50n * WAD,
      reason: "save_excess",
    });
  });
});

describe("planIntent", () => {
  const convert = run({ WARS: pesos(200_000n) });
  const open = { id: "i1", fromAsset: "WARS", toAsset: "USDT" } as const;

  it("keeps an open intent for the same pair, so its age still counts", () => {
    expect(planIntent(open, convert)).toEqual({ action: "convert", keep: "i1", cancel: null, decision: convert });
  });

  it("cancels an open intent for another pair, or when nothing is needed", () => {
    expect(planIntent({ ...open, toAsset: "USAT" }, convert)).toEqual({ action: "convert", keep: null, cancel: "i1", decision: convert });
    expect(planIntent(open, { kind: "none", reason: "within_band" })).toEqual({ action: "none", cancel: "i1" });
    expect(planIntent(null, convert)).toEqual({ action: "convert", keep: null, cancel: null, decision: convert });
  });
});

describe("acceptQuote", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const limits = { maxSlippageBps: 50, hardMaxSlippageBps: 150, maxWaitMinutes: 360, now };
  const young = new Date(now.getTime() - 60 * 60_000);
  const old = new Date(now.getTime() - 361 * 60_000);

  it("accepts within the normal limit", () => {
    expect(acceptQuote({ ...limits, slippageBps: 50, intentCreatedAt: young })).toBe("accept");
    expect(acceptQuote({ ...limits, slippageBps: -20, intentCreatedAt: young })).toBe("accept");
  });

  it("waits for a better price until the deadline", () => {
    expect(acceptQuote({ ...limits, slippageBps: 80, intentCreatedAt: young })).toBe("wait");
  });

  it("after the deadline accepts up to the hard limit and blocks beyond it", () => {
    expect(acceptQuote({ ...limits, slippageBps: 150, intentCreatedAt: old })).toBe("accept");
    expect(acceptQuote({ ...limits, slippageBps: 151, intentCreatedAt: old })).toBe("block");
  });
});

describe("slippageBps", () => {
  it("measures the quote against the reference mid, rounding against us", () => {
    expect(slippageBps("WARS", pesos(1_600n), "USDT", 990_000n, RATES)).toBe(100);
    expect(slippageBps("WARS", pesos(1_600n), "USDT", 1_010_000n, RATES)).toBe(-100);
    expect(slippageBps("WARS", pesos(1_600n), "USDT", 999_999n, RATES)).toBe(1);
    expect(slippageBps("USDT", 10_000_000n, "WARS", pesos(15_950n), RATES)).toBe(32);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/treasury/engine.test.ts`
Expected: FAIL with "Failed to resolve import "./engine"".

- [ ] **Step 3: Implement**

```ts
// src/lib/treasury/engine.ts
import type { ReferenceRates } from "@/lib/fx/rates";
import type { LocalCurrency, PayAsset } from "@/lib/money/currencies";
import { atomicForUsdWad, dollarsToWad, fiatToAtomic, LOCAL_ASSET, usdWad, WAD } from "./value";

/** Spendable balances: the gas reserve has already been taken out (see spendableBalances). */
export type Balances = Record<PayAsset, bigint>;
export type ConvertReason = "save_excess" | "save_other" | "top_up" | "hub_route";
export type IdleReason = "within_band" | "daily_cap" | "below_minimum" | "no_dollars";

export interface EngineRules {
  localCurrency: LocalCurrency;
  reserveAmount: string;
  autoTopUp: boolean;
  perTradeMaxUsd: number;
  dailyMaxUsd: number;
}

export interface EngineInput {
  balances: Balances;
  rules: EngineRules;
  rates: ReferenceRates;
  /** Notional of swaps broadcast or filled in the last 24 hours. */
  filledUsdWad24h: bigint;
}

export type ConvertDecision = {
  kind: "convert";
  from: PayAsset;
  to: PayAsset;
  amount: bigint;
  usdWad: bigint;
  reason: ConvertReason;
};
export type Decision = { kind: "none"; reason: IdleReason } | ConvertDecision;

/** Textile refuses RFQs below $1 of notional (spec §8.3). */
export const MIN_NOTIONAL_WAD = WAD;

const none = (reason: IdleReason): Decision => ({ kind: "none", reason });
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Spec §10.2: balances and rules in, one decision out, no I/O. LOCAL is the spending token, USD is
 * USD₮ + USA₮, band = max(5% of the reserve, $1). Each trade is capped by perTradeMaxUsd and by what
 * is left of dailyMaxUsd; larger needs are split across runs.
 */
export function decide(input: EngineInput): Decision {
  const { balances, rules, rates } = input;
  const local = LOCAL_ASSET[rules.localCurrency];
  const other = local === "WARS" ? "WBRL" : "WARS";
  const capLeft = min(dollarsToWad(rules.perTradeMaxUsd), max(0n, dollarsToWad(rules.dailyMaxUsd) - input.filledUsdWad24h));

  const sized = (from: PayAsset, to: PayAsset, wanted: bigint, reason: ConvertReason): Decision => {
    if (capLeft < MIN_NOTIONAL_WAD) return none("daily_cap");
    let amount = wanted;
    let usd = usdWad(from, amount, rates);
    if (usd > capLeft) {
      amount = atomicForUsdWad(from, capLeft, rates);
      usd = usdWad(from, amount, rates);
    }
    if (usd < MIN_NOTIONAL_WAD) return none("below_minimum");
    return { kind: "convert", from, to, amount, usdWad: usd, reason };
  };

  // Paid in the other local currency: not spendable for this freelancer, so it is saved in dollars.
  if (usdWad(other, balances[other], rates) >= MIN_NOTIONAL_WAD) {
    return sized(other, "USDT", balances[other], "save_other");
  }

  const reserve = fiatToAtomic(rules.reserveAmount, local);
  const band = max(reserve / 20n, atomicForUsdWad(local, WAD, rates));
  const held = balances[local];
  if (held > reserve + band) return sized(local, "USDT", held - reserve, "save_excess");

  if (rules.autoTopUp && reserve > held + band) {
    const needed = usdWad(local, reserve - held, rates);
    if (usdWad("USDT", balances.USDT, rates) >= MIN_NOTIONAL_WAD) {
      return sized("USDT", local, min(balances.USDT, atomicForUsdWad("USDT", needed, rates)), "top_up");
    }
    // Textile has no USA₮ → peso corridor: move USA₮ to USD₮ first; the USD₮ leg follows next run.
    if (usdWad("USAT", balances.USAT, rates) >= MIN_NOTIONAL_WAD) {
      return sized("USAT", "USDT", min(balances.USAT, atomicForUsdWad("USAT", needed, rates)), "hub_route");
    }
    return none("no_dollars");
  }
  return none("within_band");
}

export interface OpenIntent {
  id: string;
  fromAsset: PayAsset;
  toAsset: PayAsset;
}

export type IntentPlan =
  | { action: "none"; cancel: string | null }
  | { action: "convert"; keep: string | null; cancel: string | null; decision: ConvertDecision };

/** Spec §10.2: the same pair keeps the open intent (and its age, for the wait deadline); anything else cancels it. */
export function planIntent(open: OpenIntent | null, decision: Decision): IntentPlan {
  if (decision.kind === "none") return { action: "none", cancel: open?.id ?? null };
  if (open && open.fromAsset === decision.from && open.toAsset === decision.to) {
    return { action: "convert", keep: open.id, cancel: null, decision };
  }
  return { action: "convert", keep: null, cancel: open?.id ?? null, decision };
}

export type Acceptance = "accept" | "wait" | "block";

/** Spec §10.3. */
export function acceptQuote(input: {
  slippageBps: number;
  intentCreatedAt: Date;
  now: Date;
  maxSlippageBps: number;
  hardMaxSlippageBps: number;
  maxWaitMinutes: number;
}): Acceptance {
  if (input.slippageBps <= input.maxSlippageBps) return "accept";
  const waited = input.now.getTime() - input.intentCreatedAt.getTime() >= input.maxWaitMinutes * 60_000;
  if (!waited) return "wait";
  return input.slippageBps <= input.hardMaxSlippageBps ? "accept" : "block";
}

/**
 * How much worse than the reference mid the quote is, in basis points of what we pay: positive is
 * worse, negative is better. Both legs are valued in USD at the reference rates; a loss is rounded up.
 */
export function slippageBps(
  sellAsset: PayAsset,
  sellAtomic: bigint,
  buyAsset: PayAsset,
  buyAtomic: bigint,
  rates: ReferenceRates,
): number {
  const paid = usdWad(sellAsset, sellAtomic, rates);
  if (paid <= 0n) throw new Error("A quote must sell a positive amount");
  const loss = (paid - usdWad(buyAsset, buyAtomic, rates)) * 10_000n;
  return Number(loss > 0n ? (loss + paid - 1n) / paid : loss / paid);
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/treasury/engine.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/engine.ts src/lib/treasury/engine.test.ts
git commit -m "feat(treasury): pure decision engine, intent planning and price acceptance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Textile RFQ client

**Files:**
- Create: `src/lib/fx/rfq.ts`, `src/lib/fx/rfq.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CELO_CHAIN_ID = 42220` and `RFQ_TIMEOUT_MS = 75_000`.
  - `takerControlTypedData(taker: Address, nonce: Hex, issuedAt: number)`: EIP-712 typed data `as const`, `message.chainId` and `message.issuedAt` as bigint.
  - `interface TakerProof { nonce: Hex; issuedAt: number; signature: Hex }`.
  - `interface FirmQuote { rfqId; claimToken; sellAmount: bigint; buyAmount: bigint; feeAmount: bigint; takerPays: bigint; expiresAt: Date; spender: Address; taker: Address; swap: { to: Address; data: Hex; value: bigint; chainId: number } }`.
  - `type RfqOutcome = { status: "quoted"; quote: FirmQuote } | { status: "no_quote"; reason: string; retryAfterMs: number | null }`.
  - `class TextileError extends Error { status: number; reason: string | undefined }` (`status` 0 = network).
  - `class TextileRfqClient` with constructor `{ baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }` and methods:
    - `request({ sellToken, buyToken, sellAmount: bigint, taker, takerProof }): Promise<RfqOutcome>`.
    - `cancel(rfqId, claimToken): Promise<void>`.
    - `submit(rfqId, claimToken, txHash: Hex): Promise<void>`.

Facts from `https://api.textilecredit.com/v2/openapi.json`:
- `POST /v2/rfq/request` body `{ chainId, sellToken, buyToken, sellAmount (atomic string), taker, takerProof: { nonce, issuedAt (ms), signature } }`.
- A quoted response is `{ data: { rfqId, claimToken, status: "quoted", quote: { sellAmount, buyAmount, feeAmount, takerPays, expiresAt, reactor, spender?, taker, … }, transactions: { approval, swap: { to, data, value, chainId } } } }`.
- A no-quote response is `{ data: { status: "no_quote", reason, retryAfterMs? } }`.
- Errors are `{ error: { code, message, details: { reason } } }`.
- `cancel`, `submit` and status send the claim token as `X-Rfq-Claim`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/fx/rfq.test.ts
import { getAddress, verifyTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { takerControlTypedData, TextileRfqClient } from "./rfq";

const TAKER: Address = "0x1111111111111111111111111111111111111111";
const REACTOR = getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3");
const PROOF = { nonce: `0x${"ab".repeat(32)}` as Hex, issuedAt: 1_760_000_000_000, signature: "0x1234" as Hex };
const WARS_1600 = 1_600n * 10n ** 18n;

function fakeFetch(status: number, body: unknown) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}
const client = (fetchMock: ReturnType<typeof fakeFetch>) =>
  new TextileRfqClient({ baseUrl: "https://api.textilecredit.com/", fetch: fetchMock as unknown as typeof fetch });
const request = (c: TextileRfqClient) =>
  c.request({ sellToken: TOKENS.WARS.address, buyToken: TOKENS.USDT.address, sellAmount: WARS_1600, taker: TAKER, takerProof: PROOF });

const QUOTED = {
  data: {
    rfqId: "rfq_1",
    claimToken: "claim_1",
    status: "quoted",
    quote: {
      sellAmount: "1599840000000000000000",
      buyAmount: "995000",
      feeAmount: "160000000000000000",
      takerPays: "1600000000000000000000",
      rateRay: "621875000000000000000",
      expiresAt: "2026-10-15T12:01:00.000Z",
      orderDeadline: "2026-10-15T12:01:30.000Z",
      reactor: REACTOR,
      taker: TAKER,
      encodedOrder: "0x00",
      signature: "0x00",
    },
    transactions: {
      approval: { to: TOKENS.WARS.address, data: "0x095ea7b3", value: "0", chainId: 42220 },
      swap: { to: REACTOR, data: "0xabcdef", value: "0", chainId: 42220 },
    },
  },
};

describe("TextileRfqClient.request", () => {
  it("asks for a firm quote with the taker proof and reads it", async () => {
    const fetchMock = fakeFetch(200, QUOTED);
    const outcome = await request(client(fetchMock));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.textilecredit.com/v2/rfq/request");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      chainId: 42220,
      sellToken: TOKENS.WARS.address,
      buyToken: TOKENS.USDT.address,
      sellAmount: "1600000000000000000000",
      taker: TAKER,
      takerProof: PROOF,
    });
    expect(outcome).toEqual({
      status: "quoted",
      quote: {
        rfqId: "rfq_1",
        claimToken: "claim_1",
        sellAmount: 1_599_840_000_000_000_000_000n,
        buyAmount: 995_000n,
        feeAmount: 160_000_000_000_000_000n,
        takerPays: WARS_1600,
        expiresAt: new Date("2026-10-15T12:01:00.000Z"),
        spender: REACTOR,
        taker: TAKER,
        swap: { to: REACTOR, data: "0xabcdef", value: 0n, chainId: 42220 },
      },
    });
  });

  it("uses the quote's spender when it names one", async () => {
    const other = "0x2222222222222222222222222222222222222222";
    const body = { data: { ...QUOTED.data, quote: { ...QUOTED.data.quote, spender: other } } };
    const outcome = await request(client(fakeFetch(200, body)));
    expect(outcome.status === "quoted" && outcome.quote.spender).toBe(other);
  });

  it("reads a no-quote with or without a retry hint", async () => {
    expect(
      await request(client(fakeFetch(200, { data: { rfqId: "rfq_2", status: "no_quote", reason: "no_makers_online", retryAfterMs: 30_000 } }))),
    ).toEqual({ status: "no_quote", reason: "no_makers_online", retryAfterMs: 30_000 });
    expect(await request(client(fakeFetch(200, { data: { status: "no_quote" } })))).toEqual({
      status: "no_quote",
      reason: "no_valid_quote",
      retryAfterMs: null,
    });
  });

  it("turns an error envelope into a TextileError with the stable reason", async () => {
    const body = { error: { code: "unauthorized", message: "proof is stale", details: { reason: "proof_of_control_stale" } } };
    await expect(request(client(fakeFetch(401, body)))).rejects.toMatchObject({
      name: "TextileError",
      status: 401,
      reason: "proof_of_control_stale",
    });
  });

  it("reports an unreachable venue and an unreadable answer", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(request(new TextileRfqClient({ baseUrl: "https://x.test", fetch: down as unknown as typeof fetch }))).rejects.toMatchObject({
      status: 0,
      reason: "network",
    });
    await expect(request(client(fakeFetch(200, { data: { status: "quoted" } })))).rejects.toMatchObject({ reason: "malformed_response" });
  });
});

describe("cancel and submit", () => {
  it("prove ownership with the claim token", async () => {
    const fetchMock = fakeFetch(200, { data: { rfqId: "rfq_1", status: "submitted" } });
    const c = client(fetchMock);
    await c.cancel("rfq_1", "claim_1");
    await c.submit("rfq_1", "claim_1", `0x${"12".repeat(32)}`);
    const [cancelUrl, cancelInit] = fetchMock.mock.calls[0];
    expect(cancelUrl).toBe("https://api.textilecredit.com/v2/rfq/rfq_1/cancel");
    expect((cancelInit?.headers as Record<string, string>)["X-Rfq-Claim"]).toBe("claim_1");
    const [submitUrl, submitInit] = fetchMock.mock.calls[1];
    expect(submitUrl).toBe("https://api.textilecredit.com/v2/rfq/rfq_1/submit");
    expect(JSON.parse(submitInit?.body as string)).toEqual({ txHash: `0x${"12".repeat(32)}` });
  });
});

describe("takerControlTypedData", () => {
  it("is what the taker wallet signs (EIP-712 TakerControl on chain 42220)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const data = takerControlTypedData(account.address, PROOF.nonce, PROOF.issuedAt);
    expect(data.domain).toEqual({ name: "Textile Taker Control", version: "1", chainId: 42220 });
    const signature = await account.signTypedData(data);
    expect(await verifyTypedData({ ...data, address: account.address, signature })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/fx/rfq.test.ts`
Expected: FAIL with "Failed to resolve import "./rfq"".

- [ ] **Step 3: Implement**

```ts
// src/lib/fx/rfq.ts
import { getAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";

export const CELO_CHAIN_ID = 42220;
/** Textile blocks up to ~70 s on a cold corridor; "set a client timeout above that (75s)". */
export const RFQ_TIMEOUT_MS = 75_000;

/**
 * Spec §8.3: the EIP-712 proof that we control `taker`. Textile accepts it only while issuedAt is
 * within 60 s of its clock, so the executor signs a fresh one for every request.
 */
export function takerControlTypedData(taker: Address, nonce: Hex, issuedAt: number) {
  return {
    domain: { name: "Textile Taker Control", version: "1", chainId: CELO_CHAIN_ID },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker, chainId: BigInt(CELO_CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  } as const;
}

export interface TakerProof {
  nonce: Hex;
  issuedAt: number;
  signature: Hex;
}

export interface FirmQuote {
  rfqId: string;
  /** Returned once; the only credential for cancel and submit without a partner key. */
  claimToken: string;
  sellAmount: bigint;
  buyAmount: bigint;
  feeAmount: bigint;
  /** What leaves the taker's wallet, fee included. Approve at least this. */
  takerPays: bigint;
  expiresAt: Date;
  /** The contract to approve and call; the reactor unless the venue routed through a vault executor. */
  spender: Address;
  taker: Address;
  swap: { to: Address; data: Hex; value: bigint; chainId: number };
}

export type RfqOutcome =
  | { status: "quoted"; quote: FirmQuote }
  | { status: "no_quote"; reason: string; retryAfterMs: number | null };

export class TextileError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "TextileError";
  }
}

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => getAddress(value));
const hexData = z
  .string()
  .refine((value) => isHex(value), "not hex")
  .transform((value) => value as Hex);
const units = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => BigInt(value));
const instant = z
  .string()
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), "not a date");

const quotedSchema = z.object({
  data: z.object({
    rfqId: z.string().min(1),
    claimToken: z.string().min(1),
    status: z.literal("quoted"),
    quote: z.object({
      sellAmount: units,
      buyAmount: units,
      feeAmount: units,
      takerPays: units,
      expiresAt: instant,
      reactor: address,
      spender: address.optional(),
      taker: address,
    }),
    transactions: z.object({
      swap: z.object({ to: address, data: hexData, value: units, chainId: z.number().int() }),
    }),
  }),
});

const noQuoteSchema = z.object({
  data: z.object({
    status: z.literal("no_quote"),
    reason: z.string().optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    details: z.object({ reason: z.string().optional() }).optional(),
  }),
});

/** Textile RFQ v2, called keyless with a taker proof (spec §8.3). */
export class TextileRfqClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
  }

  async request(input: {
    sellToken: Address;
    buyToken: Address;
    sellAmount: bigint;
    taker: Address;
    takerProof: TakerProof;
  }): Promise<RfqOutcome> {
    const json = await this.call("POST", "/v2/rfq/request", {
      chainId: CELO_CHAIN_ID,
      sellToken: input.sellToken,
      buyToken: input.buyToken,
      sellAmount: input.sellAmount.toString(),
      taker: input.taker,
      takerProof: input.takerProof,
    });
    const quoted = quotedSchema.safeParse(json);
    if (quoted.success) {
      const { rfqId, claimToken, quote, transactions } = quoted.data.data;
      return {
        status: "quoted",
        quote: {
          rfqId,
          claimToken,
          sellAmount: quote.sellAmount,
          buyAmount: quote.buyAmount,
          feeAmount: quote.feeAmount,
          takerPays: quote.takerPays,
          expiresAt: quote.expiresAt,
          spender: quote.spender ?? quote.reactor,
          taker: quote.taker,
          swap: transactions.swap,
        },
      };
    }
    const noQuote = noQuoteSchema.safeParse(json);
    if (noQuote.success) {
      return {
        status: "no_quote",
        reason: noQuote.data.data.reason ?? "no_valid_quote",
        retryAfterMs: noQuote.data.data.retryAfterMs ?? null,
      };
    }
    throw new TextileError(200, "malformed_response", "Textile returned an RFQ outcome we cannot read");
  }

  async cancel(rfqId: string, claimToken: string): Promise<void> {
    await this.call("POST", `/v2/rfq/${encodeURIComponent(rfqId)}/cancel`, undefined, claimToken);
  }

  async submit(rfqId: string, claimToken: string, txHash: Hex): Promise<void> {
    await this.call("POST", `/v2/rfq/${encodeURIComponent(rfqId)}/submit`, { txHash }, claimToken);
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown, claimToken?: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (claimToken) headers["X-Rfq-Claim"] = claimToken;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? RFQ_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TextileError(0, "network", `Textile ${path} unreachable: ${error instanceof Error ? error.message : error}`);
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      const error = parsed.success ? parsed.data.error : undefined;
      throw new TextileError(
        response.status,
        error?.details?.reason ?? error?.code,
        `Textile ${method} ${path} failed with ${response.status}: ${error?.message ?? "no message"}`,
      );
    }
    return json;
  }
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/fx/rfq.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/rfq.ts src/lib/fx/rfq.test.ts
git commit -m "feat(fx): Textile RFQ v2 client with taker proof

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: TreasurySigner, policy guard and CIP-64 signing

**Files:**
- Create: `src/lib/signer/treasury-signer.ts`, `src/lib/signer/treasury-signer.test.ts`, `src/lib/chain/treasury-tx.ts`, `src/lib/chain/treasury-tx.test.ts`

**Interfaces:**
- Consumes:
  - `ParaRestClient.signRaw(walletId, data: Hex): Promise<Hex>` and `ParaRestClient.signTypedData(walletId, ParaTypedData): Promise<Hex>`.
  - `rawSignatureToParts` and `toJsonSafe` from `src/lib/signer/signature.ts`.
  - `tagCalldata`, `TOKENS`, `createCeloPublicClient`.
  - `takerControlTypedData` (Task 5, in tests).
- Produces:
  - `interface DigestSignature { r: Hex; s: Hex; yParity: 0 | 1 }`.
  - `interface TreasurySigner { address: Address; signDigest(digest: Hex): Promise<DigestSignature>; signTypedData(data: TypedDataDefinition): Promise<Hex> }`.
  - `paraTreasurySigner(client: Pick<ParaRestClient, "signRaw" | "signTypedData">, wallet: { id: string; address: Address }): TreasurySigner` and `localKeyTreasurySigner(privateKey: Hex): TreasurySigner`.
  - `TEXTILE_REACTOR: Address`, `GAS_TOKENS = ["USDT", "USAT", "USDC"]`, `type GasToken`, `GAS_FLOOR_ATOMIC = 20_000n`, `GAS_RESERVE_ATOMIC = 50_000n`.
  - `pickGasToken(balances: Record<GasToken, bigint>, spend?: { asset: string; amount: bigint }): GasToken | null`.
  - `class TreasuryPolicyError`.
  - `type TreasuryCall = { kind: "approve"; asset: PayAsset; spender: Address; amount: bigint } | { kind: "swap"; to: Address; data: Hex; value: bigint; chainId: number } | { kind: "withdraw"; asset: PayAsset; to: Address; amount: bigint }`.
  - `interface TreasuryPolicy { allowedSpenders: readonly Address[]; personalWallet: Address | null }`.
  - `encodeTreasuryCall(call, policy): { to: Address; data: Hex }`.
  - `type TreasuryTxClient = Pick<ReturnType<typeof createCeloPublicClient>, "getTransactionCount" | "estimateGas" | "request">`.
  - `interface SignedTreasuryTx { hash: Hex; raw: Hex; nonce: number; feeToken: GasToken }`.
  - `signTreasuryTx(deps: { client: TreasuryTxClient; signer: TreasurySigner; attributionCode: string }, call: { to: Address; data: Hex }, feeToken: GasToken): Promise<SignedTreasuryTx>`.

- [ ] **Step 1: Write the failing signer test**

```ts
// src/lib/signer/treasury-signer.test.ts
import { keccak256, recoverAddress, toHex, verifyTypedData, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { takerControlTypedData } from "@/lib/fx/rfq";
import { localKeyTreasurySigner, paraTreasurySigner } from "./treasury-signer";

const DIGEST = keccak256(toHex("cobro"));
const TAKER: Address = "0x1111111111111111111111111111111111111111";
const NONCE = `0x${"ab".repeat(32)}` as Hex;

describe("paraTreasurySigner", () => {
  it("signs a digest through sign-raw and returns r, s and yParity", async () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const { r, s, yParity } = await sign({ hash: DIGEST, privateKey: key });
    // Para answers r||s||v without 0x, with v as 27 or 28.
    const raw = `${r.slice(2)}${s.slice(2)}${((yParity ?? 0) + 27).toString(16)}` as Hex;
    const client = { signRaw: vi.fn(async () => raw), signTypedData: vi.fn() };
    const signer = paraTreasurySigner(client, { id: "w1", address: account.address });
    const parts = await signer.signDigest(DIGEST);
    expect(client.signRaw).toHaveBeenCalledWith("w1", DIGEST);
    expect(await recoverAddress({ hash: DIGEST, signature: parts })).toBe(account.address);
  });

  it("sends typed data JSON-safe and without the EIP712Domain type", async () => {
    const client = { signRaw: vi.fn(), signTypedData: vi.fn(async () => "0x1234" as Hex) };
    const signer = paraTreasurySigner(client, { id: "w1", address: TAKER });
    const data = takerControlTypedData(TAKER, NONCE, 1_760_000_000_000);
    const withDomainType = { ...data, types: { ...data.types, EIP712Domain: [{ name: "name", type: "string" }] } };
    expect(await signer.signTypedData(withDomainType as unknown as TypedDataDefinition)).toBe("0x1234");
    expect(client.signTypedData).toHaveBeenCalledWith("w1", {
      domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
      types: { TakerControl: data.types.TakerControl },
      primaryType: "TakerControl",
      message: { taker: TAKER, chainId: "42220", nonce: NONCE, issuedAt: "1760000000000" },
    });
  });
});

describe("localKeyTreasurySigner", () => {
  it("signs digests and typed data with a local key", async () => {
    const signer = localKeyTreasurySigner(generatePrivateKey());
    expect(await recoverAddress({ hash: DIGEST, signature: await signer.signDigest(DIGEST) })).toBe(signer.address);
    const data = takerControlTypedData(signer.address, NONCE, 1_760_000_000_000);
    const signature = await signer.signTypedData(data);
    expect(await verifyTypedData({ ...data, address: signer.address, signature })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/signer/treasury-signer.test.ts`
Expected: FAIL with "Failed to resolve import "./treasury-signer"".

- [ ] **Step 3: Implement the signer**

```ts
// src/lib/signer/treasury-signer.ts
import type { Address, Hex, TypedDataDefinition } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import type { ParaRestClient, ParaTypedData } from "./para-rest";
import { rawSignatureToParts, toJsonSafe } from "./signature";

export interface DigestSignature {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
}

/**
 * Spec §7.2: the only way the app signs for a treasury wallet. Transactions are CIP-64 (gas in a
 * stablecoin), which Para's sign-transaction does not accept, so they are signed as a digest
 * (sign-raw, spike check 5). Textile's taker proof is EIP-712.
 */
export interface TreasurySigner {
  readonly address: Address;
  signDigest(digest: Hex): Promise<DigestSignature>;
  signTypedData(data: TypedDataDefinition): Promise<Hex>;
}

export function paraTreasurySigner(
  client: Pick<ParaRestClient, "signRaw" | "signTypedData">,
  wallet: { id: string; address: Address },
): TreasurySigner {
  return {
    address: wallet.address,
    async signDigest(digest) {
      return rawSignatureToParts(await client.signRaw(wallet.id, digest));
    },
    async signTypedData(data) {
      const { domain, types, primaryType, message } = data as unknown as ParaTypedData & {
        types: Record<string, readonly { name: string; type: string }[]>;
      };
      // Para derives the domain type itself and rejects an explicit EIP712Domain entry.
      const ownTypes = Object.fromEntries(Object.entries(types).filter(([name]) => name !== "EIP712Domain"));
      return client.signTypedData(
        wallet.id,
        toJsonSafe({ domain: domain ?? {}, types: ownTypes, primaryType, message }) as ParaTypedData,
      );
    },
  };
}

/** The same interface over a local key, for tests and one-off scripts. */
export function localKeyTreasurySigner(privateKey: Hex): TreasurySigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async signDigest(digest) {
      const { r, s, yParity } = await sign({ hash: digest, privateKey });
      return { r, s, yParity: yParity === 1 ? 1 : 0 };
    },
    signTypedData: (data) => account.signTypedData(data),
  };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/signer/treasury-signer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing transaction test**

```ts
// src/lib/chain/treasury-tx.test.ts
import { custom, decodeFunctionData, erc20Abi, fromRlp, keccak256, recoverAddress, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { parseTransaction, serializeTransaction } from "viem/celo";
import { describe, expect, it } from "vitest";
import { localKeyTreasurySigner } from "@/lib/signer/treasury-signer";
import { attributionSuffix } from "./attribution";
import { createCeloPublicClient } from "./clients";
import { TOKENS } from "./tokens";
import {
  encodeTreasuryCall,
  GAS_FLOOR_ATOMIC,
  pickGasToken,
  signTreasuryTx,
  TEXTILE_REACTOR,
  TreasuryPolicyError,
} from "./treasury-tx";

const CODE = "celo_bc3965e128ba";
const PERSONAL: Address = "0x3333333333333333333333333333333333333333";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const POLICY = { allowedSpenders: [TEXTILE_REACTOR], personalWallet: PERSONAL };

describe("pickGasToken", () => {
  const none = { USDT: 0n, USAT: 0n, USDC: 0n };
  it("prefers USD₮, then USA₮, then USDC, needing at least the floor", () => {
    expect(pickGasToken({ ...none, USDT: GAS_FLOOR_ATOMIC, USDC: 1_000_000n })).toBe("USDT");
    expect(pickGasToken({ ...none, USDT: GAS_FLOOR_ATOMIC - 1n, USAT: 30_000n })).toBe("USAT");
    expect(pickGasToken({ ...none, USDC: 50_000n })).toBe("USDC");
    expect(pickGasToken(none)).toBeNull();
  });

  it("leaves out a token the same transaction spends below the floor", () => {
    expect(pickGasToken({ ...none, USDT: 1_000_000n, USAT: 30_000n }, { asset: "USDT", amount: 990_000n })).toBe("USAT");
    expect(pickGasToken({ ...none, USDT: 1_000_000n }, { asset: "WARS", amount: 10n ** 30n })).toBe("USDT");
  });
});

describe("encodeTreasuryCall", () => {
  it("approves only an allowed spender", () => {
    const call = encodeTreasuryCall({ kind: "approve", asset: "WARS", spender: TEXTILE_REACTOR, amount: 5n }, POLICY);
    expect(call.to).toBe(TOKENS.WARS.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "approve", args: [TEXTILE_REACTOR, 5n] });
    expect(() => encodeTreasuryCall({ kind: "approve", asset: "WARS", spender: STRANGER, amount: 5n }, POLICY)).toThrow(TreasuryPolicyError);
  });

  it("swaps only on an allowed spender, with no value, on Celo", () => {
    const swap = { kind: "swap", to: TEXTILE_REACTOR, data: "0xabcdef", value: 0n, chainId: 42220 } as const;
    expect(encodeTreasuryCall(swap, POLICY)).toEqual({ to: TEXTILE_REACTOR, data: "0xabcdef" });
    expect(() => encodeTreasuryCall({ ...swap, to: STRANGER }, POLICY)).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ ...swap, value: 1n }, POLICY)).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ ...swap, chainId: 1 }, POLICY)).toThrow(TreasuryPolicyError);
  });

  it("sends withdrawals only to the freelancer's personal wallet", () => {
    const call = encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: PERSONAL, amount: 7n }, POLICY);
    expect(call.to).toBe(TOKENS.USDT.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "transfer", args: [PERSONAL, 7n] });
    expect(() => encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: STRANGER, amount: 7n }, POLICY)).toThrow(TreasuryPolicyError);
    expect(() =>
      encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: PERSONAL, amount: 7n }, { ...POLICY, personalWallet: null }),
    ).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: PERSONAL, amount: 0n }, POLICY)).toThrow(TreasuryPolicyError);
  });
});

/** A node that answers just what signTreasuryTx asks, and records the calls. */
function fakeChain() {
  const calls: { method: string; params: unknown }[] = [];
  const transport = custom({
    async request({ method, params }) {
      calls.push({ method, params });
      switch (method) {
        case "eth_chainId":
          return "0xa4ec";
        case "eth_getTransactionCount":
          return "0x5";
        case "eth_estimateGas":
          return "0x186a0";
        case "eth_gasPrice":
          return "0x4a817c800";
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        default:
          throw new Error(`unexpected RPC ${method}`);
      }
    },
  });
  return { client: createCeloPublicClient("http://unused", transport), calls };
}

describe("signTreasuryTx", () => {
  it("signs a tagged CIP-64 transaction that pays gas in the chosen stablecoin", async () => {
    const { client, calls } = fakeChain();
    const signer = localKeyTreasurySigner(generatePrivateKey());
    const call = encodeTreasuryCall({ kind: "approve", asset: "WARS", spender: TEXTILE_REACTOR, amount: 5n }, POLICY);

    const signed = await signTreasuryTx({ client, signer, attributionCode: CODE }, call, "USDT");

    expect(signed).toMatchObject({ nonce: 5, feeToken: "USDT" });
    expect(signed.hash).toBe(keccak256(signed.raw));
    const tx = parseTransaction(signed.raw) as unknown as {
      type: string;
      to: Address;
      data: Hex;
      nonce: number;
      gas: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      feeCurrency: Address;
    };
    expect(tx).toMatchObject({ type: "cip64", nonce: 5, gas: 120_000n, maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    expect(tx.feeCurrency.toLowerCase()).toBe(TOKENS.USDT.feeCurrency!.toLowerCase());
    expect(tx.to.toLowerCase()).toBe(TOKENS.WARS.address.toLowerCase());
    expect(tx.data.toLowerCase()).toBe(`${call.data}${attributionSuffix(CODE).slice(2)}`.toLowerCase());

    // The signature inside the raw bytes recovers to the treasury wallet.
    const [yParity, r, s] = (fromRlp(`0x${signed.raw.slice(4)}`, "hex") as Hex[]).slice(-3);
    const unsigned = { ...(parseTransaction(signed.raw) as object), type: "cip64" } as Parameters<typeof serializeTransaction>[0];
    const recovered = await recoverAddress({
      hash: keccak256(serializeTransaction(unsigned)),
      signature: { r, s, yParity: yParity === "0x" ? 0 : 1 },
    });
    expect(recovered).toBe(signer.address);

    // Gas was estimated and priced in the fee currency.
    const estimate = calls.find((c) => c.method === "eth_estimateGas")!.params as [{ feeCurrency: string }];
    expect(estimate[0].feeCurrency.toLowerCase()).toBe(TOKENS.USDT.feeCurrency!.toLowerCase());
    expect(calls.find((c) => c.method === "eth_gasPrice")!.params).toEqual([TOKENS.USDT.feeCurrency]);
  });
});
```

- [ ] **Step 6: Run to see it fail**

Run: `npx vitest run src/lib/chain/treasury-tx.test.ts`
Expected: FAIL with "Failed to resolve import "./treasury-tx"".

- [ ] **Step 7: Implement**

```ts
// src/lib/chain/treasury-tx.ts
import { encodeFunctionData, erc20Abi, getAddress, isAddressEqual, keccak256, type Address, type Hex } from "viem";
import { serializeTransaction } from "viem/celo";
import type { PayAsset } from "@/lib/money/currencies";
import type { TreasurySigner } from "@/lib/signer/treasury-signer";
import { tagCalldata } from "./attribution";
import type { createCeloPublicClient } from "./clients";
import { TOKENS } from "./tokens";

/** Textile LimitOrderReactor on Celo (spec §8.3): the only contract a treasury may approve or call. */
export const TEXTILE_REACTOR: Address = getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3");

/** Treasury gas is paid in a dollar stablecoin through CIP-64, in this order of preference. */
export const GAS_TOKENS = ["USDT", "USAT", "USDC"] as const;
export type GasToken = (typeof GAS_TOKENS)[number];
/** A Celo transaction costs well under $0.01; a token qualifies for gas from 0.02 (6 decimals). */
export const GAS_FLOOR_ATOMIC = 20_000n;
/** Kept back from swaps in the gas token, so the next transactions can still pay for themselves. */
export const GAS_RESERVE_ATOMIC = 50_000n;

export function pickGasToken(
  balances: Record<GasToken, bigint>,
  spend?: { asset: string; amount: bigint },
): GasToken | null {
  return (
    GAS_TOKENS.find((token) => balances[token] - (spend?.asset === token ? spend.amount : 0n) >= GAS_FLOOR_ATOMIC) ?? null
  );
}

export class TreasuryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryPolicyError";
  }
}

export type TreasuryCall =
  | { kind: "approve"; asset: PayAsset; spender: Address; amount: bigint }
  | { kind: "swap"; to: Address; data: Hex; value: bigint; chainId: number }
  | { kind: "withdraw"; asset: PayAsset; to: Address; amount: bigint };

export interface TreasuryPolicy {
  allowedSpenders: readonly Address[];
  personalWallet: Address | null;
}

const isAllowed = (policy: TreasuryPolicy, address: Address) =>
  policy.allowedSpenders.some((spender) => isAddressEqual(spender, address));

/**
 * Spec §6.1 and §12: what a treasury wallet may sign. Para Guardrails were not enforced in the spike
 * (check 4), so this guard is the enforcement; every treasury transaction is encoded here.
 */
export function encodeTreasuryCall(call: TreasuryCall, policy: TreasuryPolicy): { to: Address; data: Hex } {
  switch (call.kind) {
    case "approve":
      if (!isAllowed(policy, call.spender)) throw new TreasuryPolicyError(`approve(${call.spender}) is not allowed`);
      return {
        to: TOKENS[call.asset].address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [call.spender, call.amount] }),
      };
    case "swap":
      if (!isAllowed(policy, call.to)) throw new TreasuryPolicyError(`swap on ${call.to} is not allowed`);
      if (call.value !== 0n || call.chainId !== 42220) {
        throw new TreasuryPolicyError("a swap must carry no value and settle on Celo");
      }
      return { to: getAddress(call.to), data: call.data };
    case "withdraw":
      if (!policy.personalWallet || !isAddressEqual(call.to, policy.personalWallet)) {
        throw new TreasuryPolicyError("withdrawals go only to the freelancer's personal wallet");
      }
      if (call.amount <= 0n) throw new TreasuryPolicyError("a withdrawal must move a positive amount");
      return {
        to: TOKENS[call.asset].address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [policy.personalWallet, call.amount] }),
      };
  }
}

export type TreasuryTxClient = Pick<ReturnType<typeof createCeloPublicClient>, "getTransactionCount" | "estimateGas" | "request">;

export interface SignedTreasuryTx {
  hash: Hex;
  raw: Hex;
  nonce: number;
  feeToken: GasToken;
}

/**
 * Builds a CIP-64 transaction that pays gas in `feeToken`, appends our attribution tag (spec §8.5)
 * and signs its digest with the TreasurySigner. Nothing is broadcast here: the caller stores the raw
 * bytes first, so an unknown outcome can be settled or re-sent verbatim (spec §10.4 step 7).
 */
export async function signTreasuryTx(
  deps: { client: TreasuryTxClient; signer: TreasurySigner; attributionCode: string },
  call: { to: Address; data: Hex },
  feeToken: GasToken,
): Promise<SignedTreasuryTx> {
  const feeCurrency = TOKENS[feeToken].feeCurrency;
  if (!feeCurrency) throw new Error(`${feeToken} has no fee currency adapter`);
  const data = tagCalldata(call.data, deps.attributionCode);
  const from = deps.signer.address;
  // Gas prices quoted in the fee currency (what viem/celo's fee estimator calls).
  const rpc = deps.client.request as unknown as (args: { method: string; params: unknown[] }) => Promise<Hex>;
  const [nonce, gas, gasPrice, tip] = await Promise.all([
    deps.client.getTransactionCount({ address: from, blockTag: "pending" }),
    deps.client.estimateGas({ account: from, to: call.to, data, value: 0n, feeCurrency }),
    rpc({ method: "eth_gasPrice", params: [feeCurrency] }).then(BigInt),
    rpc({ method: "eth_maxPriorityFeePerGas", params: [feeCurrency] }).then(BigInt),
  ]);
  const tx = {
    type: "cip64" as const,
    chainId: 42220,
    nonce,
    to: call.to,
    data,
    value: 0n,
    gas: (gas * 12n) / 10n,
    maxFeePerGas: gasPrice * 2n,
    maxPriorityFeePerGas: tip,
    feeCurrency,
  };
  const signature = await deps.signer.signDigest(keccak256(serializeTransaction(tx)));
  const raw = serializeTransaction(tx, signature);
  return { hash: keccak256(raw), raw, nonce, feeToken };
}
```

- [ ] **Step 8: Run to see it pass**

Run: `npx vitest run src/lib/chain/treasury-tx.test.ts src/lib/signer/treasury-signer.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/lib/signer/treasury-signer.ts src/lib/signer/treasury-signer.test.ts src/lib/chain/treasury-tx.ts src/lib/chain/treasury-tx.test.ts
git commit -m "feat(chain): TreasurySigner, treasury call policy and tagged CIP-64 signing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Balances and the gas drip

**Files:**
- Create: `src/lib/treasury/balances.ts`, `src/lib/treasury/balances.test.ts`, `src/lib/treasury/gas.ts`, `src/lib/treasury/gas.test.ts`

**Interfaces:**
- Consumes:
  - `TOKENS`, `createCeloPublicClient`, `createOperatorClient`, `operatorSendParams`, `FeeToken`.
  - Task 4 `Balances`.
  - Task 6 `GasToken`, `GAS_RESERVE_ATOMIC`.
  - `treasuryWallets.gasDrippedAt`.
- Produces:
  - `TREASURY_TOKENS = ["USDT", "USAT", "USDC", "WARS", "WBRL"]`, `type TreasuryToken` and `type TreasuryBalances = Record<TreasuryToken, bigint>`.
  - `type ReadBalance = (token: Address, owner: Address) => Promise<bigint>` and `erc20Balance(client): ReadBalance`.
  - `readTreasuryBalances(read: ReadBalance, owner: Address): Promise<TreasuryBalances>`.
  - `spendableBalances(balances: TreasuryBalances, gasToken: GasToken | null): Balances`.
  - `DRIP_AMOUNT_ATOMIC = 50_000n` (0.05 USDC), `DRIP_COOLDOWN_MS = 86_400_000`.
  - `type Dripper = (to: Address, amount: bigint) => Promise<Hex>`.
  - `operatorDripper(opts: { privateKey: Hex; attributionCode: string; rpcUrl: string; feeToken: FeeToken }): Dripper`.
  - `claimDrip(db, walletId: string, now: Date): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/treasury/balances.test.ts
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { readTreasuryBalances, spendableBalances, type ReadBalance, type TreasuryBalances } from "./balances";

const OWNER: Address = "0x1111111111111111111111111111111111111111";
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };

describe("readTreasuryBalances", () => {
  it("reads every treasury token for the owner", async () => {
    const read = vi.fn<ReadBalance>(async (token) => (token === TOKENS.USDT.address ? 7n : token === TOKENS.WARS.address ? 9n : 0n));
    expect(await readTreasuryBalances(read, OWNER)).toEqual({ ...ZERO, USDT: 7n, WARS: 9n });
    expect(read).toHaveBeenCalledTimes(5);
    expect(read.mock.calls.every(([, owner]) => owner === OWNER)).toBe(true);
  });
});

describe("spendableBalances", () => {
  it("keeps the gas reserve out of the dollar token that pays for gas", () => {
    expect(spendableBalances({ ...ZERO, USDT: 1_000_000n, WARS: 5n }, "USDT")).toEqual({ USDT: 950_000n, USAT: 0n, WARS: 5n, WBRL: 0n });
    expect(spendableBalances({ ...ZERO, USDT: 30_000n }, "USDT").USDT).toBe(0n);
    expect(spendableBalances({ ...ZERO, USDT: 1_000_000n, USDC: 60_000n }, "USDC").USDT).toBe(1_000_000n);
  });
});
```

```ts
// src/lib/treasury/gas.test.ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import { claimDrip } from "./gas";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("claimDrip", () => {
  it("allows one drip per wallet per 24 hours", async () => {
    const user = await seedFreelancer(db);
    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    expect(await claimDrip(db, wallet.id, NOW)).toBe(true);
    expect(await claimDrip(db, wallet.id, hours(1))).toBe(false);
    expect(await claimDrip(db, wallet.id, hours(25))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/treasury/balances.test.ts src/lib/treasury/gas.test.ts`
Expected: FAIL with "Failed to resolve import "./balances"" and "Failed to resolve import "./gas"".

- [ ] **Step 3: Implement**

```ts
// src/lib/treasury/balances.ts
import { erc20Abi, type Address } from "viem";
import type { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS, type TokenSymbol } from "@/lib/chain/tokens";
import { GAS_RESERVE_ATOMIC, type GasToken } from "@/lib/chain/treasury-tx";
import type { Balances } from "./engine";

/** The four pay assets, plus USDC, which a treasury holds only as gas money (operator drips). */
export const TREASURY_TOKENS = ["USDT", "USAT", "USDC", "WARS", "WBRL"] as const satisfies readonly TokenSymbol[];
export type TreasuryToken = (typeof TREASURY_TOKENS)[number];
export type TreasuryBalances = Record<TreasuryToken, bigint>;

export type ReadBalance = (token: Address, owner: Address) => Promise<bigint>;

export function erc20Balance(client: Pick<ReturnType<typeof createCeloPublicClient>, "readContract">): ReadBalance {
  return (token, owner) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export async function readTreasuryBalances(read: ReadBalance, owner: Address): Promise<TreasuryBalances> {
  const values = await Promise.all(TREASURY_TOKENS.map((symbol) => read(TOKENS[symbol].address, owner)));
  return Object.fromEntries(TREASURY_TOKENS.map((symbol, i) => [symbol, values[i]])) as TreasuryBalances;
}

/** Engine input: the pay assets, with the gas reserve held back in the dollar token that pays for gas. */
export function spendableBalances(balances: TreasuryBalances, gasToken: GasToken | null): Balances {
  const spendable: Balances = { USDT: balances.USDT, USAT: balances.USAT, WARS: balances.WARS, WBRL: balances.WBRL };
  if (gasToken === "USDT" || gasToken === "USAT") {
    const left = spendable[gasToken] - GAS_RESERVE_ATOMIC;
    spendable[gasToken] = left > 0n ? left : 0n;
  }
  return spendable;
}
```

```ts
// src/lib/treasury/gas.ts
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { erc20Abi, type Address, type Hex } from "viem";
import { createCeloPublicClient, createOperatorClient, operatorSendParams } from "@/lib/chain/clients";
import { TOKENS, type FeeToken } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { treasuryWallets } from "@/lib/db/schema";

/** 0.05 USDC: gas for a dozen or more treasury transactions. */
export const DRIP_AMOUNT_ATOMIC = 50_000n;
export const DRIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type Dripper = (to: Address, amount: bigint) => Promise<Hex>;

/** Operator → treasury USDC transfer, tagged, gas in the operator's fee token. Resolves after a successful receipt. */
export function operatorDripper(opts: { privateKey: Hex; attributionCode: string; rpcUrl: string; feeToken: FeeToken }): Dripper {
  const operator = createOperatorClient(opts);
  const publicClient = createCeloPublicClient(opts.rpcUrl);
  return async (to, amount) => {
    const hash = await operator.writeContract({
      address: TOKENS.USDC.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
      ...operatorSendParams(opts.feeToken),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`Gas drip ${hash} reverted`);
    return hash;
  };
}

/** Takes this wallet's drip slot: false when it already had a drip in the last 24 hours. */
export async function claimDrip(db: Db, walletId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(treasuryWallets)
    .set({ gasDrippedAt: now })
    .where(
      and(
        eq(treasuryWallets.id, walletId),
        or(isNull(treasuryWallets.gasDrippedAt), lt(treasuryWallets.gasDrippedAt, new Date(now.getTime() - DRIP_COOLDOWN_MS))),
      ),
    )
    .returning({ id: treasuryWallets.id });
  return rows.length === 1;
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/lib/treasury/balances.test.ts src/lib/treasury/gas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/balances.ts src/lib/treasury/balances.test.ts src/lib/treasury/gas.ts src/lib/treasury/gas.test.ts
git commit -m "feat(treasury): balances, spendable amounts and the operator gas drip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Treasury repository (locks, context, intents, trades, events, transactions)

**Files:**
- Create: `src/lib/treasury/repo.ts`, `src/lib/treasury/repo.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 4 `IntentPlan`, `DAY_MS` from `src/lib/invoices/dates.ts`.
- Produces:
  - Locks:
    - `LOCK_TTL_MS = 300_000`.
    - `acquireWalletLock(db, walletId, holder: string, now, ttlMs?): Promise<boolean>` and `releaseWalletLock(db, walletId, holder): Promise<void>`.
  - Context:
    - `interface TreasuryContext { userId; walletId; address: Address; paraWalletId: string; personalWallet: Address | null; rules: RulesRow }`.
    - `loadTreasuryContext(db, userId): Promise<TreasuryContext | null>`. Needs a ready wallet and a rules row.
    - `listTreasuryUsers(db): Promise<string[]>`. Returns users with rules enabled and a ready wallet.
  - Intents:
    - `openIntent(db, userId): Promise<FxIntentRow | null>` and `intentById(db, id): Promise<FxIntentRow | null>`.
    - `saveIntent(db, userId, plan: Extract<IntentPlan, { action: "convert" }>, now): Promise<FxIntentRow>`.
    - `cancelIntent(db, id, now)`.
    - `updateIntent(db, id, fields: { status?; attempts?; lastSlippageBps?; retryAfter? }, now)`.
  - Trades:
    - `insertTrade(db, row: typeof fxTrades.$inferInsert): Promise<FxTradeRow>` and `updateTrade(db, id, fields)`.
    - `tradeBySwapHash(db, hash): Promise<FxTradeRow | null>`.
    - `filledUsdWad24h(db, userId, now): Promise<bigint>`.
  - Events:
    - `logEvent(db, userId, type: AgentEventType, data: Record<string, unknown>, now): Promise<void>`.
    - `listEvents(db, userId, limit = 20): Promise<AgentEventRow[]>`, newest first.
  - Treasury transactions:
    - `recordTreasuryTx(db, row: typeof treasuryTxs.$inferInsert): Promise<void>`.
    - `pendingTreasuryTxs(db, userId): Promise<TreasuryTxRow[]>`, by nonce.
    - `settleTreasuryTx(db, hash, status: "success" | "reverted", now): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/treasury/repo.test.ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { fxIntents, rules, treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { ConvertDecision } from "./engine";
import {
  acquireWalletLock,
  filledUsdWad24h,
  insertTrade,
  listEvents,
  listTreasuryUsers,
  loadTreasuryContext,
  logEvent,
  openIntent,
  pendingTreasuryTxs,
  recordTreasuryTx,
  releaseWalletLock,
  saveIntent,
  settleTreasuryTx,
} from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);
const walletOf = async (userId: string) =>
  (await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, userId)))[0];
const decision = (amount: bigint, to: "USDT" | "USAT" = "USDT"): ConvertDecision => ({
  kind: "convert",
  from: "WARS",
  to,
  amount,
  usdWad: 1n,
  reason: "save_excess",
});

describe("wallet locks", () => {
  it("lets one holder in at a time and takes over an expired lock", async () => {
    const wallet = await walletOf((await seedFreelancer(db)).id);
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    expect(await acquireWalletLock(db, wallet.id, a, NOW)).toBe(true);
    expect(await acquireWalletLock(db, wallet.id, b, minutes(1))).toBe(false);
    expect(await acquireWalletLock(db, wallet.id, b, minutes(6))).toBe(true);
    await releaseWalletLock(db, wallet.id, a); // a no longer holds it: nothing happens
    expect(await acquireWalletLock(db, wallet.id, c, minutes(7))).toBe(false);
    await releaseWalletLock(db, wallet.id, b);
    expect(await acquireWalletLock(db, wallet.id, c, minutes(7))).toBe(true);
  });
});

describe("treasury context", () => {
  it("loads a ready, onboarded user and lists the ones the agent runs for", async () => {
    const user = await seedFreelancer(db);
    const paused = await seedFreelancer(db);
    await db.update(rules).set({ enabled: false }).where(eq(rules.userId, paused.id));
    await seedFreelancer(db, { treasuryAddress: null });

    expect(await loadTreasuryContext(db, user.id)).toMatchObject({
      userId: user.id,
      address: TEST_TREASURY,
      paraWalletId: "para-wallet-1",
      personalWallet: null,
      rules: { localCurrency: "ARS", enabled: true },
    });
    expect(await listTreasuryUsers(db)).toEqual([user.id]);
  });
});

describe("intents", () => {
  it("creates, keeps (with its age) and replaces the open intent", async () => {
    const user = await seedFreelancer(db);
    const first = await saveIntent(db, user.id, { action: "convert", keep: null, cancel: null, decision: decision(10n) }, NOW);
    expect(first).toMatchObject({ status: "waiting", amountAtomic: "10", createdAt: NOW });

    const kept = await saveIntent(db, user.id, { action: "convert", keep: first.id, cancel: null, decision: decision(20n) }, minutes(10));
    expect(kept).toMatchObject({ id: first.id, amountAtomic: "20", createdAt: NOW });

    const replaced = await saveIntent(
      db,
      user.id,
      { action: "convert", keep: null, cancel: first.id, decision: decision(30n, "USAT") },
      minutes(20),
    );
    expect(replaced.id).not.toBe(first.id);
    expect((await db.select().from(fxIntents).where(eq(fxIntents.id, first.id)))[0].status).toBe("cancelled");
    expect((await openIntent(db, user.id))?.id).toBe(replaced.id);
  });
});

describe("filledUsdWad24h", () => {
  it("adds swaps broadcast or filled in the last 24 hours", async () => {
    const user = await seedFreelancer(db);
    const trade = { userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1" } as const;
    await insertTrade(db, { ...trade, status: "broadcast", notionalUsdCents: 150, createdAt: minutes(-60) });
    await insertTrade(db, { ...trade, status: "filled", notionalUsdCents: 250, createdAt: minutes(-120) });
    await insertTrade(db, { ...trade, status: "failed", notionalUsdCents: 999, createdAt: minutes(-60) });
    await insertTrade(db, { ...trade, status: "filled", notionalUsdCents: 1_000, createdAt: minutes(-25 * 60) });
    expect(await filledUsdWad24h(db, user.id, NOW)).toBe(4n * 10n ** 18n);
  });
});

describe("events and treasury transactions", () => {
  it("lists events newest first", async () => {
    const user = await seedFreelancer(db);
    await logEvent(db, user.id, "dry_run", { amount: "1" }, NOW);
    await logEvent(db, user.id, "converted", { amount: "2" }, minutes(5));
    expect((await listEvents(db, user.id)).map((e) => e.type)).toEqual(["converted", "dry_run"]);
  });

  it("keeps transactions pending until settled, in nonce order", async () => {
    const user = await seedFreelancer(db);
    const tx = { userId: user.id, kind: "approve", raw: "0x00", feeToken: "USDT" } as const;
    await recordTreasuryTx(db, { ...tx, nonce: 2, hash: "0xb" });
    await recordTreasuryTx(db, { ...tx, nonce: 1, hash: "0xa" });
    expect((await pendingTreasuryTxs(db, user.id)).map((t) => t.hash)).toEqual(["0xa", "0xb"]);
    await settleTreasuryTx(db, "0xa", "success", NOW);
    expect((await pendingTreasuryTxs(db, user.id)).map((t) => t.hash)).toEqual(["0xb"]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/treasury/repo.test.ts`
Expected: FAIL with "Failed to resolve import "./repo"".

- [ ] **Step 3: Implement**

```ts
// src/lib/treasury/repo.ts
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import {
  agentEvents,
  fxIntents,
  fxTrades,
  rules,
  treasuryTxs,
  treasuryWallets,
  users,
  walletLocks,
  type AgentEventRow,
  type AgentEventType,
  type FxIntentRow,
  type FxTradeRow,
  type RulesRow,
  type TreasuryTxRow,
} from "@/lib/db/schema";
import { DAY_MS } from "@/lib/invoices/dates";
import type { IntentPlan } from "./engine";

/** Longer than one run (RFQ ≤ 75 s, a few receipts); a killed run's lock frees itself after this. */
export const LOCK_TTL_MS = 5 * 60 * 1000;

/** Spec §10.4 step 1: true when `holder` now owns the wallet's lock (it was free or had expired). */
export async function acquireWalletLock(db: Db, walletId: string, holder: string, now: Date, ttlMs = LOCK_TTL_MS): Promise<boolean> {
  const lockedUntil = new Date(now.getTime() + ttlMs);
  const rows = await db
    .insert(walletLocks)
    .values({ walletId, holder, lockedUntil })
    .onConflictDoUpdate({ target: walletLocks.walletId, set: { holder, lockedUntil }, setWhere: lt(walletLocks.lockedUntil, now) })
    .returning({ holder: walletLocks.holder });
  return rows.length === 1 && rows[0].holder === holder;
}

export async function releaseWalletLock(db: Db, walletId: string, holder: string): Promise<void> {
  await db.delete(walletLocks).where(and(eq(walletLocks.walletId, walletId), eq(walletLocks.holder, holder)));
}

export interface TreasuryContext {
  userId: string;
  walletId: string;
  address: Address;
  paraWalletId: string;
  /** The only withdrawal destination (spec §6.1); null until Para reports the user's wallet. */
  personalWallet: Address | null;
  rules: RulesRow;
}

export async function loadTreasuryContext(db: Db, userId: string): Promise<TreasuryContext | null> {
  const [row] = await db
    .select({ wallet: treasuryWallets, rules, personalWallet: users.personalWallet })
    .from(treasuryWallets)
    .innerJoin(users, eq(users.id, treasuryWallets.userId))
    .innerJoin(rules, eq(rules.userId, treasuryWallets.userId))
    .where(and(eq(treasuryWallets.userId, userId), eq(treasuryWallets.status, "ready")));
  if (!row?.wallet.address || !row.wallet.paraWalletId) return null;
  return {
    userId,
    walletId: row.wallet.id,
    address: getAddress(row.wallet.address),
    paraWalletId: row.wallet.paraWalletId,
    personalWallet: row.personalWallet ? getAddress(row.personalWallet) : null,
    rules: row.rules,
  };
}

/** The users a cron run visits: onboarded, agent switched on, wallet ready. */
export async function listTreasuryUsers(db: Db): Promise<string[]> {
  const rows = await db
    .select({ userId: rules.userId })
    .from(rules)
    .innerJoin(treasuryWallets, eq(treasuryWallets.userId, rules.userId))
    .where(and(eq(rules.enabled, true), eq(treasuryWallets.status, "ready")))
    .orderBy(asc(rules.userId));
  return rows.map((row) => row.userId);
}

const OPEN_STATUSES: ("waiting" | "executing")[] = ["waiting", "executing"];

export async function openIntent(db: Db, userId: string): Promise<FxIntentRow | null> {
  const [row] = await db
    .select()
    .from(fxIntents)
    .where(and(eq(fxIntents.userId, userId), inArray(fxIntents.status, OPEN_STATUSES)));
  return row ?? null;
}

export async function intentById(db: Db, id: string): Promise<FxIntentRow | null> {
  const [row] = await db.select().from(fxIntents).where(eq(fxIntents.id, id));
  return row ?? null;
}

export async function cancelIntent(db: Db, id: string, now: Date): Promise<void> {
  await db
    .update(fxIntents)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(fxIntents.id, id), inArray(fxIntents.status, OPEN_STATUSES)));
}

/** Applies a convert plan: cancel the old intent, keep it (new amount, same age) or create a new one. */
export async function saveIntent(
  db: Db,
  userId: string,
  plan: Extract<IntentPlan, { action: "convert" }>,
  now: Date,
): Promise<FxIntentRow> {
  return db.transaction(async (tx) => {
    if (plan.cancel) await cancelIntent(tx, plan.cancel, now);
    const fields = { amountAtomic: plan.decision.amount.toString(), reason: plan.decision.reason, updatedAt: now };
    if (plan.keep) {
      // "executing" left behind by a crashed run goes back to waiting; its age is kept.
      const [kept] = await tx
        .update(fxIntents)
        .set({ ...fields, status: "waiting" })
        .where(and(eq(fxIntents.id, plan.keep), inArray(fxIntents.status, OPEN_STATUSES)))
        .returning();
      if (kept) return kept;
    }
    const [created] = await tx
      .insert(fxIntents)
      .values({ ...fields, userId, fromAsset: plan.decision.from, toAsset: plan.decision.to, createdAt: now })
      .returning();
    return created;
  });
}

export async function updateIntent(
  db: Db,
  id: string,
  fields: Partial<Pick<typeof fxIntents.$inferInsert, "status" | "attempts" | "lastSlippageBps" | "retryAfter">>,
  now: Date,
): Promise<void> {
  await db.update(fxIntents).set({ ...fields, updatedAt: now }).where(eq(fxIntents.id, id));
}

export async function insertTrade(db: Db, row: typeof fxTrades.$inferInsert): Promise<FxTradeRow> {
  const [trade] = await db.insert(fxTrades).values(row).returning();
  return trade;
}

export async function updateTrade(db: Db, id: string, fields: Partial<typeof fxTrades.$inferInsert>): Promise<void> {
  await db.update(fxTrades).set(fields).where(eq(fxTrades.id, id));
}

export async function tradeBySwapHash(db: Db, hash: string): Promise<FxTradeRow | null> {
  const [row] = await db.select().from(fxTrades).where(eq(fxTrades.swapTxHash, hash));
  return row ?? null;
}

/** Notional of swaps broadcast or filled in the rolling 24 hours, as a USD wad (spec §10.1 dailyMaxUsd). */
export async function filledUsdWad24h(db: Db, userId: string, now: Date): Promise<bigint> {
  const [row] = await db
    .select({ cents: sql`coalesce(sum(${fxTrades.notionalUsdCents}), 0)`.mapWith(String) })
    .from(fxTrades)
    .where(
      and(
        eq(fxTrades.userId, userId),
        inArray(fxTrades.status, ["broadcast", "filled"]),
        gt(fxTrades.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  return BigInt(row.cents) * 10n ** 16n;
}

export async function logEvent(
  db: Db,
  userId: string,
  type: AgentEventType,
  data: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await db.insert(agentEvents).values({ userId, type, data, createdAt: now });
}

export async function listEvents(db: Db, userId: string, limit = 20): Promise<AgentEventRow[]> {
  return db.select().from(agentEvents).where(eq(agentEvents.userId, userId)).orderBy(desc(agentEvents.createdAt)).limit(limit);
}

export async function recordTreasuryTx(db: Db, row: typeof treasuryTxs.$inferInsert): Promise<void> {
  await db.insert(treasuryTxs).values(row);
}

export async function pendingTreasuryTxs(db: Db, userId: string): Promise<TreasuryTxRow[]> {
  return db
    .select()
    .from(treasuryTxs)
    .where(and(eq(treasuryTxs.userId, userId), eq(treasuryTxs.status, "pending")))
    .orderBy(asc(treasuryTxs.nonce));
}

export async function settleTreasuryTx(db: Db, hash: string, status: "success" | "reverted", now: Date): Promise<void> {
  await db
    .update(treasuryTxs)
    .set({ status, confirmedAt: now })
    .where(and(eq(treasuryTxs.hash, hash), eq(treasuryTxs.status, "pending")));
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/treasury/repo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/repo.ts src/lib/treasury/repo.test.ts
git commit -m "feat(treasury): repository for locks, intents, trades, events and treasury transactions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

---

### Task 9: Executor

**Files:**
- Create: `src/lib/treasury/executor.ts`, `src/lib/treasury/executor.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `decide`, `planIntent`, `acceptQuote`, `slippageBps`, `ConvertDecision`, `EngineRules`.
  - Task 5: `takerControlTypedData`, `TextileError`, `FirmQuote`, `RfqOutcome`, `TextileRfqClient`.
  - Task 6: `encodeTreasuryCall`, `pickGasToken`, `GasToken`, `SignedTreasuryTx`, `TreasuryPolicy`, `TreasurySigner`.
  - Task 7: `spendableBalances`, `TreasuryBalances`, `claimDrip`, `DRIP_AMOUNT_ATOMIC`, `Dripper`.
  - Task 8: every repo function and `TreasuryContext`.
  - Task 3: `usdWad`, `atomicForUsdWad`, `dollarsToWad`.
- Produces:
  - `interface ExecutorChain { readBalances(owner): Promise<TreasuryBalances>; allowance(token, owner, spender): Promise<bigint>; receipt(hash): Promise<"success" | "reverted" | null>; confirmedNonce(owner): Promise<number>; sendRaw(raw: Hex): Promise<void>; waitForReceipt(hash): Promise<"success" | "reverted" | null> }`.
  - `interface ExecutorDeps { db; now(): Date; flags: { enabled: boolean; dryRun: boolean }; rates(): Promise<ReferenceRates>; chain: ExecutorChain; signer(ctx: TreasuryContext): TreasurySigner; signTx(signer, call: { to; data }, feeToken: GasToken): Promise<SignedTreasuryTx>; rfq: Pick<TextileRfqClient, "request" | "cancel" | "submit">; drip: Dripper; allowedSpenders: readonly Address[] }`.
  - `type RunOutcome = "disabled" | "locked" | "pending_tx" | "no_rates" | "idle" | "dry_run" | "needs_gas" | "waiting" | "no_quote" | "expired" | "blocked" | "converted" | "failed"` and `interface RunResult { userId: string; outcome: RunOutcome; detail?: string }`.
  - `engineRules(rules: RulesRow): EngineRules`.
  - `runTreasuryForUser(deps, userId): Promise<RunResult>`.
  - `reconcilePending(deps, ctx): Promise<number>`, which returns how many are still pending.
  - `sendTreasuryTx(deps, ctx, signer, kind: TxKind, call: { to; data }, feeToken, extra?: { asset?; amountAtomic?; toAddress?; usdCents? }): Promise<{ hash: Hex; status: "success" | "reverted" | null }>`.
  - `settleSwap(deps, userId, hash, status)` and `settleWithdrawal(deps, tx: Pick<TreasuryTxRow, "userId" | "hash" | "asset" | "amountAtomic">, status)`.
  - `runTreasuries(userIds, run: (userId) => Promise<RunResult>, opts?: { deadline?: number; now?: () => number }): Promise<RunResult[]>`.
  - `summarizeRuns(results): Partial<Record<RunOutcome, number>>`.

The order of one run (spec §10.4):
1. Lock the wallet.
2. Reconcile earlier transactions: stop if any is still pending.
3. Read rates and balances, then run the engine.
4. Plan the intent. In dry run, record and stop.
5. Check gas, and drip if needed.
6. Send the RFQ with a fresh taker proof.
7. Check the quote against policy and price.
8. Approve. USD₮ is reset to 0 first.
9. Check expiry.
10. Store the signed swap and trade, broadcast, wait for the receipt, settle, and submit to Textile.

Events are logged once per intent for `waiting`, `no_quote` and `needs_gas`, so the 10-minute cron does not flood the feed.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/treasury/executor.test.ts
import { eq } from "drizzle-orm";
import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { TEXTILE_REACTOR, type GasToken } from "@/lib/chain/treasury-tx";
import type { Db } from "@/lib/db/client";
import { agentEvents, fxIntents, fxTrades, rules, treasuryTxs, treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { ReferenceRates } from "@/lib/fx/rates";
import { TextileError, type FirmQuote, type RfqOutcome } from "@/lib/fx/rfq";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { runTreasuries, runTreasuryForUser, summarizeRuns, type ExecutorDeps } from "./executor";
import { acquireWalletLock } from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const TREASURY = getAddress(TEST_TREASURY);
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** Sell 3,200 wARS (US$2) for 1.99 USD₮: 50 bps worse than the reference, exactly the default limit. */
function quoted(over: Partial<FirmQuote> = {}): RfqOutcome {
  return {
    status: "quoted",
    quote: {
      rfqId: "rfq_1",
      claimToken: "claim_1",
      sellAmount: pesos(3_200n),
      buyAmount: 1_990_000n,
      feeAmount: 0n,
      takerPays: pesos(3_200n),
      expiresAt: new Date(NOW.getTime() + 60_000),
      spender: TEXTILE_REACTOR,
      taker: TREASURY,
      swap: { to: TEXTILE_REACTOR, data: "0xabcdef", value: 0n, chainId: 42220 },
      ...over,
    },
  };
}

/** The real database around a fake chain, signer, Textile and drip. Signed transaction n has hash hashOf(n). */
function harness(balances: Partial<TreasuryBalances>, over: { dryRun?: boolean; outcome?: RfqOutcome } = {}) {
  const state = {
    balances: { ...ZERO, ...balances },
    allowance: 0n,
    receipts: new Map<string, "success" | "reverted" | null>(),
    confirmedNonce: 0,
    sent: [] as Hex[],
  };
  const signed: { to: Address; data: Hex; feeToken: GasToken }[] = [];
  const deps: ExecutorDeps = {
    db,
    now: () => NOW,
    flags: { enabled: true, dryRun: over.dryRun ?? false },
    rates: async () => RATES,
    chain: {
      readBalances: async () => ({ ...state.balances }),
      allowance: async () => state.allowance,
      receipt: async (hash) => state.receipts.get(hash) ?? null,
      confirmedNonce: async () => state.confirmedNonce,
      sendRaw: async (raw) => {
        state.sent.push(raw);
      },
      waitForReceipt: async (hash) => (state.receipts.has(hash) ? (state.receipts.get(hash) ?? null) : "success"),
    },
    signer: () => ({ address: TREASURY, signDigest: vi.fn(), signTypedData: vi.fn(async () => "0x5151" as Hex) }),
    signTx: vi.fn<ExecutorDeps["signTx"]>(async (...args) => {
      const [, call, feeToken] = args;
      signed.push({ ...call, feeToken });
      const n = signed.length;
      return { hash: hashOf(n), raw: `0x${"ab".repeat(n)}` as Hex, nonce: n, feeToken };
    }),
    rfq: {
      request: vi.fn(async () => over.outcome ?? quoted()),
      cancel: vi.fn(async () => {}),
      submit: vi.fn(async () => {}),
    },
    drip: vi.fn(async () => {
      state.balances.USDC = 50_000n;
      return "0xd1" as Hex;
    }),
    allowedSpenders: [TEXTILE_REACTOR],
  };
  return { deps, state, signed };
}

async function freelancer(reserveAmount = "0.00") {
  const user = await seedFreelancer(db);
  await db.update(rules).set({ reserveAmount }).where(eq(rules.userId, user.id));
  return user;
}
const eventTypes = async (userId: string) =>
  (await db.select().from(agentEvents).where(eq(agentEvents.userId, userId))).map((e) => e.type);
const tradesOf = (userId: string) => db.select().from(fxTrades).where(eq(fxTrades.userId, userId));
const intentsOf = (userId: string) => db.select().from(fxIntents).where(eq(fxIntents.userId, userId));
const gas = { USDT: 1_000_000n };

describe("runTreasuryForUser: switches and dry run", () => {
  it("does nothing while the global switch is off", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas });
    deps.flags.enabled = false;
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "disabled" });
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("records a dry-run decision once and contacts nobody", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { dryRun: true });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect(await eventTypes(user.id)).toEqual(["dry_run"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
    expect(deps.signTx).not.toHaveBeenCalled();
  });

  it("returns locked while another run holds the wallet", async () => {
    const user = await freelancer();
    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    await acquireWalletLock(db, wallet.id, crypto.randomUUID(), NOW);
    const { deps } = harness({ WARS: pesos(3_200n), ...gas });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("locked");
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });
});

describe("runTreasuryForUser: converting", () => {
  it("approves the reactor, swaps, records the fill and tells Textile", async () => {
    const user = await freelancer();
    const { deps, signed } = harness({ WARS: pesos(3_200n), ...gas });

    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "converted" });

    expect(deps.rfq.request).toHaveBeenCalledWith(
      expect.objectContaining({ sellAmount: pesos(3_200n), taker: TREASURY, takerProof: expect.objectContaining({ signature: "0x5151" }) }),
    );
    // Approval up to the rest of the daily cap (US$200 = 320,000 wARS), then the quote's swap.
    expect(signed[0].to).toBe(TOKENS.WARS.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[0].data }).args).toEqual([TEXTILE_REACTOR, pesos(320_000n)]);
    expect(signed[1]).toEqual({ to: TEXTILE_REACTOR, data: "0xabcdef", feeToken: "USDT" });

    const [trade] = await tradesOf(user.id);
    expect(trade).toMatchObject({ status: "filled", slippageBps: 50, notionalUsdCents: 200, swapTxHash: hashOf(2) });
    expect((await intentsOf(user.id))[0].status).toBe("filled");
    expect(deps.rfq.submit).toHaveBeenCalledWith("rfq_1", "claim_1", hashOf(2));
    expect(await eventTypes(user.id)).toEqual(["converted"]);
    expect((await db.select().from(treasuryTxs)).map((t) => t.status)).toEqual(["success", "success"]);
  });

  it("resets a USD₮ allowance to 0 before raising it", async () => {
    // Reserve ARS 16,000 (US$10), nothing held: buy US$10 of wARS with USD₮.
    const user = await freelancer("16000.00");
    const { deps, state, signed } = harness(
      { USDT: 20_000_000n },
      { outcome: quoted({ sellAmount: 10_000_000n, takerPays: 10_000_000n, buyAmount: pesos(15_950n) }) },
    );
    state.allowance = 5n;
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[0].data }).args).toEqual([TEXTILE_REACTOR, 0n]);
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[1].data }).args).toEqual([TEXTILE_REACTOR, 200_000_000n]);
    expect(signed[2].to).toBe(TEXTILE_REACTOR);
  });

  it("drips gas once when the wallet has no stablecoin to pay with", async () => {
    const user = await freelancer();
    const { deps, signed } = harness({ WARS: pesos(3_200n) });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    expect(deps.drip).toHaveBeenCalledWith(TREASURY, 50_000n);
    expect(signed.every((s) => s.feeToken === "USDC")).toBe(true);
    expect(await eventTypes(user.id)).toEqual(["gas_dripped", "converted"]);
  });

  it("waits without gas when today's drip was already used", async () => {
    const user = await freelancer();
    await db.update(treasuryWallets).set({ gasDrippedAt: new Date(NOW.getTime() - 3_600_000) }).where(eq(treasuryWallets.userId, user.id));
    const { deps } = harness({ WARS: pesos(3_200n) });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("needs_gas");
    expect(deps.drip).not.toHaveBeenCalled();
    expect(await eventTypes(user.id)).toEqual(["needs_gas"]);
  });

  it("discards a quote that expires before the swap could be sent", async () => {
    const user = await freelancer();
    const { deps, signed } = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ expiresAt: new Date(NOW.getTime() + 3_000) }) });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("expired");
    expect(signed).toHaveLength(1); // the approval only
    expect((await tradesOf(user.id))[0].status).toBe("expired");
    expect((await intentsOf(user.id))[0].status).toBe("waiting");
  });
});

describe("runTreasuryForUser: price and quote checks", () => {
  it("waits for a better price and says so once", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ buyAmount: 1_900_000n }) });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "waiting", detail: "price" });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "waiting", detail: "price" });
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(deps.signTx).not.toHaveBeenCalled();
    expect((await tradesOf(user.id)).map((t) => [t.status, t.slippageBps])).toEqual([
      ["rejected", 500],
      ["rejected", 500],
    ]);
    expect(await eventTypes(user.id)).toEqual(["waiting"]);
    expect((await intentsOf(user.id))[0]).toMatchObject({ status: "waiting", attempts: 2, lastSlippageBps: 500 });
  });

  it("after the wait deadline blocks a price beyond the hard limit and accepts one within it", async () => {
    const blockedUser = await freelancer();
    const okUser = await freelancer();
    const old = new Date(NOW.getTime() - 7 * 3_600_000);
    for (const userId of [blockedUser.id, okUser.id]) {
      await db.insert(fxIntents).values({
        userId,
        fromAsset: "WARS",
        toAsset: "USDT",
        amountAtomic: pesos(3_200n).toString(),
        reason: "save_excess",
        createdAt: old,
      });
    }
    const blocked = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ buyAmount: 1_900_000n }) });
    expect((await runTreasuryForUser(blocked.deps, blockedUser.id)).outcome).toBe("blocked");
    expect((await intentsOf(blockedUser.id))[0].status).toBe("blocked");
    expect(await eventTypes(blockedUser.id)).toEqual(["blocked"]);

    const ok = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ buyAmount: 1_980_000n }) });
    expect((await runTreasuryForUser(ok.deps, okUser.id)).outcome).toBe("converted");
  });

  it.each([
    ["another taker", { taker: STRANGER }],
    ["an unknown spender", { spender: STRANGER, swap: { to: STRANGER, data: "0xabcdef" as Hex, value: 0n, chainId: 42220 } }],
    ["more than the intent", { takerPays: pesos(3_201n) }],
  ])("refuses a quote with %s and signs nothing", async (_label, over) => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted(over) });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "failed", detail: "policy" });
    expect(deps.signTx).not.toHaveBeenCalled();
    expect(deps.rfq.cancel).toHaveBeenCalled();
    expect(await eventTypes(user.id)).toEqual(["policy_rejected"]);
  });

  it("respects Textile's retry hint after a no-quote", async () => {
    const user = await freelancer();
    const { deps } = harness(
      { WARS: pesos(3_200n), ...gas },
      { outcome: { status: "no_quote", reason: "no_makers_online", retryAfterMs: 30_000 } },
    );
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "no_quote", detail: "no_makers_online" });
    expect((await intentsOf(user.id))[0].retryAfter).toEqual(new Date(NOW.getTime() + 30_000));
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "waiting", detail: "retry_after" });
    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
    expect((await tradesOf(user.id))[0]).toMatchObject({ status: "no_quote", detail: "no_makers_online" });
  });

  it("backs off after a Textile error such as insufficient funds", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas });
    vi.mocked(deps.rfq.request).mockRejectedValueOnce(new TextileError(400, "insufficient_funds", "not enough"));
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "no_quote", detail: "insufficient_funds" });
    expect((await intentsOf(user.id))[0].retryAfter).toEqual(new Date(NOW.getTime() + 600_000));
  });
});

describe("runTreasuryForUser: unknown outcomes (spec §10.4 step 7)", () => {
  async function pendingSwap(userId: string) {
    const [intent] = await db
      .insert(fxIntents)
      .values({ userId, fromAsset: "WARS", toAsset: "USDT", amountAtomic: "1", reason: "save_excess", status: "executing" })
      .returning();
    await db.insert(treasuryTxs).values({ userId, kind: "swap", nonce: 7, hash: hashOf(99), raw: "0xabab", feeToken: "USDT" });
    await db.insert(fxTrades).values({
      userId,
      intentId: intent.id,
      rfqId: "rfq_0",
      claimToken: "claim_0",
      sellAsset: "WARS",
      buyAsset: "USDT",
      sellAmount: "1",
      status: "broadcast",
      swapTxHash: hashOf(99),
    });
  }

  it("re-sends the stored bytes and does nothing else while a swap is unresolved", async () => {
    const user = await freelancer();
    await pendingSwap(user.id);
    const { deps, state } = harness({ WARS: pesos(3_200n), ...gas });
    state.confirmedNonce = 7;
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("pending_tx");
    expect(state.sent).toEqual(["0xabab"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("settles a swap from its receipt, then carries on", async () => {
    const user = await freelancer();
    await pendingSwap(user.id);
    const { deps, state } = harness({});
    state.receipts.set(hashOf(99), "success");
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("idle");
    expect((await tradesOf(user.id))[0].status).toBe("filled");
    expect((await intentsOf(user.id))[0].status).toBe("filled");
    expect(deps.rfq.submit).toHaveBeenCalledWith("rfq_0", "claim_0", hashOf(99));
    expect(await eventTypes(user.id)).toEqual(["converted"]);
  });

  it("marks a swap failed when a later nonce was mined without it", async () => {
    const user = await freelancer();
    await pendingSwap(user.id);
    const { deps, state } = harness({});
    state.confirmedNonce = 8;
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("idle");
    expect((await tradesOf(user.id))[0].status).toBe("failed");
    expect(await eventTypes(user.id)).toEqual(["swap_failed"]);
    expect(state.sent).toEqual([]);
  });

  it("leaves a broadcast swap pending when its receipt does not arrive in time", async () => {
    const user = await freelancer();
    const { deps, state } = harness({ WARS: pesos(3_200n), ...gas });
    state.receipts.set(hashOf(2), null);
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "pending_tx", detail: "swap" });
    expect((await tradesOf(user.id))[0].status).toBe("broadcast");
    expect((await db.select().from(treasuryTxs).where(eq(treasuryTxs.hash, hashOf(2))))[0].status).toBe("pending");
  });
});

describe("runTreasuries", () => {
  it("keeps going after one wallet fails, and stops starting new ones after the deadline", async () => {
    const run = vi.fn(async (userId: string) => {
      if (userId === "b") throw new Error("boom");
      return { userId, outcome: "idle" as const };
    });
    expect(await runTreasuries(["a", "b", "c"], run)).toEqual([
      { userId: "a", outcome: "idle" },
      { userId: "b", outcome: "failed", detail: "boom" },
      { userId: "c", outcome: "idle" },
    ]);
    let clock = 0;
    const timed = await runTreasuries(["a", "b", "c"], async (userId) => ((clock += 100), { userId, outcome: "idle" as const }), {
      deadline: 150,
      now: () => clock,
    });
    expect(timed.map((r) => r.userId)).toEqual(["a", "b"]);
    expect(summarizeRuns([...timed, { userId: "x", outcome: "converted" }])).toEqual({ idle: 2, converted: 1 });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/treasury/executor.test.ts`
Expected: FAIL with "Failed to resolve import "./executor"".

- [ ] **Step 3: Implement**

```ts
// src/lib/treasury/executor.ts
import { randomBytes } from "node:crypto";
import { isAddressEqual, type Address, type Hex } from "viem";
import { TOKENS } from "@/lib/chain/tokens";
import { encodeTreasuryCall, pickGasToken, type GasToken, type SignedTreasuryTx, type TreasuryPolicy } from "@/lib/chain/treasury-tx";
import type { Db } from "@/lib/db/client";
import type { FxIntentRow, RulesRow, TreasuryTxRow, treasuryTxs, TxKind } from "@/lib/db/schema";
import type { ReferenceRates } from "@/lib/fx/rates";
import { takerControlTypedData, TextileError, type FirmQuote, type RfqOutcome, type TextileRfqClient } from "@/lib/fx/rfq";
import type { TreasurySigner } from "@/lib/signer/treasury-signer";
import { spendableBalances, type TreasuryBalances } from "./balances";
import { acceptQuote, decide, planIntent, slippageBps, type ConvertDecision, type EngineRules } from "./engine";
import { claimDrip, DRIP_AMOUNT_ATOMIC, type Dripper } from "./gas";
import {
  acquireWalletLock,
  cancelIntent,
  filledUsdWad24h,
  insertTrade,
  intentById,
  loadTreasuryContext,
  logEvent,
  openIntent,
  pendingTreasuryTxs,
  recordTreasuryTx,
  releaseWalletLock,
  saveIntent,
  settleTreasuryTx,
  tradeBySwapHash,
  updateIntent,
  updateTrade,
  type TreasuryContext,
} from "./repo";
import { atomicForUsdWad, dollarsToWad, usdWad } from "./value";

export interface ExecutorChain {
  readBalances(owner: Address): Promise<TreasuryBalances>;
  allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  /** The receipt's status, or null while the node has none. */
  receipt(hash: Hex): Promise<"success" | "reverted" | null>;
  /** How many transactions from `owner` are mined (the next nonce). */
  confirmedNonce(owner: Address): Promise<number>;
  /** Sends signed bytes; bytes the node already knows are not an error. */
  sendRaw(raw: Hex): Promise<void>;
  /** Waits a bounded time; null when no receipt arrived. */
  waitForReceipt(hash: Hex): Promise<"success" | "reverted" | null>;
}

export interface ExecutorDeps {
  db: Db;
  now(): Date;
  flags: { enabled: boolean; dryRun: boolean };
  rates(): Promise<ReferenceRates>;
  chain: ExecutorChain;
  signer(ctx: TreasuryContext): TreasurySigner;
  signTx(signer: TreasurySigner, call: { to: Address; data: Hex }, feeToken: GasToken): Promise<SignedTreasuryTx>;
  rfq: Pick<TextileRfqClient, "request" | "cancel" | "submit">;
  drip: Dripper;
  allowedSpenders: readonly Address[];
}

export type RunOutcome =
  | "disabled"
  | "locked"
  | "pending_tx"
  | "no_rates"
  | "idle"
  | "dry_run"
  | "needs_gas"
  | "waiting"
  | "no_quote"
  | "expired"
  | "blocked"
  | "converted"
  | "failed";

export interface RunResult {
  userId: string;
  outcome: RunOutcome;
  detail?: string;
}

/** A quote this close to its expiry is not broadcast. */
const EXPIRY_MARGIN_MS = 5_000;
/** Back-off after an RFQ error with no retry hint, or after a refused quote. */
const RETRY_AFTER_ERROR_MS = 10 * 60_000;

const cents = (wad: bigint) => Number(wad / 10n ** 16n);
const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function engineRules(rules: RulesRow): EngineRules {
  return {
    localCurrency: rules.localCurrency,
    reserveAmount: rules.reserveAmount,
    autoTopUp: rules.autoTopUp,
    perTradeMaxUsd: rules.perTradeMaxUsd,
    dailyMaxUsd: rules.dailyMaxUsd,
  };
}

function decisionData(d: ConvertDecision) {
  return { from: d.from, to: d.to, amount: d.amount.toString(), usdCents: cents(d.usdWad), reason: d.reason };
}

/** Spec §10.4 for one freelancer. Never throws for an expected condition; the outcome says what happened. */
export async function runTreasuryForUser(deps: ExecutorDeps, userId: string): Promise<RunResult> {
  const result = (outcome: RunOutcome, detail?: string): RunResult => (detail ? { userId, outcome, detail } : { userId, outcome });
  if (!deps.flags.enabled) return result("disabled");
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx || !ctx.rules.enabled) return result("disabled");
  const holder = crypto.randomUUID();
  if (!(await acquireWalletLock(deps.db, ctx.walletId, holder, deps.now()))) return result("locked");
  try {
    return await runLocked(deps, ctx, result);
  } finally {
    await releaseWalletLock(deps.db, ctx.walletId, holder);
  }
}

type Result = (outcome: RunOutcome, detail?: string) => RunResult;

async function runLocked(deps: ExecutorDeps, ctx: TreasuryContext, result: Result): Promise<RunResult> {
  // Nothing new until every earlier transaction from this wallet has an outcome (spec §12).
  if ((await reconcilePending(deps, ctx)) > 0) return result("pending_tx");

  let rates: ReferenceRates;
  try {
    rates = await deps.rates();
  } catch (error) {
    return result("no_rates", messageOf(error));
  }

  let balances = await deps.chain.readBalances(ctx.address);
  const decision = decide({
    balances: spendableBalances(balances, pickGasToken(balances)),
    rules: engineRules(ctx.rules),
    rates,
    filledUsdWad24h: await filledUsdWad24h(deps.db, ctx.userId, deps.now()),
  });
  const open = await openIntent(deps.db, ctx.userId);
  const plan = planIntent(open && { id: open.id, fromAsset: open.fromAsset, toAsset: open.toAsset }, decision);
  if (plan.action === "none") {
    if (plan.cancel) await cancelIntent(deps.db, plan.cancel, deps.now());
    return result("idle", decision.kind === "none" ? decision.reason : undefined);
  }
  const d = plan.decision;
  const intent = await saveIntent(deps.db, ctx.userId, plan, deps.now());

  if (deps.flags.dryRun) {
    if (plan.keep === null) await logEvent(deps.db, ctx.userId, "dry_run", decisionData(d), deps.now());
    return result("dry_run");
  }
  if (intent.retryAfter && intent.retryAfter > deps.now()) return result("waiting", "retry_after");

  // Gas (spec §8.6, decided 2026-10-09): CIP-64 in a dollar token the wallet holds, else one drip a day.
  let feeToken = pickGasToken(balances, { asset: d.from, amount: d.amount });
  if (!feeToken && (await claimDrip(deps.db, ctx.walletId, deps.now()))) {
    try {
      await deps.drip(ctx.address, DRIP_AMOUNT_ATOMIC);
      await logEvent(deps.db, ctx.userId, "gas_dripped", { amount: DRIP_AMOUNT_ATOMIC.toString() }, deps.now());
      balances = await deps.chain.readBalances(ctx.address);
      feeToken = pickGasToken(balances, { asset: d.from, amount: d.amount });
    } catch (error) {
      console.error(`Gas drip to ${ctx.address} failed:`, error);
    }
  }
  if (!feeToken) {
    if (intent.attempts === 0) await logEvent(deps.db, ctx.userId, "needs_gas", {}, deps.now());
    await updateIntent(deps.db, intent.id, { attempts: intent.attempts + 1 }, deps.now());
    return result("needs_gas");
  }
  return trade(deps, ctx, intent, d, feeToken, rates, result);
}

function quoteMatches(q: FirmQuote, taker: Address, maxSell: bigint, allowed: readonly Address[]): boolean {
  return (
    isAddressEqual(q.taker, taker) &&
    q.takerPays > 0n &&
    q.takerPays <= maxSell &&
    isAddressEqual(q.swap.to, q.spender) &&
    allowed.some((spender) => isAddressEqual(spender, q.spender))
  );
}

async function trade(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  intent: FxIntentRow,
  d: ConvertDecision,
  feeToken: GasToken,
  rates: ReferenceRates,
  result: Result,
): Promise<RunResult> {
  const signer = deps.signer(ctx);
  const attempts = intent.attempts + 1;
  const firstAttempt = intent.attempts === 0;

  // Spec §10.4 step 3, with a fresh taker proof each time (Textile accepts one for 60 s).
  let outcome: RfqOutcome;
  try {
    const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
    const issuedAt = deps.now().getTime();
    const signature = await signer.signTypedData(takerControlTypedData(ctx.address, nonce, issuedAt));
    outcome = await deps.rfq.request({
      sellToken: TOKENS[d.from].address,
      buyToken: TOKENS[d.to].address,
      sellAmount: d.amount,
      taker: ctx.address,
      takerProof: { nonce, issuedAt, signature },
    });
  } catch (error) {
    // Textile errors (insufficient_funds, 429, 5xx, network) and Para errors alike: wait and retry (spec §12).
    if (!(error instanceof TextileError)) console.error(`RFQ for ${ctx.userId} failed:`, error);
    const reason = error instanceof TextileError ? (error.reason ?? `http_${error.status}`) : "error";
    return noQuote(deps, ctx, intent, d, reason, RETRY_AFTER_ERROR_MS, result);
  }
  if (outcome.status === "no_quote") return noQuote(deps, ctx, intent, d, outcome.reason, outcome.retryAfterMs, result);

  const q = outcome.quote;
  const quotedTrade = {
    userId: ctx.userId,
    intentId: intent.id,
    rfqId: q.rfqId,
    sellAsset: d.from,
    buyAsset: d.to,
    sellAmount: q.takerPays.toString(),
    buyAmount: q.buyAmount.toString(),
    feeAmount: q.feeAmount.toString(),
  };
  const refuse = async (status: "rejected" | "expired", detail: string, slippage: number | null) => {
    await deps.rfq.cancel(q.rfqId, q.claimToken).catch((error) => console.error(`Textile cancel ${q.rfqId} failed:`, error));
    await insertTrade(deps.db, { ...quotedTrade, status, detail, slippageBps: slippage });
  };

  // The quote must be what we asked for: bound to this wallet, within the intent, on an allowed contract.
  if (!quoteMatches(q, ctx.address, d.amount, deps.allowedSpenders)) {
    await refuse("rejected", "policy", null);
    await updateIntent(deps.db, intent.id, { attempts, retryAfter: new Date(deps.now().getTime() + RETRY_AFTER_ERROR_MS) }, deps.now());
    await logEvent(deps.db, ctx.userId, "policy_rejected", { ...decisionData(d), spender: q.spender }, deps.now());
    return result("failed", "policy");
  }

  // Spec §10.3.
  const slippage = slippageBps(d.from, q.takerPays, d.to, q.buyAmount, rates);
  const verdict = acceptQuote({
    slippageBps: slippage,
    intentCreatedAt: intent.createdAt,
    now: deps.now(),
    maxSlippageBps: ctx.rules.maxSlippageBps,
    hardMaxSlippageBps: ctx.rules.hardMaxSlippageBps,
    maxWaitMinutes: ctx.rules.maxWaitMinutes,
  });
  if (verdict === "block") {
    await refuse("rejected", "price_blocked", slippage);
    await updateIntent(deps.db, intent.id, { status: "blocked", attempts, lastSlippageBps: slippage }, deps.now());
    await logEvent(
      deps.db,
      ctx.userId,
      "blocked",
      { ...decisionData(d), slippageBps: slippage, limitBps: ctx.rules.hardMaxSlippageBps },
      deps.now(),
    );
    return result("blocked");
  }
  if (verdict === "wait") {
    await refuse("rejected", "price", slippage);
    await updateIntent(deps.db, intent.id, { attempts, lastSlippageBps: slippage }, deps.now());
    if (firstAttempt) {
      await logEvent(
        deps.db,
        ctx.userId,
        "waiting",
        { ...decisionData(d), slippageBps: slippage, limitBps: ctx.rules.maxSlippageBps },
        deps.now(),
      );
    }
    return result("waiting", "price");
  }

  await updateIntent(deps.db, intent.id, { status: "executing", attempts, lastSlippageBps: slippage }, deps.now());
  const policy: TreasuryPolicy = { allowedSpenders: deps.allowedSpenders, personalWallet: ctx.personalWallet };

  // Spec §10.4 step 5: approve up to what is left of the daily cap; USD₮ needs a reset to 0 first.
  const allowance = await deps.chain.allowance(TOKENS[d.from].address, ctx.address, q.spender);
  if (allowance < q.takerPays) {
    const dailyLeft = dollarsToWad(ctx.rules.dailyMaxUsd) - (await filledUsdWad24h(deps.db, ctx.userId, deps.now()));
    const target = maxBig(q.takerPays, atomicForUsdWad(d.from, dailyLeft, rates));
    for (const amount of d.from === "USDT" && allowance > 0n ? [0n, target] : [target]) {
      const call = encodeTreasuryCall({ kind: "approve", asset: d.from, spender: q.spender, amount }, policy);
      const sent = await sendTreasuryTx(deps, ctx, signer, "approve", call, feeToken);
      if (sent.status !== "success") {
        await refuse("rejected", `approve_${sent.status ?? "pending"}`, slippage);
        await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
        return sent.status === null ? result("pending_tx", "approve") : result("failed", "approve");
      }
    }
  }
  if (deps.now().getTime() >= q.expiresAt.getTime() - EXPIRY_MARGIN_MS) {
    // Spec §12: an expired quote is discarded, never sent. The allowance stays for the next run.
    await refuse("expired", "quote_expired", slippage);
    await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
    return result("expired");
  }

  // Store the signed bytes and the trade before broadcasting, so a crash right after is reconcilable.
  const signed = await deps.signTx(signer, encodeTreasuryCall({ kind: "swap", ...q.swap }, policy), feeToken);
  await deps.db.transaction(async (tx) => {
    await recordTreasuryTx(tx, { userId: ctx.userId, kind: "swap", nonce: signed.nonce, hash: signed.hash, raw: signed.raw, feeToken });
    await insertTrade(tx, {
      ...quotedTrade,
      claimToken: q.claimToken,
      slippageBps: slippage,
      notionalUsdCents: cents(usdWad(d.from, q.takerPays, rates)),
      status: "broadcast",
      swapTxHash: signed.hash,
    });
  });
  await deps.chain.sendRaw(signed.raw);
  const status = await deps.chain.waitForReceipt(signed.hash);
  if (status === null) return result("pending_tx", "swap");
  await settleSwap(deps, ctx.userId, signed.hash, status);
  return status === "success" ? result("converted") : result("failed", "swap_reverted");
}

async function noQuote(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  intent: FxIntentRow,
  d: ConvertDecision,
  reason: string,
  retryAfterMs: number | null,
  result: Result,
): Promise<RunResult> {
  const now = deps.now();
  await insertTrade(deps.db, {
    userId: ctx.userId,
    intentId: intent.id,
    sellAsset: d.from,
    buyAsset: d.to,
    sellAmount: d.amount.toString(),
    status: "no_quote",
    detail: reason,
  });
  await updateIntent(
    deps.db,
    intent.id,
    { attempts: intent.attempts + 1, retryAfter: retryAfterMs ? new Date(now.getTime() + retryAfterMs) : null },
    now,
  );
  if (intent.attempts === 0) await logEvent(deps.db, ctx.userId, "no_quote", { ...decisionData(d), detail: reason }, now);
  return result("no_quote", reason);
}

/** Signs, stores, broadcasts and waits for one treasury transaction. Shared with withdrawals. */
export async function sendTreasuryTx(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "signTx">,
  ctx: TreasuryContext,
  signer: TreasurySigner,
  kind: TxKind,
  call: { to: Address; data: Hex },
  feeToken: GasToken,
  extra: Pick<typeof treasuryTxs.$inferInsert, "asset" | "amountAtomic" | "toAddress" | "usdCents"> = {},
): Promise<{ hash: Hex; status: "success" | "reverted" | null }> {
  const signed = await deps.signTx(signer, call, feeToken);
  await recordTreasuryTx(deps.db, {
    userId: ctx.userId,
    kind,
    nonce: signed.nonce,
    hash: signed.hash,
    raw: signed.raw,
    feeToken,
    ...extra,
  });
  await deps.chain.sendRaw(signed.raw);
  const status = await deps.chain.waitForReceipt(signed.hash);
  if (status) await settleTreasuryTx(deps.db, signed.hash, status, deps.now());
  return { hash: signed.hash, status };
}

export async function settleSwap(
  deps: Pick<ExecutorDeps, "db" | "now" | "rfq">,
  userId: string,
  hash: string,
  status: "success" | "reverted",
): Promise<void> {
  await settleTreasuryTx(deps.db, hash, status, deps.now());
  const trade = await tradeBySwapHash(deps.db, hash);
  if (!trade) return;
  const intent = trade.intentId ? await intentById(deps.db, trade.intentId) : null;
  const data = {
    from: trade.sellAsset,
    to: trade.buyAsset,
    amount: trade.sellAmount,
    buyAmount: trade.buyAmount,
    slippageBps: trade.slippageBps,
    reason: intent?.reason ?? null,
    txHash: hash,
  };
  if (status === "success") {
    await updateTrade(deps.db, trade.id, { status: "filled", filledAt: deps.now() });
    if (intent) await updateIntent(deps.db, intent.id, { status: "filled" }, deps.now());
    if (trade.rfqId && trade.claimToken) {
      await deps.rfq
        .submit(trade.rfqId, trade.claimToken, hash as Hex)
        .catch((error) => console.error(`Textile submit ${trade.rfqId} failed:`, error));
    }
    await logEvent(deps.db, userId, "converted", data, deps.now());
  } else {
    await updateTrade(deps.db, trade.id, { status: "failed", detail: "reverted" });
    if (intent?.status === "executing") await updateIntent(deps.db, intent.id, { status: "waiting" }, deps.now());
    await logEvent(deps.db, userId, "swap_failed", data, deps.now());
  }
}

export async function settleWithdrawal(
  deps: Pick<ExecutorDeps, "db" | "now">,
  tx: Pick<TreasuryTxRow, "userId" | "hash" | "asset" | "amountAtomic">,
  status: "success" | "reverted",
): Promise<void> {
  await settleTreasuryTx(deps.db, tx.hash, status, deps.now());
  await logEvent(
    deps.db,
    tx.userId,
    status === "success" ? "withdrawn" : "withdraw_failed",
    { asset: tx.asset, amount: tx.amountAtomic, txHash: tx.hash },
    deps.now(),
  );
}

/**
 * Spec §10.4 step 7: settle every pending transaction by its receipt. One with no receipt whose
 * nonce a later transaction already used can never land and counts as failed; otherwise the
 * identical signed bytes are sent again. Returns how many are still pending.
 */
export async function reconcilePending(
  deps: Pick<ExecutorDeps, "db" | "now" | "chain" | "rfq">,
  ctx: TreasuryContext,
): Promise<number> {
  let stillPending = 0;
  for (const tx of await pendingTreasuryTxs(deps.db, ctx.userId)) {
    let status = await deps.chain.receipt(tx.hash as Hex);
    if (status === null && (await deps.chain.confirmedNonce(ctx.address)) > tx.nonce) {
      // Mined between the two reads, or replaced: ask once more before calling it failed.
      status = (await deps.chain.receipt(tx.hash as Hex)) ?? "reverted";
    }
    if (status === null) {
      await deps.chain.sendRaw(tx.raw as Hex).catch((error) => console.error(`Re-sending ${tx.hash} failed:`, error));
      stillPending += 1;
      continue;
    }
    if (tx.kind === "swap") await settleSwap(deps, ctx.userId, tx.hash, status);
    else if (tx.kind === "withdraw") await settleWithdrawal(deps, tx, status);
    else await settleTreasuryTx(deps.db, tx.hash, status, deps.now());
  }
  return stillPending;
}

/** Runs wallets one after another; a failure never stops the others. Stops starting new ones after `deadline`. */
export async function runTreasuries(
  userIds: string[],
  run: (userId: string) => Promise<RunResult>,
  opts: { deadline?: number; now?: () => number } = {},
): Promise<RunResult[]> {
  const now = opts.now ?? Date.now;
  const results: RunResult[] = [];
  for (const userId of userIds) {
    if (opts.deadline !== undefined && now() > opts.deadline) break;
    try {
      results.push(await run(userId));
    } catch (error) {
      console.error(`Treasury run for ${userId} failed:`, error);
      results.push({ userId, outcome: "failed", detail: messageOf(error) });
    }
  }
  return results;
}

export function summarizeRuns(results: RunResult[]): Partial<Record<RunOutcome, number>> {
  const summary: Partial<Record<RunOutcome, number>> = {};
  for (const { outcome } of results) summary[outcome] = (summary[outcome] ?? 0) + 1;
  return summary;
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/treasury/executor.test.ts`
Expected: PASS (20 tests).

If a test fails, debug the executor with superpowers:systematic-debugging, never the expectation. The numbers come from Task 4's arithmetic: US$2 sold, 50 bps, a cap of 320,000 wARS, and a 200 USD₮ approval.

- [ ] **Step 5: Full suite, typecheck and commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass; no type errors.

```bash
git add src/lib/treasury/executor.ts src/lib/treasury/executor.test.ts
git commit -m "feat(treasury): executor with locking, reconciliation, price checks and tagged swaps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Live wiring, cron run and payment trigger

**Files:**
- Create: `src/lib/treasury/live.ts`
- Modify: `src/app/api/cron/treasury/route.ts`, `src/app/api/pay/[slug]/route.ts`, `.github/workflows/treasury-cron.yml`

**Interfaces:**
- Consumes:
  - Task 9: `ExecutorDeps`, `runTreasuryForUser`, `runTreasuries`, `summarizeRuns`.
  - Task 8: `listTreasuryUsers`.
  - Task 7: `erc20Balance`, `readTreasuryBalances`, `operatorDripper`.
  - Task 6: `signTreasuryTx`, `TEXTILE_REACTOR`, `paraTreasurySigner`.
  - Task 5: `TextileRfqClient`.
  - `getReferenceRates`, `paraRestClient`, `createCeloPublicClient`, `readPublicEnv`, `parseServerEnv`.
- Produces:
  - `liveExecutorDeps(): ExecutorDeps`, cached per server instance.
  - `runTreasuryAfterPayment(slug: string): Promise<void>`, which never throws.
  - Cron response `{ issued: number, treasury: "disabled" | Partial<Record<RunOutcome, number>> }`.

- [ ] **Step 1: Write `src/lib/treasury/live.ts`**

```ts
// src/lib/treasury/live.ts
import { eq } from "drizzle-orm";
import { erc20Abi, TransactionReceiptNotFoundError, WaitForTransactionReceiptTimeoutError } from "viem";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { signTreasuryTx, TEXTILE_REACTOR } from "@/lib/chain/treasury-tx";
import { readPublicEnv } from "@/lib/config/public";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { getReferenceRates } from "@/lib/fx/rates";
import { TextileRfqClient } from "@/lib/fx/rfq";
import { paraTreasurySigner } from "@/lib/signer/treasury-signer";
import { paraRestClient } from "@/lib/users/para";
import { erc20Balance, readTreasuryBalances } from "./balances";
import { runTreasuryForUser, type ExecutorDeps } from "./executor";
import { operatorDripper } from "./gas";

const RECEIPT_TIMEOUT_MS = 45_000;
let cached: ExecutorDeps | undefined;

/** Real chain, Para, Textile and operator wiring, built once per server instance. */
export function liveExecutorDeps(): ExecutorDeps {
  if (cached) return cached;
  const env = parseServerEnv();
  const code = readPublicEnv().NEXT_PUBLIC_ATTRIBUTION_CODE;
  const client = createCeloPublicClient(env.CELO_RPC_URL);
  const para = paraRestClient();
  const read = erc20Balance(client);
  cached = {
    db: getDb(),
    now: () => new Date(),
    flags: { enabled: env.TREASURY_ENABLED, dryRun: env.TREASURY_DRY_RUN },
    rates: getReferenceRates,
    chain: {
      readBalances: (owner) => readTreasuryBalances(read, owner),
      allowance: (token, owner, spender) =>
        client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
      async receipt(hash) {
        try {
          return (await client.getTransactionReceipt({ hash })).status;
        } catch (error) {
          if (error instanceof TransactionReceiptNotFoundError) return null;
          throw error;
        }
      },
      confirmedNonce: (owner) => client.getTransactionCount({ address: owner, blockTag: "latest" }),
      async sendRaw(raw) {
        try {
          await client.sendRawTransaction({ serializedTransaction: raw });
        } catch (error) {
          if (!/already known|known transaction/i.test(error instanceof Error ? error.message : String(error))) throw error;
        }
      },
      async waitForReceipt(hash) {
        try {
          return (await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })).status;
        } catch (error) {
          if (error instanceof WaitForTransactionReceiptTimeoutError) return null;
          throw error;
        }
      },
    },
    signer: (ctx) => paraTreasurySigner(para, { id: ctx.paraWalletId, address: ctx.address }),
    signTx: (signer, call, feeToken) => signTreasuryTx({ client, signer, attributionCode: code }, call, feeToken),
    rfq: new TextileRfqClient({ baseUrl: env.TEXTILE_API_URL }),
    // The operator key is read only when a wallet actually needs gas.
    drip: (to, amount) =>
      operatorDripper({
        privateKey: requireValue(env.OPERATOR_PRIVATE_KEY, "OPERATOR_PRIVATE_KEY"),
        attributionCode: code,
        rpcUrl: env.CELO_RPC_URL,
        feeToken: env.OPERATOR_FEE_TOKEN,
      })(to, amount),
    allowedSpenders: [TEXTILE_REACTOR],
  };
  return cached;
}

/** Spec §7.3: a settled payment schedules a treasury run for the invoice's owner. Called from after(). */
export async function runTreasuryAfterPayment(slug: string): Promise<void> {
  if (!parseServerEnv().TREASURY_ENABLED) return;
  try {
    const deps = liveExecutorDeps();
    const [invoice] = await deps.db.select({ userId: invoices.userId }).from(invoices).where(eq(invoices.slug, slug));
    if (invoice) await runTreasuryForUser(deps, invoice.userId);
  } catch (error) {
    console.error(`Treasury run after payment ${slug} failed:`, error);
  }
}
```

- [ ] **Step 2: Replace `src/app/api/cron/treasury/route.ts`**

```ts
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
```

- [ ] **Step 3: Trigger a run after a settled payment in `src/app/api/pay/[slug]/route.ts`**

Add the imports:

```ts
import { after } from "next/server";
import { runTreasuryAfterPayment } from "@/lib/treasury/live";
```

Add below the imports:

```ts
/** Settlement takes seconds; the treasury run scheduled by after() shares this budget (spec §7.3). */
export const maxDuration = 300;
```

After `const response = await runPayFlow(…);`, before the `return`, add:

```ts
  if (response.status === 200) after(() => runTreasuryAfterPayment(slug));
```

- [ ] **Step 4: Give the workflow time to wait for the longer run**

In `.github/workflows/treasury-cron.yml`, change `timeout-minutes: 5` to `timeout-minutes: 6`. Change `--max-time 120` to `--max-time 290`.

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. The build lists `ƒ /api/cron/treasury` and `ƒ /api/pay/[slug]`.

By hand, on the dev server (`npm run dev`, Neon dev branch), with the secret read from `.env.local` by Node and never printed:

```bash
node --env-file=.env.local -e 'fetch("http://localhost:3000/api/cron/treasury",{method:"POST",headers:{authorization:"Bearer "+process.env.CRON_SECRET}}).then(async r=>console.log(r.status, await r.text()))'
```

Expected: `200 {"issued":0,"treasury":"disabled"}`, because `TREASURY_ENABLED` is unset.

Then restart the dev server as `TREASURY_ENABLED=true TREASURY_DRY_RUN=true npm run dev` and run the same command.

Expected: `200 {"issued":0,"treasury":{…}}` with `idle` or `dry_run` per onboarded user. Only reads happen: balances, Textile tickers. No RFQ is sent and nothing is signed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/treasury/live.ts src/app/api/cron/treasury/route.ts "src/app/api/pay/[slug]/route.ts" .github/workflows/treasury-cron.yml
git commit -m "feat(treasury): run the agent from the cron and after each settled payment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Withdrawal to the personal wallet

**Files:**
- Create: `src/lib/treasury/withdraw.ts`, `src/lib/treasury/withdraw.test.ts`, `src/app/app/withdraw/page.tsx`, `src/app/app/withdraw/withdraw-form.tsx`, `src/app/app/withdraw/actions.ts`
- Modify: `src/lib/users/queries.ts`, `src/lib/users/queries.test.ts`, `src/i18n/en.ts`

**Interfaces:**
- Consumes:
  - Task 9: `ExecutorDeps`, `reconcilePending`, `sendTreasuryTx`, `settleWithdrawal`.
  - Task 6: `encodeTreasuryCall`, `pickGasToken`, `GAS_TOKENS`, `GAS_FLOOR_ATOMIC`.
  - Task 7: `claimDrip`, `DRIP_AMOUNT_ATOMIC`, `TreasuryBalances`.
  - Task 8: `acquireWalletLock`, `releaseWalletLock`, `loadTreasuryContext`, `logEvent`.
  - Task 3: `usdWad`, `tokenFiatAmount`.
  - Task 10: `liveExecutorDeps`.
  - `parseFiatInput`, `parseDecimal`, `formFields`, `displayAmount`, `Money`, `FormField`, `SubmitButton`.
- Produces:
  - `withdrawableAmount(asset: PayAsset, balances: TreasuryBalances): bigint`.
  - `type WithdrawField = "asset" | "amount"`, `interface WithdrawInput { asset: PayAsset; amount: bigint }` and `parseWithdrawForm(fields, balances): FormResult<WithdrawInput, WithdrawField>`.
  - `type WithdrawError = "not_ready" | "no_personal_wallet" | "busy" | "insufficient" | "needs_gas" | "failed"`.
  - `withdraw(deps: ExecutorDeps, userId, input): Promise<{ ok: true; txHash: Hex; pending: boolean } | { ok: false; error: WithdrawError }>`.
  - `AppUser.personalWallet: Address | null`.
  - Page `/app/withdraw`.

A withdrawal works even while the agent is paused or in dry run. It is the freelancer's own request. It still takes the wallet lock and reconciles first, like an agent run.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/treasury/withdraw.test.ts
import { eq } from "drizzle-orm";
import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { TEXTILE_REACTOR } from "@/lib/chain/treasury-tx";
import type { Db } from "@/lib/db/client";
import { agentEvents, treasuryTxs, treasuryWallets, users } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import type { ExecutorDeps } from "./executor";
import { acquireWalletLock } from "./repo";
import { parseWithdrawForm, withdraw, withdrawableAmount } from "./withdraw";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const PERSONAL: Address = "0x3333333333333333333333333333333333333333";
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };

describe("withdrawableAmount", () => {
  it("is the whole balance unless the same token must also pay the gas", () => {
    expect(withdrawableAmount("USDT", { ...ZERO, USDT: 1_000_000n })).toBe(980_000n);
    expect(withdrawableAmount("USDT", { ...ZERO, USDT: 1_000_000n, USDC: 50_000n })).toBe(1_000_000n);
    expect(withdrawableAmount("WARS", { ...ZERO, WARS: 5n })).toBe(5n);
    expect(withdrawableAmount("USAT", { ...ZERO, USAT: 10_000n })).toBe(0n);
  });
});

describe("parseWithdrawForm", () => {
  const balances = { ...ZERO, USDT: 2_000_000n, WARS: 10n ** 22n };
  it("reads an amount in the asset's own currency, with a dot or a comma", () => {
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.5" }, balances)).toEqual({ ok: true, data: { asset: "USDT", amount: 1_500_000n } });
    expect(parseWithdrawForm({ asset: "WARS", amount: "1000,50" }, balances)).toEqual({
      ok: true,
      data: { asset: "WARS", amount: 1_000_500_000_000_000_000_000n },
    });
  });

  it("takes everything available when asked", () => {
    expect(parseWithdrawForm({ asset: "USDT", all: "on" }, balances)).toEqual({ ok: true, data: { asset: "USDT", amount: 1_980_000n } });
  });

  it("names the field that is wrong", () => {
    expect(parseWithdrawForm({ asset: "USAT", amount: "1" }, balances)).toEqual({ ok: false, errors: { asset: "withdraw.error.asset" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.995" }, balances)).toEqual({ ok: false, errors: { amount: "money.error.decimals" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.99" }, balances)).toEqual({ ok: false, errors: { amount: "withdraw.error.tooMuch" } });
  });
});

function deps(balances: Partial<TreasuryBalances>) {
  const signed: { to: Address; data: Hex }[] = [];
  const value: ExecutorDeps = {
    db,
    now: () => NOW,
    flags: { enabled: false, dryRun: true },
    rates: async () => ({ perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 }),
    chain: {
      readBalances: async () => ({ ...ZERO, ...balances }),
      allowance: async () => 0n,
      receipt: async () => null,
      confirmedNonce: async () => 0,
      sendRaw: async () => {},
      waitForReceipt: async () => "success",
    },
    signer: () => ({ address: getAddress(TEST_TREASURY), signDigest: vi.fn(), signTypedData: vi.fn() }),
    signTx: vi.fn<ExecutorDeps["signTx"]>(async (...args) => {
      const [, call, feeToken] = args;
      signed.push(call);
      return { hash: `0x${"77".repeat(32)}`, raw: "0x77" as Hex, nonce: 1, feeToken };
    }),
    rfq: { request: vi.fn(), cancel: vi.fn(), submit: vi.fn() },
    drip: vi.fn(async () => "0xd1" as Hex),
    allowedSpenders: [TEXTILE_REACTOR],
  };
  return { deps: value, signed };
}

async function freelancerWithWallet(personalWallet: string | null = PERSONAL) {
  const user = await seedFreelancer(db);
  await db.update(users).set({ personalWallet }).where(eq(users.id, user.id));
  return user;
}

describe("withdraw", () => {
  it("sends the amount to the personal wallet, tagged and recorded, even while the agent is off", async () => {
    const user = await freelancerWithWallet();
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n })).toEqual({
      ok: true,
      txHash: `0x${"77".repeat(32)}`,
      pending: false,
    });
    expect(signed[0].to).toBe(TOKENS.USDT.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[0].data }).args).toEqual([PERSONAL, 1_000_000n]);
    const [tx] = await db.select().from(treasuryTxs);
    expect(tx).toMatchObject({ kind: "withdraw", asset: "USDT", amountAtomic: "1000000", toAddress: PERSONAL, usdCents: 100, status: "success" });
    expect((await db.select().from(agentEvents)).map((e) => e.type)).toEqual(["withdrawn"]);
  });

  it("refuses without a personal wallet, above the available amount, or while the wallet is busy", async () => {
    const noWallet = await freelancerWithWallet(null);
    expect(await withdraw(deps({ USDT: 2_000_000n }).deps, noWallet.id, { asset: "USDT", amount: 1n })).toEqual({
      ok: false,
      error: "no_personal_wallet",
    });

    const user = await freelancerWithWallet();
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_990_000n })).toEqual({ ok: false, error: "insufficient" });

    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    await acquireWalletLock(db, wallet.id, crypto.randomUUID(), NOW);
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1n })).toEqual({ ok: false, error: "busy" });
    expect(signed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/treasury/withdraw.test.ts`
Expected: FAIL with "Failed to resolve import "./withdraw"".

- [ ] **Step 3: Implement `src/lib/treasury/withdraw.ts`**

```ts
// src/lib/treasury/withdraw.ts
import type { Hex } from "viem";
import { TOKENS } from "@/lib/chain/tokens";
import { encodeTreasuryCall, GAS_FLOOR_ATOMIC, GAS_TOKENS, pickGasToken, type GasToken } from "@/lib/chain/treasury-tx";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { isPayAsset, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal } from "@/lib/money/decimal";
import { parseFiatInput } from "@/lib/money/input";
import type { TreasuryBalances } from "./balances";
import { reconcilePending, sendTreasuryTx, settleWithdrawal, type ExecutorDeps } from "./executor";
import { claimDrip, DRIP_AMOUNT_ATOMIC } from "./gas";
import { acquireWalletLock, loadTreasuryContext, logEvent, releaseWalletLock } from "./repo";
import { usdWad } from "./value";

const isGasToken = (asset: string): asset is GasToken => (GAS_TOKENS as readonly string[]).includes(asset);

/** All of it, unless this same token must also pay the withdrawal's gas: then all but the gas floor. */
export function withdrawableAmount(asset: PayAsset, balances: TreasuryBalances): bigint {
  const balance = balances[asset];
  if (!isGasToken(asset) || pickGasToken({ ...balances, [asset]: 0n })) return balance;
  return balance > GAS_FLOOR_ATOMIC ? balance - GAS_FLOOR_ATOMIC : 0n;
}

export type WithdrawField = "asset" | "amount";
export interface WithdrawInput {
  asset: PayAsset;
  amount: bigint;
}

/** The amount is typed in the asset's own currency (dollars for USD₮, pesos for wARS). */
export function parseWithdrawForm(
  fields: Record<string, string>,
  balances: TreasuryBalances,
): FormResult<WithdrawInput, WithdrawField> {
  const asset = fields.asset;
  if (!isPayAsset(asset) || withdrawableAmount(asset, balances) === 0n) {
    return { ok: false, errors: { asset: "withdraw.error.asset" } };
  }
  const available = withdrawableAmount(asset, balances);
  if (fields.all === "on") return { ok: true, data: { asset, amount: available } };
  const errors: FieldErrors<WithdrawField> = {};
  const parsed = parseFiatInput(fields.amount ?? "");
  if (!parsed.ok) {
    errors.amount = `money.error.${parsed.error}`;
    return { ok: false, errors };
  }
  const amount = parseDecimal(parsed.value, TOKENS[asset].decimals);
  if (amount > available) return { ok: false, errors: { amount: "withdraw.error.tooMuch" } };
  return { ok: true, data: { asset, amount } };
}

export type WithdrawError = "not_ready" | "no_personal_wallet" | "busy" | "insufficient" | "needs_gas" | "failed";
export type WithdrawResult = { ok: true; txHash: Hex; pending: boolean } | { ok: false; error: WithdrawError };

/** Spec §6.2 flow 5: treasury → the freelancer's own wallet, never anywhere else (encodeTreasuryCall). */
export async function withdraw(deps: ExecutorDeps, userId: string, input: WithdrawInput): Promise<WithdrawResult> {
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx) return { ok: false, error: "not_ready" };
  const personalWallet = ctx.personalWallet;
  if (!personalWallet) return { ok: false, error: "no_personal_wallet" };
  const holder = crypto.randomUUID();
  if (!(await acquireWalletLock(deps.db, ctx.walletId, holder, deps.now()))) return { ok: false, error: "busy" };
  try {
    if ((await reconcilePending(deps, ctx)) > 0) return { ok: false, error: "busy" };
    let balances = await deps.chain.readBalances(ctx.address);
    if (input.amount <= 0n || input.amount > withdrawableAmount(input.asset, balances)) return { ok: false, error: "insufficient" };

    let feeToken = pickGasToken(balances, { asset: input.asset, amount: input.amount });
    if (!feeToken && (await claimDrip(deps.db, ctx.walletId, deps.now()))) {
      try {
        await deps.drip(ctx.address, DRIP_AMOUNT_ATOMIC);
        await logEvent(deps.db, ctx.userId, "gas_dripped", { amount: DRIP_AMOUNT_ATOMIC.toString() }, deps.now());
        balances = await deps.chain.readBalances(ctx.address);
        feeToken = pickGasToken(balances, { asset: input.asset, amount: input.amount });
      } catch (error) {
        console.error(`Gas drip to ${ctx.address} failed:`, error);
      }
    }
    if (!feeToken) return { ok: false, error: "needs_gas" };

    const call = encodeTreasuryCall(
      { kind: "withdraw", asset: input.asset, to: personalWallet, amount: input.amount },
      { allowedSpenders: deps.allowedSpenders, personalWallet },
    );
    const usdCents = await deps
      .rates()
      .then((rates) => Number(usdWad(input.asset, input.amount, rates) / 10n ** 16n))
      .catch(() => null);
    const extra = { asset: input.asset, amountAtomic: input.amount.toString(), toAddress: personalWallet, usdCents };
    const sent = await sendTreasuryTx(deps, ctx, deps.signer(ctx), "withdraw", call, feeToken, extra);
    // A missing receipt is settled (and announced) by the next run's reconciliation.
    if (sent.status === null) return { ok: true, txHash: sent.hash, pending: true };
    await settleWithdrawal(deps, { userId: ctx.userId, hash: sent.hash, asset: input.asset, amountAtomic: extra.amountAtomic }, sent.status);
    return sent.status === "success" ? { ok: true, txHash: sent.hash, pending: false } : { ok: false, error: "failed" };
  } finally {
    await releaseWalletLock(deps.db, ctx.walletId, holder);
  }
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/treasury/withdraw.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Expose the personal wallet on `AppUser`**

In `src/lib/users/queries.ts`, add to `AppUser` after `treasuryAddress`:

```ts
  /** The freelancer's own Para wallet, the only withdrawal destination (spec §6.1). */
  personalWallet: Address | null;
```

In `loadAppUser`'s return object, add after `treasuryAddress`:

```ts
    personalWallet: row.user.personalWallet ? getAddress(row.user.personalWallet) : null,
```

In `src/lib/users/queries.test.ts`, add `personalWallet: null,` after `treasuryAddress: TEST_TREASURY,` in the first test's expected object.

- [ ] **Step 6: Add the strings to `src/i18n/en.ts`**

Before the closing `} as const;`:

```ts
  "withdraw.title": "Withdraw to your wallet",
  "withdraw.intro": "Move money from your agent's account to your own Cobro wallet. Only you control that wallet.",
  "withdraw.asset": "What to withdraw",
  "withdraw.available": "Available",
  "withdraw.amount": "Amount",
  "withdraw.amountHelp": "In the currency you picked. Digits only, with a dot or comma before the cents.",
  "withdraw.all": "Withdraw everything available",
  "withdraw.destination": "Goes to your Cobro wallet",
  "withdraw.address": "Wallet address",
  "withdraw.submit": "Withdraw",
  "withdraw.sending": "Sending… This takes a few seconds.",
  "withdraw.sent": "Sent. The money is in your Cobro wallet.",
  "withdraw.pending": "Sent to the network. It will show up in a few minutes.",
  "withdraw.viewTx": "View on Celoscan",
  "withdraw.back": "Back to home",
  "withdraw.empty": "There is nothing to withdraw yet.",
  "withdraw.notReady": "Your wallet is still being set up. Try again in a minute.",
  "withdraw.error.asset": "Choose what to withdraw.",
  "withdraw.error.tooMuch": "That is more than is available.",
  "withdraw.error.not_ready": "Your wallet is still being set up. Try again in a minute.",
  "withdraw.error.no_personal_wallet": "We don't know your Cobro wallet yet. Sign out, sign in again, then retry.",
  "withdraw.error.busy": "Your agent is busy with another transaction. Try again in a minute.",
  "withdraw.error.insufficient": "That is more than is available now. Refresh and try again.",
  "withdraw.error.needs_gas": "Your agent can't pay the network fee right now. Try again tomorrow.",
  "withdraw.error.failed": "The network rejected the withdrawal, so no money moved. Try again.",
```

- [ ] **Step 7: Write the Server Action `src/app/app/withdraw/actions.ts`**

```ts
"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { formFields, type FieldErrors } from "@/lib/forms";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { parseWithdrawForm, withdraw, type WithdrawError, type WithdrawField } from "@/lib/treasury/withdraw";

export interface WithdrawState {
  errors: FieldErrors<WithdrawField>;
  values: Record<string, string>;
  outcome: { kind: "sent"; txHash: string; pending: boolean } | { kind: "error"; error: WithdrawError } | null;
}

export async function withdrawAction(_previous: WithdrawState, formData: FormData): Promise<WithdrawState> {
  const user = await requireUser();
  const fields = formFields(formData);
  if (!user.treasuryAddress) return { errors: {}, values: fields, outcome: { kind: "error", error: "not_ready" } };
  const deps = liveExecutorDeps();
  const parsed = parseWithdrawForm(fields, await deps.chain.readBalances(user.treasuryAddress));
  if (!parsed.ok) return { errors: parsed.errors, values: fields, outcome: null };
  const result = await withdraw(deps, user.id, parsed.data);
  if (!result.ok) return { errors: {}, values: fields, outcome: { kind: "error", error: result.error } };
  refresh();
  return { errors: {}, values: { asset: fields.asset }, outcome: { kind: "sent", txHash: result.txHash, pending: result.pending } };
}
```

- [ ] **Step 8: Write the form `src/app/app/withdraw/withdraw-form.tsx`**

```tsx
"use client";

import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { Money } from "@/components/money";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { PayAsset } from "@/lib/money/currencies";
import type { DisplayAmount } from "@/lib/money/display";
import { withdrawAction, type WithdrawState } from "./actions";

export interface WithdrawOption {
  asset: PayAsset;
  label: string;
  available: DisplayAmount;
}

export function WithdrawForm({ options, destination }: { options: WithdrawOption[]; destination: string | null }) {
  const [state, action] = useActionState(withdrawAction, {
    errors: {},
    values: { asset: options[0].asset },
    outcome: null,
  } satisfies WithdrawState);
  const amountHelp = t("withdraw.amountHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2" aria-describedby={state.errors.asset ? "asset-error" : undefined}>
        <legend className="mb-2 text-sm font-medium">{t("withdraw.asset")}</legend>
        {options.map((option) => (
          <label
            key={option.asset}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-card px-4 py-3 has-checked:border-primary has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="asset"
                value={option.asset}
                defaultChecked={(state.values.asset ?? options[0].asset) === option.asset}
                className="size-4 accent-primary"
              />
              <span className="font-medium">{option.label}</span>
            </span>
            <span className="flex flex-col items-end text-right">
              <span className="text-xs text-muted-foreground">{t("withdraw.available")}</span>
              <Money amount={option.available} />
            </span>
          </label>
        ))}
        {state.errors.asset && (
          <p id="asset-error" role="alert" className="text-sm text-destructive">
            {t(state.errors.asset)}
          </p>
        )}
      </fieldset>

      <FormField id="amount" label={t("withdraw.amount")} help={amountHelp} error={state.errors.amount}>
        <Input
          {...fieldA11y("amount", { help: amountHelp, error: state.errors.amount })}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={state.values.amount ?? ""}
          className="h-11 w-48 text-base tabular-nums"
        />
      </FormField>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" name="all" defaultChecked={state.values.all === "on"} className="size-4 accent-primary" />
        {t("withdraw.all")}
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <p>{t("withdraw.destination")}</p>
        {destination && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
            <p className="text-muted-foreground">{t("withdraw.address")}</p>
            <p className="break-all font-mono">{destination}</p>
          </details>
        )}
      </div>

      <SubmitButton pendingLabel={t("withdraw.sending")}>{t("withdraw.submit")}</SubmitButton>

      <div aria-live="polite">
        {state.outcome?.kind === "sent" && (
          <div className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
            <p className="flex items-start gap-2 text-success">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {state.outcome.pending ? t("withdraw.pending") : t("withdraw.sent")}
            </p>
            <a
              href={`https://celoscan.io/tx/${state.outcome.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 w-fit items-center gap-1 text-primary underline underline-offset-4"
            >
              {t("withdraw.viewTx")}
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
            <Link href="/app" className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4">
              {t("withdraw.back")}
            </Link>
          </div>
        )}
        {state.outcome?.kind === "error" && (
          <p role="alert" className="flex items-start gap-2 text-destructive">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t(`withdraw.error.${state.outcome.error}` as const)}
          </p>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 9: Write the page `src/app/app/withdraw/page.tsx`**

```tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { PAY_ASSETS } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { tokenFiatAmount } from "@/lib/treasury/value";
import { withdrawableAmount } from "@/lib/treasury/withdraw";
import { WithdrawForm } from "./withdraw-form";

export const metadata: Metadata = { title: `${t("withdraw.title")} · ${t("app.name")}` };
/** The withdrawal Server Action waits for a Celo receipt (a few seconds). */
export const maxDuration = 120;

export default function WithdrawPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">{t("withdraw.title")}</h1>
      <p className="max-w-prose text-muted-foreground">{t("withdraw.intro")}</p>
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <Withdraw />
      </Suspense>
    </main>
  );
}

async function Withdraw() {
  const user = await requireUser();
  if (!user.treasuryAddress) return <p role="status">{t("withdraw.notReady")}</p>;
  const [balances, rates] = await Promise.all([
    liveExecutorDeps().chain.readBalances(user.treasuryAddress),
    getReferenceRatesOrNull(),
  ]);
  const options = PAY_ASSETS.filter((asset) => withdrawableAmount(asset, balances) > 0n).map((asset) => {
    const { amount, currency } = tokenFiatAmount(asset, withdrawableAmount(asset, balances));
    return { asset, label: t(`asset.${asset}.name` as const), available: displayAmount(amount, currency, user.localCurrency, rates) };
  });
  if (options.length === 0) return <p className="text-muted-foreground">{t("withdraw.empty")}</p>;
  return <WithdrawForm options={options} destination={user.personalWallet} />;
}
```

- [ ] **Step 10: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass; the build lists `ƒ /app/withdraw`.

By hand (dev server, signed in on the Neon dev branch): `/app/withdraw` shows either "There is nothing to withdraw yet." or one option per non-zero balance. The available amounts show the local currency first. The wallet address appears only under "Details". Do not submit: a real withdrawal is a mainnet transaction and belongs to Task 17.

```bash
git add src/lib/treasury/withdraw.ts src/lib/treasury/withdraw.test.ts src/app/app/withdraw src/lib/users/queries.ts src/lib/users/queries.test.ts src/i18n/en.ts
git commit -m "feat(treasury): withdraw to the freelancer's own wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: P&L, volume and repeat-client queries

**Files:**
- Create: `src/lib/treasury/pnl.ts`, `src/lib/treasury/pnl.test.ts`, `src/lib/treasury/stats.ts`, `src/lib/treasury/stats.test.ts`
- Modify: `src/lib/fx/rates.ts`, `src/lib/payments/invoice-claim.ts`, `src/lib/payments/invoice-claim.test.ts`, `src/lib/payments/deps.ts`

**Interfaces:**
- Consumes:
  - Task 3: `usdWad`, `atomicForUsdWad`, `LOCAL_ASSET`.
  - Task 7: `TreasuryBalances`.
  - Task 1: `payments.ratesSnapshot`, `treasuryTxs`, `fxTrades`.
  - `recordPayment`, `ReferenceRates`.
- Produces:
  - `snapshotRates(rates: ReferenceRates | null): Record<string, string> | null` (in `fx/rates.ts`).
  - `recordPayment(db, p: { …; ratesSnapshot?: Record<string, string> | null })`.
  - `interface PaymentForPnl { asset: PayAsset; amountAtomic: bigint; ratesSnapshot: Record<string, string> | null }`.
  - `ratesAtPayment(snapshot, now): ReferenceRates` and `heldInLocalUsdWad(p, local, now): bigint`.
  - `treasuryUsdWad(balances, rates): bigint`.
  - `interface ProtectedValue { actualUsdWad; heldUsdWad; protectedUsdWad }` and `protectedValue({ balances, withdrawnUsdWad, payments, local, rates }): ProtectedValue`.
  - `paymentsForPnl(db, userId): Promise<PaymentForPnl[]>` and `withdrawnUsdWad(db, userId): Promise<bigint>`.
  - `interface VolumeStats { requested; quoted; filled; filledUsdCents }` and `volumeStats(db, userId): Promise<VolumeStats>`.
  - `recentConversions(db, userId, limit = 10): Promise<FxTradeRow[]>`.
  - `interface RepeatClient { recurringId; clientName; interval; paidCount; payerCount; lastPaidAt: Date | null }` and `repeatClients(db, userId): Promise<RepeatClient[]>`.

Spec §10.5 "protected value" = the treasury's USD value today, plus what was withdrawn (valued when it left), minus what the payments would be worth today had each been converted to the local currency on arrival and held. A payment recorded before snapshots existed counts at today's rate, which means no protection is claimed for it.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/treasury/pnl.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { heldInLocalUsdWad, protectedValue, treasuryUsdWad } from "./pnl";
import { WAD } from "./value";

const NOW_RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const pesos = (n: bigint) => n * 10n ** 18n;

describe("heldInLocalUsdWad", () => {
  it("converts a dollar payment to pesos at the rate it arrived at, then values those pesos today", () => {
    // US$100 at ARS 1,000 → ARS 100,000, worth US$62.50 at today's ARS 1,600.
    const payment = { asset: "USDT" as const, amountAtomic: 100_000_000n, ratesSnapshot: { ARS: "1000", BRL: "4" } };
    expect(heldInLocalUsdWad(payment, "ARS", NOW_RATES)).toBe(62n * WAD + WAD / 2n);
  });

  it("values a local-currency payment as it is, and an old payment without a snapshot at today's rate", () => {
    expect(heldInLocalUsdWad({ asset: "WARS", amountAtomic: pesos(160_000n), ratesSnapshot: null }, "ARS", NOW_RATES)).toBe(100n * WAD);
    expect(heldInLocalUsdWad({ asset: "USDT", amountAtomic: 100_000_000n, ratesSnapshot: null }, "ARS", NOW_RATES)).toBe(100n * WAD);
  });

  it("goes through dollars for the other local currency", () => {
    // 50 wBRL at BRL 4 = US$12.50 → ARS 12,500 → US$7.8125 today.
    const payment = { asset: "WBRL" as const, amountAtomic: pesos(50n), ratesSnapshot: { ARS: "1000", BRL: "4" } };
    expect(heldInLocalUsdWad(payment, "ARS", NOW_RATES)).toBe(7_812_500_000_000_000_000n);
  });
});

describe("protectedValue", () => {
  it("compares what the agent holds (plus withdrawals) with holding pesos", () => {
    const payments = [{ asset: "USDT" as const, amountAtomic: 100_000_000n, ratesSnapshot: { ARS: "1000" } }];
    expect(protectedValue({ balances: { ...ZERO, USDT: 100_000_000n }, withdrawnUsdWad: 0n, payments, local: "ARS", rates: NOW_RATES })).toEqual({
      actualUsdWad: 100n * WAD,
      heldUsdWad: 62n * WAD + WAD / 2n,
      protectedUsdWad: 37n * WAD + WAD / 2n,
    });
    expect(
      protectedValue({ balances: { ...ZERO, USDT: 90_000_000n }, withdrawnUsdWad: 10n * WAD, payments, local: "ARS", rates: NOW_RATES }).actualUsdWad,
    ).toBe(100n * WAD);
  });

  it("leaves gas money (USDC) out of the treasury value", () => {
    expect(treasuryUsdWad({ ...ZERO, USDC: 50_000n, WARS: pesos(1_600n) }, NOW_RATES)).toBe(WAD);
  });
});
```

```ts
// src/lib/treasury/stats.test.ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { fxTrades, invoices, payments, recurringInvoices, treasuryTxs } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import { paymentsForPnl, recentConversions, repeatClients, volumeStats, withdrawnUsdWad } from "./stats";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const T = (time: string) => new Date(`2026-10-15T${time}Z`);

describe("stats", () => {
  it("reads one freelancer's payments, withdrawals and RFQ volume", async () => {
    const user = await seedFreelancer(db);
    const other = await seedFreelancer(db);
    const invoice = await seedInvoice(db, user.id);
    const foreign = await seedInvoice(db, other.id);
    await db.insert(payments).values([
      { invoiceId: invoice.id, payer: "0xa", asset: "USDT", amountAtomic: "5", txHash: "0x1", ratesSnapshot: { ARS: "1600" } },
      { invoiceId: foreign.id, payer: "0xb", asset: "USDT", amountAtomic: "9", txHash: "0x2" },
    ]);
    expect(await paymentsForPnl(db, user.id)).toEqual([{ asset: "USDT", amountAtomic: 5n, ratesSnapshot: { ARS: "1600" } }]);

    const tx = { userId: user.id, kind: "withdraw", raw: "0x", feeToken: "USDT" } as const;
    await db.insert(treasuryTxs).values([
      { ...tx, nonce: 1, hash: "0xw1", status: "success", usdCents: 150 },
      { ...tx, nonce: 2, hash: "0xw2", status: "reverted", usdCents: 999 },
    ]);
    expect(await withdrawnUsdWad(db, user.id)).toBe(15n * 10n ** 17n);

    const trade = { userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1" } as const;
    await db.insert(fxTrades).values([
      { ...trade, status: "no_quote" },
      { ...trade, status: "rejected" },
      { ...trade, status: "filled", notionalUsdCents: 200, filledAt: T("10:00:00") },
      { ...trade, status: "filled", notionalUsdCents: 300, filledAt: T("11:00:00") },
    ]);
    expect(await volumeStats(db, user.id)).toEqual({ requested: 4, quoted: 3, filled: 2, filledUsdCents: 500 });
    expect((await recentConversions(db, user.id)).map((t) => t.notionalUsdCents)).toEqual([300, 200]);
  });

  it("groups payments per recurring template with distinct payers", async () => {
    const user = await seedFreelancer(db);
    const [template] = await db
      .insert(recurringInvoices)
      .values({
        slug: "rec1",
        userId: user.id,
        clientName: "Acme",
        description: "Maintenance",
        amount: "100",
        currency: "USD",
        interval: "weekly",
        anchorDay: 1,
        nextIssueAt: T("12:00:00"),
      })
      .returning();
    const [a, b] = await db
      .insert(invoices)
      .values([
        { slug: "p1", userId: user.id, recurringId: template.id, periodStart: T("00:00:00"), clientName: "Acme", description: "m", amount: "100", currency: "USD", status: "paid" },
        { slug: "p2", userId: user.id, recurringId: template.id, periodStart: T("01:00:00"), clientName: "Acme", description: "m", amount: "100", currency: "USD", status: "paid" },
      ])
      .returning();
    await db.insert(payments).values([
      { invoiceId: a.id, payer: "0xAbC", asset: "USAT", amountAtomic: "1", txHash: "0x3", settledAt: T("09:00:00") },
      { invoiceId: b.id, payer: "0xabc", asset: "USAT", amountAtomic: "1", txHash: "0x4", settledAt: T("10:00:00") },
    ]);
    expect(await repeatClients(db, user.id)).toEqual([
      { recurringId: template.id, clientName: "Acme", interval: "weekly", paidCount: 2, payerCount: 1, lastPaidAt: T("10:00:00") },
    ]);
  });
});
```

Append inside `describe("recordPayment", …)` in `src/lib/payments/invoice-claim.test.ts`:

```ts
  it("keeps the reference rates the payment arrived at, for the P&L", async () => {
    await recordPayment(db, {
      invoiceId,
      payer: "0x9999999999999999999999999999999999999999",
      asset: "USDT",
      amountAtomic: 1n,
      txHash: `0x${"cd".repeat(32)}`,
      now: at("12:00:20"),
      ratesSnapshot: { ARS: "1600", BRL: "5" },
    });
    const [row] = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    expect(row.ratesSnapshot).toEqual({ ARS: "1600", BRL: "5" });
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/treasury/pnl.test.ts src/lib/treasury/stats.test.ts src/lib/payments/invoice-claim.test.ts`
Expected: FAIL. `./pnl` and `./stats` do not resolve. `ratesSnapshot` is `null` (or a type error) in the new `recordPayment` test.

- [ ] **Step 3: Snapshot the rates when a payment is recorded**

Append to `src/lib/fx/rates.ts`:

```ts
/** Local units per USD as decimal strings, stored with each payment for the P&L (spec §10.5). */
export function snapshotRates(rates: ReferenceRates | null): Record<string, string> | null {
  if (!rates) return null;
  return Object.fromEntries(
    Object.entries(rates.perUsd).map(([currency, rate]) => [currency, formatDecimal(rate, RATE_DECIMALS)]),
  );
}
```

and change its decimal import to `import { formatDecimal, parseDecimal, RATE_DECIMALS } from "@/lib/money/decimal";`.

In `src/lib/payments/invoice-claim.ts`, extend `recordPayment`'s parameter type with `ratesSnapshot?: Record<string, string> | null;`, and add `ratesSnapshot: p.ratesSnapshot ?? null,` to the inserted values.

In `src/lib/payments/deps.ts`, import `getReferenceRatesOrNull` and `snapshotRates` from `@/lib/fx/rates`, and replace the `record` line with:

```ts
    record: async (payment) =>
      recordPayment(db, { ...payment, now: new Date(), ratesSnapshot: snapshotRates(await getReferenceRatesOrNull()) }),
```

- [ ] **Step 4: Implement `src/lib/treasury/pnl.ts`**

```ts
// src/lib/treasury/pnl.ts
import type { ReferenceRates } from "@/lib/fx/rates";
import { LOCAL_CURRENCIES, type LocalCurrency, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal, RATE_DECIMALS } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { atomicForUsdWad, LOCAL_ASSET, usdWad } from "./value";

export interface PaymentForPnl {
  asset: PayAsset;
  amountAtomic: bigint;
  ratesSnapshot: Record<string, string> | null;
}

/** The reference rates when a payment arrived; today's for any currency the snapshot lacks. */
export function ratesAtPayment(snapshot: Record<string, string> | null, now: ReferenceRates): ReferenceRates {
  const perUsd = { ...now.perUsd };
  for (const currency of LOCAL_CURRENCIES) {
    const value = snapshot?.[currency];
    if (!value) continue;
    try {
      perUsd[currency] = parseDecimal(value, RATE_DECIMALS);
    } catch {
      // a malformed snapshot falls back to today's rate
    }
  }
  return { perUsd, fetchedAt: now.fetchedAt };
}

/** What the payment would be worth today had it been turned into `local` on arrival and held (spec §10.5). */
export function heldInLocalUsdWad(payment: PaymentForPnl, local: LocalCurrency, now: ReferenceRates): bigint {
  const localAsset = LOCAL_ASSET[local];
  if (payment.asset === localAsset) return usdWad(localAsset, payment.amountAtomic, now);
  const then = ratesAtPayment(payment.ratesSnapshot, now);
  const localAtomic = atomicForUsdWad(localAsset, usdWad(payment.asset, payment.amountAtomic, then), then);
  return usdWad(localAsset, localAtomic, now);
}

const BUCKET_ASSETS = ["USDT", "USAT", "WARS", "WBRL"] as const;

/** The pay assets only: USDC in a treasury is gas money, not savings. */
export function treasuryUsdWad(balances: TreasuryBalances, rates: ReferenceRates): bigint {
  return BUCKET_ASSETS.reduce((sum, asset) => sum + usdWad(asset, balances[asset], rates), 0n);
}

export interface ProtectedValue {
  actualUsdWad: bigint;
  heldUsdWad: bigint;
  protectedUsdWad: bigint;
}

export function protectedValue(input: {
  balances: TreasuryBalances;
  withdrawnUsdWad: bigint;
  payments: PaymentForPnl[];
  local: LocalCurrency;
  rates: ReferenceRates;
}): ProtectedValue {
  const actualUsdWad = treasuryUsdWad(input.balances, input.rates) + input.withdrawnUsdWad;
  const heldUsdWad = input.payments.reduce((sum, p) => sum + heldInLocalUsdWad(p, input.local, input.rates), 0n);
  return { actualUsdWad, heldUsdWad, protectedUsdWad: actualUsdWad - heldUsdWad };
}
```

- [ ] **Step 5: Implement `src/lib/treasury/stats.ts`**

```ts
// src/lib/treasury/stats.ts
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  fxTrades,
  invoices,
  payments,
  recurringInvoices,
  treasuryTxs,
  type FxTradeRow,
  type RecurringInterval,
} from "@/lib/db/schema";
import type { PaymentForPnl } from "./pnl";

export async function paymentsForPnl(db: Db, userId: string): Promise<PaymentForPnl[]> {
  const rows = await db
    .select({ asset: payments.asset, amountAtomic: payments.amountAtomic, ratesSnapshot: payments.ratesSnapshot })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(eq(invoices.userId, userId));
  return rows.map((row) => ({ asset: row.asset, amountAtomic: BigInt(row.amountAtomic), ratesSnapshot: row.ratesSnapshot ?? null }));
}

/** Successful withdrawals, valued in USD when they left (treasury_txs.usd_cents). */
export async function withdrawnUsdWad(db: Db, userId: string): Promise<bigint> {
  const [row] = await db
    .select({ cents: sql`coalesce(sum(${treasuryTxs.usdCents}), 0)`.mapWith(String) })
    .from(treasuryTxs)
    .where(and(eq(treasuryTxs.userId, userId), eq(treasuryTxs.kind, "withdraw"), eq(treasuryTxs.status, "success")));
  return BigInt(row.cents) * 10n ** 16n;
}

export interface VolumeStats {
  requested: number;
  quoted: number;
  filled: number;
  filledUsdCents: number;
}

/** Spec §10.5 volume: RFQs requested, quoted, filled, and filled notional. */
export async function volumeStats(db: Db, userId: string): Promise<VolumeStats> {
  const [row] = await db
    .select({
      requested: sql`count(*)`.mapWith(Number),
      quoted: sql`count(*) filter (where ${fxTrades.status} <> 'no_quote')`.mapWith(Number),
      filled: sql`count(*) filter (where ${fxTrades.status} = 'filled')`.mapWith(Number),
      filledUsdCents: sql`coalesce(sum(${fxTrades.notionalUsdCents}) filter (where ${fxTrades.status} = 'filled'), 0)`.mapWith(Number),
    })
    .from(fxTrades)
    .where(eq(fxTrades.userId, userId));
  return row;
}

export async function recentConversions(db: Db, userId: string, limit = 10): Promise<FxTradeRow[]> {
  return db
    .select()
    .from(fxTrades)
    .where(and(eq(fxTrades.userId, userId), eq(fxTrades.status, "filled")))
    .orderBy(desc(fxTrades.filledAt))
    .limit(limit);
}

export interface RepeatClient {
  recurringId: string;
  clientName: string;
  interval: RecurringInterval;
  paidCount: number;
  payerCount: number;
  lastPaidAt: Date | null;
}

/** Spec §9.1: payments grouped per recurring template, with distinct paying wallets (Track 3 repeat flow). */
export async function repeatClients(db: Db, userId: string): Promise<RepeatClient[]> {
  const lastPaid = sql`max(${payments.settledAt})`;
  const rows = await db
    .select({
      recurringId: recurringInvoices.id,
      clientName: recurringInvoices.clientName,
      interval: recurringInvoices.interval,
      paidCount: sql`count(distinct ${payments.id})`.mapWith(Number),
      payerCount: sql`count(distinct lower(${payments.payer}))`.mapWith(Number),
      lastPaidAt: lastPaid.mapWith((value: string | Date | null) => (value === null ? null : new Date(value))),
    })
    .from(recurringInvoices)
    .leftJoin(invoices, eq(invoices.recurringId, recurringInvoices.id))
    .leftJoin(payments, eq(payments.invoiceId, invoices.id))
    .where(eq(recurringInvoices.userId, userId))
    .groupBy(recurringInvoices.id)
    .orderBy(desc(recurringInvoices.createdAt));
  return rows.map((row) => ({ ...row, lastPaidAt: row.lastPaidAt ?? null }));
}
```

- [ ] **Step 6: Run to see them pass**

Run: `npx vitest run src/lib/treasury/pnl.test.ts src/lib/treasury/stats.test.ts src/lib/payments`
Expected: PASS. If `lastPaidAt` comes back as a string under PGlite, the `mapWith` above converts it. Check the assertion against `T("10:00:00")`, which is a `Date`.

- [ ] **Step 7: Full suite and commit**

Run: `npm test && npm run typecheck`
Expected: all pass.

```bash
git add src/lib/treasury/pnl.ts src/lib/treasury/pnl.test.ts src/lib/treasury/stats.ts src/lib/treasury/stats.test.ts src/lib/fx/rates.ts src/lib/payments/invoice-claim.ts src/lib/payments/invoice-claim.test.ts src/lib/payments/deps.ts
git commit -m "feat(treasury): value protected, volume and repeat-client figures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Explanations and the activity, conversions and repeat-client sections

**Files:**
- Create: `src/lib/treasury/explain.ts`, `src/lib/treasury/explain.test.ts`, `src/lib/invoices/dates.test.ts`, `src/app/app/activity-feed.tsx`, `src/app/app/conversions.tsx`, `src/app/app/repeat-clients.tsx`
- Modify: `src/lib/invoices/dates.ts`, `src/i18n/en.ts`, `src/app/app/page.tsx`

**Interfaces:**
- Consumes:
  - Task 1: `AgentEventType`.
  - Task 3: `tokenFiatAmount`.
  - Task 4: `Decision`, `IdleReason`.
  - Task 8: `listEvents`.
  - Task 12: `recentConversions`, `volumeStats`, `repeatClients`.
  - `displayAmount`, `getReferenceRatesOrNull`, `AppUser`.
- Produces:
  - `type EventTone = "success" | "warning" | "alert" | "info"` and `interface EventView { tone; title: string; why: string; txHash: string | null }`.
  - `moneyText(asset: unknown, atomic: unknown, ctx: ExplainContext): string` and `percentText(bps: unknown): string`.
  - `describeEvent(event: { type: AgentEventType; data: Record<string, unknown> }, ctx): EventView`.
  - `describeDecision(decision: Decision, ctx): string`.
  - `interface ExplainContext { local: LocalCurrency | null; rates: ReferenceRates | null }`.
  - `formatDateTime(date: Date, locale?): string`.
  - Components `ActivityFeed`, `Conversions` and `RepeatClients`, each `({ user }: { user: AppUser })`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/treasury/explain.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import { describeDecision, describeEvent, moneyText, percentText } from "./explain";

const rates: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ctx = { local: "ARS" as const, rates };
// Intl puts a no-break space between a currency code and the number.
const NBSP = "\u00A0";

describe("moneyText and percentText", () => {
  it("shows token amounts in the freelancer's currency first", () => {
    expect(moneyText("WARS", "3200000000000000000000", ctx)).toBe(`ARS${NBSP}3,200`);
    expect(moneyText("USDT", "2000000", ctx)).toBe(`≈ ARS${NBSP}3,200`);
    expect(moneyText("USDT", "2000000", { local: null, rates: null })).toBe("US$2.00");
    expect(moneyText("DAI", "1", ctx)).toBe("some money");
  });

  it("writes basis points as a percentage", () => {
    expect(percentText(50)).toBe("0.50%");
    expect(percentText(150)).toBe("1.50%");
    expect(percentText(undefined)).toBe("0.00%");
  });
});

describe("describeEvent", () => {
  it("explains a conversion with its reason and price", () => {
    const view = describeEvent(
      {
        type: "converted",
        data: { from: "WARS", to: "USDT", amount: "3200000000000000000000", slippageBps: 50, reason: "save_excess", txHash: "0xabc" },
      },
      ctx,
    );
    expect(view).toEqual({
      tone: "success",
      title: `Converted ARS${NBSP}3,200 to dollars`,
      why: "Your spending money was above the reserve you set, so the agent saved the extra in dollars to protect it from inflation. The rate was 0.50% below the market rate, within your limit.",
      txHash: "0xabc",
    });
  });

  it("explains waiting, blocking and withdrawals", () => {
    const waiting = describeEvent(
      { type: "waiting", data: { from: "WARS", amount: "3200000000000000000000", slippageBps: 500, limitBps: 50 } },
      ctx,
    );
    expect(waiting.title).toBe("Waiting for a better rate");
    expect(waiting.why).toContain("5.00% below the market rate. Your limit is 0.50%");
    expect(describeEvent({ type: "blocked", data: {} }, ctx).tone).toBe("alert");
    expect(describeEvent({ type: "withdrawn", data: { asset: "USDT", amount: "2000000", txHash: "0x1" } }, ctx).title).toBe(
      `Sent ≈ ARS${NBSP}3,200 to your wallet`,
    );
  });
});

describe("describeDecision", () => {
  it("says what the agent would do now", () => {
    expect(describeDecision({ kind: "none", reason: "within_band" }, ctx)).toBe(
      "do nothing: your spending money is within the range you set.",
    );
    expect(
      describeDecision(
        { kind: "convert", from: "USDT", to: "WARS", amount: 10_000_000n, usdWad: 10n ** 19n, reason: "top_up" },
        ctx,
      ),
    ).toBe(
      `convert ≈ ARS${NBSP}16,000 to pesos. Your spending money fell below the reserve you set, so the agent refilled it from your savings.`,
    );
  });
});
```

```ts
// src/lib/invoices/dates.test.ts
import { describe, expect, it } from "vitest";
import { formatDateTime } from "./dates";

describe("formatDateTime", () => {
  it("prints a timestamp in UTC and says so", () => {
    expect(formatDateTime(new Date("2026-10-15T15:04:00Z"))).toBe("Oct 15, 2026, 3:04 PM UTC");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/treasury/explain.test.ts src/lib/invoices/dates.test.ts`
Expected: FAIL. `./explain` does not resolve, and `formatDateTime` is not exported.

- [ ] **Step 3: Add `formatDateTime` to `src/lib/invoices/dates.ts`**

```ts
/** "Oct 15, 2026, 3:04 PM UTC" for activity timestamps. The server renders it, so it says UTC. */
export function formatDateTime(value: Date, locale = "en-US"): string {
  return `${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value)} UTC`;
}
```

- [ ] **Step 4: Add the strings to `src/i18n/en.ts`**

Before the closing `} as const;`:

```ts
  "event.someMoney": "some money",
  "event.target.USD": "dollars",
  "event.target.ARS": "pesos",
  "event.target.BRL": "reais",
  "event.why.save_excess":
    "Your spending money was above the reserve you set, so the agent saved the extra in dollars to protect it from inflation.",
  "event.why.save_other": "You were paid in a currency you don't spend in, so the agent saved it in dollars.",
  "event.why.top_up": "Your spending money fell below the reserve you set, so the agent refilled it from your savings.",
  "event.why.hub_route":
    "Your savings were in USA₮, which can't be turned into pesos directly, so the agent first moved them to USD₮. The second step follows on its next check.",
  "event.why.generic": "The agent followed the rules you set.",
  "event.price.worse": "The rate was {pct} below the market rate, within your limit.",
  "event.price.better": "The rate was at or better than the market rate.",
  "event.converted.title": "Converted {amount} to {target}",
  "event.dry_run.title": "Would convert {amount} to {target}",
  "event.dry_run.why": "The agent is in test mode, so nothing was moved.",
  "event.waiting.title": "Waiting for a better rate",
  "event.waiting.why":
    "The best offer for {amount} was {pct} below the market rate. Your limit is {limit}, so the agent will check again every 10 minutes.",
  "event.blocked.title": "Needs your attention",
  "event.blocked.why":
    "After waiting, the best offer for {amount} was still {pct} below the market rate, more than your hard limit of {limit}. The agent stopped this conversion. You can raise the limit in Agent settings, or wait for the market to recover.",
  "event.no_quote.title": "No offer right now",
  "event.no_quote.why": "Nobody offered to convert {amount} at the moment. The agent will try again soon.",
  "event.policy_rejected.title": "Offer refused",
  "event.policy_rejected.why":
    "An offer did not match the agent's safety rules (wrong wallet, contract or amount), so the agent refused to sign it.",
  "event.swap_failed.title": "A conversion didn't go through",
  "event.swap_failed.why": "The network rejected the conversion, so no money moved. The agent will try again.",
  "event.gas_dripped.title": "Network fees covered",
  "event.gas_dripped.why":
    "Your agent's account needed a little money for network fees, so Cobro sent it US$0.05. You don't pay for this.",
  "event.needs_gas.title": "Paused: no network fees",
  "event.needs_gas.why": "Your agent's account has nothing to pay network fees with today. It will try again tomorrow.",
  "event.withdrawn.title": "Sent {amount} to your wallet",
  "event.withdrawn.why": "You asked to move this money to your own Cobro wallet.",
  "event.withdraw_failed.title": "A withdrawal didn't go through",
  "event.withdraw_failed.why": "The network rejected the withdrawal, so no money moved. Try again.",
  "event.paused.title": "Agent paused",
  "event.paused.why": "You paused the agent. It won't convert anything until you resume it.",
  "event.resumed.title": "Agent resumed",
  "event.resumed.why": "You resumed the agent. It checks your money every 10 minutes and after each payment.",
  "event.payment_reconciled.title": "Payment confirmed",
  "event.payment_reconciled.why":
    "A client's payment reached your account, but its confirmation was delayed. The agent found it and marked the invoice paid.",
  "preview.within_band": "do nothing: your spending money is within the range you set.",
  "preview.daily_cap": "wait: it has reached today's conversion limit.",
  "preview.below_minimum": "do nothing: the amount is below the US$1 minimum for a conversion.",
  "preview.no_dollars": "wait: your spending money is low, but there are no savings to refill it from.",
  "preview.convert": "convert {amount} to {target}. {why}",
  "activity.title": "What your agent did",
  "activity.empty": "Nothing yet. Your agent checks your money every 10 minutes and after each payment.",
  "activity.why": "Why?",
  "activity.viewTx": "View on Celoscan",
  "conversions.title": "Conversions",
  "conversions.empty": "No conversions yet.",
  "conversions.row": "{from} → {to}",
  "conversions.volume": "{filled} of {requested} requests filled",
  "repeat.title": "Repeat clients",
  "repeat.paidOnce": "Paid once",
  "repeat.paidMany": "Paid {count} times",
  "repeat.payerOne": "from 1 wallet",
  "repeat.payerMany": "from {count} wallets",
  "repeat.notYet": "Not paid yet",
  "repeat.lastPaid": "Last paid {date}",
```

- [ ] **Step 5: Implement `src/lib/treasury/explain.ts`**

```ts
// src/lib/treasury/explain.ts
import { t, type MessageKey } from "@/i18n";
import type { AgentEventType } from "@/lib/db/schema";
import type { ReferenceRates } from "@/lib/fx/rates";
import { isPayAsset, type LocalCurrency } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import type { Decision, IdleReason } from "./engine";
import { tokenFiatAmount } from "./value";

export interface ExplainContext {
  local: LocalCurrency | null;
  rates: ReferenceRates | null;
}

export type EventTone = "success" | "warning" | "alert" | "info";

export interface EventView {
  tone: EventTone;
  title: string;
  why: string;
  txHash: string | null;
}

/** A token amount as people read it: local currency first (spec §17.1 principle 2), never raw units. */
export function moneyText(asset: unknown, atomic: unknown, ctx: ExplainContext): string {
  if (!isPayAsset(asset) || typeof atomic !== "string" || !/^\d+$/.test(atomic)) return t("event.someMoney");
  const { amount, currency } = tokenFiatAmount(asset, BigInt(atomic));
  return displayAmount(amount, currency, ctx.local, ctx.rates).primary;
}

/** Basis points as a percentage with two decimals ("0.50%"). */
export function percentText(bps: unknown): string {
  const value = typeof bps === "number" && bps > 0 ? Math.round(bps) : 0;
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

function targetText(asset: unknown): string {
  if (asset === "WARS") return t("event.target.ARS");
  if (asset === "WBRL") return t("event.target.BRL");
  return t("event.target.USD");
}

const REASONS: Record<string, MessageKey> = {
  save_excess: "event.why.save_excess",
  save_other: "event.why.save_other",
  top_up: "event.why.top_up",
  hub_route: "event.why.hub_route",
};
const reasonText = (reason: unknown) => t(REASONS[String(reason)] ?? "event.why.generic");

/** The activity feed's title and "Why?" text for one event (spec §17.1 principle 4). */
export function describeEvent(event: { type: AgentEventType; data: Record<string, unknown> }, ctx: ExplainContext): EventView {
  const d = event.data;
  const amount = moneyText(d.from ?? d.asset, d.amount, ctx);
  const txHash = typeof d.txHash === "string" ? d.txHash : null;
  const simple = (tone: EventTone, key: "policy_rejected" | "swap_failed" | "gas_dripped" | "needs_gas" | "withdraw_failed" | "paused" | "resumed" | "payment_reconciled"): EventView => ({
    tone,
    title: t(`event.${key}.title`),
    why: t(`event.${key}.why`),
    txHash,
  });
  switch (event.type) {
    case "converted": {
      const bps = typeof d.slippageBps === "number" ? d.slippageBps : 0;
      const price = bps > 0 ? t("event.price.worse", { pct: percentText(bps) }) : t("event.price.better");
      return { tone: "success", title: t("event.converted.title", { amount, target: targetText(d.to) }), why: `${reasonText(d.reason)} ${price}`, txHash };
    }
    case "dry_run":
      return {
        tone: "info",
        title: t("event.dry_run.title", { amount, target: targetText(d.to) }),
        why: `${reasonText(d.reason)} ${t("event.dry_run.why")}`,
        txHash: null,
      };
    case "waiting":
      return {
        tone: "warning",
        title: t("event.waiting.title"),
        why: t("event.waiting.why", { amount, pct: percentText(d.slippageBps), limit: percentText(d.limitBps) }),
        txHash: null,
      };
    case "blocked":
      return {
        tone: "alert",
        title: t("event.blocked.title"),
        why: t("event.blocked.why", { amount, pct: percentText(d.slippageBps), limit: percentText(d.limitBps) }),
        txHash: null,
      };
    case "no_quote":
      return { tone: "warning", title: t("event.no_quote.title"), why: t("event.no_quote.why", { amount }), txHash: null };
    case "withdrawn":
      return { tone: "success", title: t("event.withdrawn.title", { amount }), why: t("event.withdrawn.why"), txHash };
    case "policy_rejected":
      return simple("alert", "policy_rejected");
    case "swap_failed":
      return simple("alert", "swap_failed");
    case "withdraw_failed":
      return simple("alert", "withdraw_failed");
    case "needs_gas":
      return simple("warning", "needs_gas");
    case "gas_dripped":
      return simple("info", "gas_dripped");
    case "paused":
      return simple("info", "paused");
    case "resumed":
      return simple("info", "resumed");
    case "payment_reconciled":
      return simple("success", "payment_reconciled");
  }
}

const IDLE: Record<IdleReason, MessageKey> = {
  within_band: "preview.within_band",
  daily_cap: "preview.daily_cap",
  below_minimum: "preview.below_minimum",
  no_dollars: "preview.no_dollars",
};

/** Completes "If the agent ran now, it would …" on the rules page (spec §17.2). */
export function describeDecision(decision: Decision, ctx: ExplainContext): string {
  if (decision.kind === "none") return t(IDLE[decision.reason]);
  return t("preview.convert", {
    amount: moneyText(decision.from, decision.amount.toString(), ctx),
    target: targetText(decision.to),
    why: reasonText(decision.reason),
  });
}
```

- [ ] **Step 6: Run to see them pass**

Run: `npx vitest run src/lib/treasury/explain.test.ts src/lib/invoices/dates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Write the three dashboard sections**

```tsx
// src/app/app/activity-feed.tsx
import { CircleAlert, CircleCheck, Clock, ExternalLink, Info } from "lucide-react";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDateTime } from "@/lib/invoices/dates";
import { describeEvent, type EventTone } from "@/lib/treasury/explain";
import { listEvents } from "@/lib/treasury/repo";
import type { AppUser } from "@/lib/users/queries";

const TONES: Record<EventTone, { icon: typeof Info; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: Clock, className: "text-warning" },
  alert: { icon: CircleAlert, className: "text-destructive" },
  info: { icon: Info, className: "text-muted-foreground" },
};

/** Spec §17.1 principle 4: every entry says what happened and, under "Why?", why. */
export async function ActivityFeed({ user }: { user: AppUser }) {
  const [events, rates] = await Promise.all([listEvents(getDb(), user.id, 20), getReferenceRatesOrNull()]);
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h2 id="activity-heading" className="text-lg font-semibold">
        {t("activity.title")}
      </h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground">{t("activity.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
            const view = describeEvent(event, { local: user.localCurrency, rates });
            const { icon: Icon, className } = TONES[view.tone];
            return (
              <li key={event.id} className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
                <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${className}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-medium">{view.title}</p>
                  <time dateTime={event.createdAt.toISOString()} className="text-sm text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </time>
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("activity.why")}</summary>
                    <p className="max-w-prose">{view.why}</p>
                    {view.txHash && (
                      <a
                        href={`https://celoscan.io/tx/${view.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
                      >
                        {t("activity.viewTx")}
                        <ExternalLink aria-hidden="true" className="size-4" />
                      </a>
                    )}
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

```tsx
// src/app/app/conversions.tsx
import { ExternalLink } from "lucide-react";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDateTime } from "@/lib/invoices/dates";
import { moneyText, percentText } from "@/lib/treasury/explain";
import { recentConversions, volumeStats } from "@/lib/treasury/stats";
import type { AppUser } from "@/lib/users/queries";

/** Spec §10.5: each conversion with its price against the market rate, and the RFQ volume. */
export async function Conversions({ user }: { user: AppUser }) {
  const db = getDb();
  const [trades, volume, rates] = await Promise.all([recentConversions(db, user.id), volumeStats(db, user.id), getReferenceRatesOrNull()]);
  const ctx = { local: user.localCurrency, rates };
  return (
    <section aria-labelledby="conversions-heading" className="flex flex-col gap-3">
      <h2 id="conversions-heading" className="text-lg font-semibold">
        {t("conversions.title")}
      </h2>
      {trades.length === 0 ? (
        <p className="text-muted-foreground">{t("conversions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {trades.map((trade) => (
            <li key={trade.id} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
              <p className="font-medium tabular-nums">
                {t("conversions.row", {
                  from: moneyText(trade.sellAsset, trade.sellAmount, ctx),
                  to: moneyText(trade.buyAsset, trade.buyAmount, ctx),
                })}
              </p>
              {trade.filledAt && <p className="text-sm text-muted-foreground">{formatDateTime(trade.filledAt)}</p>}
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
                <p>
                  {(trade.slippageBps ?? 0) > 0
                    ? t("event.price.worse", { pct: percentText(trade.slippageBps) })
                    : t("event.price.better")}
                </p>
                {trade.swapTxHash && (
                  <a
                    href={`https://celoscan.io/tx/${trade.swapTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
                  >
                    {t("activity.viewTx")}
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </a>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      {volume.requested > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("conversions.volume", { filled: volume.filled, requested: volume.requested })}
        </p>
      )}
    </section>
  );
}
```

```tsx
// src/app/app/repeat-clients.tsx
import { Repeat } from "lucide-react";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/invoices/dates";
import { repeatClients } from "@/lib/treasury/stats";
import type { AppUser } from "@/lib/users/queries";

/** Spec §9.1: payments per recurring template and how many wallets paid them. Hidden without templates. */
export async function RepeatClients({ user }: { user: AppUser }) {
  const clients = await repeatClients(getDb(), user.id);
  if (clients.length === 0) return null;
  return (
    <section aria-labelledby="repeat-heading" className="flex flex-col gap-3">
      <h2 id="repeat-heading" className="text-lg font-semibold">
        {t("repeat.title")}
      </h2>
      <ul className="flex flex-col gap-3">
        {clients.map((client) => (
          <li key={client.recurringId} className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
            <Repeat aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">{client.clientName}</p>
              <p className="text-sm text-muted-foreground">
                {client.paidCount === 0
                  ? t("repeat.notYet")
                  : `${client.paidCount === 1 ? t("repeat.paidOnce") : t("repeat.paidMany", { count: client.paidCount })} ${
                      client.payerCount === 1 ? t("repeat.payerOne") : t("repeat.payerMany", { count: client.payerCount })
                    }`}
              </p>
              {client.lastPaidAt && (
                <p className="text-sm text-muted-foreground">{t("repeat.lastPaid", { date: formatDate(client.lastPaidAt) })}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 8: Add the sections to the dashboard**

In `src/app/app/page.tsx`, add imports:

```ts
import { ActivityFeed } from "./activity-feed";
import { Conversions } from "./conversions";
import { RepeatClients } from "./repeat-clients";
```

At the end of the fragment returned by `Home`, after the invoices `</section>`, add:

```tsx
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <RepeatClients user={user} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <ActivityFeed user={user} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <Conversions user={user} />
      </Suspense>
```

- [ ] **Step 9: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

By hand (dev server, signed in): `/app` shows "What your agent did" with "Nothing yet…", or the dry-run entries from Task 10's manual check, each with a working "Why?" disclosure. It shows "Conversions" with "No conversions yet." A recurring client appears under "Repeat clients". At 375px nothing scrolls sideways.

```bash
git add src/lib/treasury/explain.ts src/lib/treasury/explain.test.ts src/lib/invoices/dates.ts src/lib/invoices/dates.test.ts src/i18n/en.ts src/app/app/activity-feed.tsx src/app/app/conversions.tsx src/app/app/repeat-clients.tsx src/app/app/page.tsx
git commit -m "feat(dashboard): activity feed with explanations, conversions and repeat clients

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Balances, value protected and agent status on the dashboard

**Files:**
- Create: `src/lib/treasury/view.ts`, `src/lib/treasury/view.test.ts`, `src/app/app/treasury-summary.tsx`, `src/app/app/agent-status.tsx`, `src/app/app/agent-toggle.tsx`
- Modify: `src/app/app/actions.ts`, `src/app/app/page.tsx`, `src/i18n/en.ts`

**Interfaces:**
- Consumes:
  - Task 12: `protectedValue`, `treasuryUsdWad`, `paymentsForPnl`, `withdrawnUsdWad`, `PaymentForPnl`.
  - Task 3: `tokenFiatAmount`, `usdWadToDollars`, `fiatToAtomic`, `usdWad`, `LOCAL_ASSET`.
  - Task 10: `liveExecutorDeps`.
  - Task 13: `describeEvent`.
  - Task 8: `listEvents`, `logEvent`.
  - `getReferenceRates`, `parseServerEnv`, `rules`.
- Produces:
  - `interface TreasuryView { local; totalUsd: string; spending: string; reserve: string; reservePercent: number | null; savingsUsd: string; protectedUsd: string; protectedNegative: boolean }`.
  - `buildTreasuryView(input: { balances; rates; rules: { localCurrency; reserveAmount }; payments; withdrawnUsdWad }): TreasuryView`.
  - `loadTreasuryView(user: AppUser): Promise<{ view: TreasuryView; rates: ReferenceRates } | null>`.
  - `type AgentState = "off" | "paused" | "dry_run" | "active"` and `agentState({ globalEnabled, dryRun, userEnabled }): AgentState`.
  - Server Action `setAgentEnabled(formData)`.
  - Components `TreasurySummary`, `AgentStatus` and `AgentToggle`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/treasury/view.test.ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { agentState, buildTreasuryView } from "./view";

const rates: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const pesos = (n: bigint) => n * 10n ** 18n;

describe("buildTreasuryView", () => {
  it("gives the dashboard its figures", () => {
    const view = buildTreasuryView({
      balances: { ...ZERO, WARS: pesos(80_000n), USDT: 50_000_000n, USAT: 10_000_000n, USDC: 40_000n },
      rates,
      rules: { localCurrency: "ARS", reserveAmount: "160000.00" },
      payments: [{ asset: "USDT", amountAtomic: 100_000_000n, ratesSnapshot: { ARS: "1000" } }],
      withdrawnUsdWad: 0n,
    });
    expect(view).toEqual({
      local: "ARS",
      totalUsd: "110.00",
      spending: "80000.00",
      reserve: "160000.00",
      reservePercent: 50,
      savingsUsd: "60.00",
      protectedUsd: "47.50",
      protectedNegative: false,
    });
  });

  it("hides the reserve bar without a reserve, caps it at 100% and reports a shortfall", () => {
    const base = { rates, payments: [], withdrawnUsdWad: 0n };
    expect(
      buildTreasuryView({ ...base, balances: { ...ZERO, WARS: pesos(5n) }, rules: { localCurrency: "ARS", reserveAmount: "0.00" } }).reservePercent,
    ).toBeNull();
    expect(
      buildTreasuryView({ ...base, balances: { ...ZERO, WARS: pesos(500n) }, rules: { localCurrency: "ARS", reserveAmount: "100.00" } }).reservePercent,
    ).toBe(100);
    const behind = buildTreasuryView({
      ...base,
      payments: [{ asset: "WARS", amountAtomic: pesos(3_200n), ratesSnapshot: null }],
      balances: ZERO,
      rules: { localCurrency: "ARS", reserveAmount: "0.00" },
    });
    expect(behind).toMatchObject({ protectedUsd: "2.00", protectedNegative: true });
  });
});

describe("agentState", () => {
  it("shows the most restrictive switch", () => {
    expect(agentState({ globalEnabled: false, dryRun: true, userEnabled: true })).toBe("off");
    expect(agentState({ globalEnabled: true, dryRun: true, userEnabled: false })).toBe("paused");
    expect(agentState({ globalEnabled: true, dryRun: true, userEnabled: true })).toBe("dry_run");
    expect(agentState({ globalEnabled: true, dryRun: false, userEnabled: true })).toBe("active");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/treasury/view.test.ts`
Expected: FAIL with "Failed to resolve import "./view"".

- [ ] **Step 3: Implement `src/lib/treasury/view.ts`**

```ts
// src/lib/treasury/view.ts
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { getReferenceRates, type ReferenceRates } from "@/lib/fx/rates";
import type { LocalCurrency } from "@/lib/money/currencies";
import type { AppUser } from "@/lib/users/queries";
import type { TreasuryBalances } from "./balances";
import { liveExecutorDeps } from "./live";
import { protectedValue, treasuryUsdWad, type PaymentForPnl } from "./pnl";
import { paymentsForPnl, withdrawnUsdWad } from "./stats";
import { fiatToAtomic, LOCAL_ASSET, tokenFiatAmount, usdWad, usdWadToDollars } from "./value";

/** Dashboard figures as decimal strings ready for displayAmount (spec §17.2 Dashboard). */
export interface TreasuryView {
  local: LocalCurrency;
  /** Pay assets in USD; USDC gas money is left out. */
  totalUsd: string;
  /** Local-currency balance (the "Spending" bucket), in the local currency. */
  spending: string;
  reserve: string;
  /** How full the spending reserve is, 0–100; null when no reserve is set. */
  reservePercent: number | null;
  /** USD₮ + USA₮ (the "Savings" bucket). */
  savingsUsd: string;
  /** Absolute value; protectedNegative says whether holding pesos would have been better. */
  protectedUsd: string;
  protectedNegative: boolean;
}

export function buildTreasuryView(input: {
  balances: TreasuryBalances;
  rates: ReferenceRates;
  rules: { localCurrency: LocalCurrency; reserveAmount: string };
  payments: PaymentForPnl[];
  withdrawnUsdWad: bigint;
}): TreasuryView {
  const { balances, rates } = input;
  const local = input.rules.localCurrency;
  const asset = LOCAL_ASSET[local];
  const reserveAtomic = fiatToAtomic(input.rules.reserveAmount, asset);
  const pnl = protectedValue({ balances, withdrawnUsdWad: input.withdrawnUsdWad, payments: input.payments, local, rates });
  const filled = reserveAtomic === 0n ? null : (balances[asset] * 100n) / reserveAtomic;
  return {
    local,
    totalUsd: usdWadToDollars(treasuryUsdWad(balances, rates)),
    spending: tokenFiatAmount(asset, balances[asset]).amount,
    reserve: input.rules.reserveAmount,
    reservePercent: filled === null ? null : Number(filled > 100n ? 100n : filled),
    savingsUsd: usdWadToDollars(usdWad("USDT", balances.USDT, rates) + usdWad("USAT", balances.USAT, rates)),
    protectedUsd: usdWadToDollars(pnl.protectedUsdWad < 0n ? -pnl.protectedUsdWad : pnl.protectedUsdWad),
    protectedNegative: pnl.protectedUsdWad < 0n,
  };
}

/** Live: chain balances, Textile rates and the P&L inputs. Null until the wallet and rules exist; throws if a read fails. */
export async function loadTreasuryView(user: AppUser): Promise<{ view: TreasuryView; rates: ReferenceRates } | null> {
  if (!user.treasuryAddress || !user.localCurrency) return null;
  const db = getDb();
  const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
  if (!row) return null;
  const [balances, rates, payments, withdrawn] = await Promise.all([
    liveExecutorDeps().chain.readBalances(user.treasuryAddress),
    getReferenceRates(),
    paymentsForPnl(db, user.id),
    withdrawnUsdWad(db, user.id),
  ]);
  return { view: buildTreasuryView({ balances, rates, rules: row, payments, withdrawnUsdWad: withdrawn }), rates };
}

export type AgentState = "off" | "paused" | "dry_run" | "active";

/** Spec §17.1 principle 4: Active / Paused / Dry run is always visible ("off" = the global switch). */
export function agentState(input: { globalEnabled: boolean; dryRun: boolean; userEnabled: boolean }): AgentState {
  if (!input.globalEnabled) return "off";
  if (!input.userEnabled) return "paused";
  return input.dryRun ? "dry_run" : "active";
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/treasury/view.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the strings to `src/i18n/en.ts`**

Before the closing `} as const;`:

```ts
  "treasury.title": "Your money",
  "treasury.total": "Held by your agent",
  "treasury.spending": "Spending money ({currency})",
  "treasury.savings": "Savings (dollars)",
  "treasury.reserveLabel": "Spending reserve filled",
  "treasury.reserveOf": "Your reserve: {reserve}",
  "treasury.protected": "Value protected",
  "treasury.behind": "Behind holding {currency}",
  "treasury.protectedHelp":
    "How much more your money is worth today than if every payment had been kept in {currency} from the day it arrived.",
  "treasury.loadError": "We couldn't load your balances. Refresh the page to try again.",
  "treasury.withdraw": "Withdraw",
  "agent.title": "Your agent",
  "agent.state.active": "Active",
  "agent.state.dry_run": "Test mode",
  "agent.state.paused": "Paused",
  "agent.state.off": "Off",
  "agent.help.active": "Your agent checks your money every 10 minutes and after each payment.",
  "agent.help.dry_run": "Your agent decides what it would do, but doesn't move money yet. Its decisions appear below.",
  "agent.help.paused": "Your agent won't convert anything until you resume it.",
  "agent.help.off": "The agent is switched off for everyone while we finish testing.",
  "agent.guardrails":
    "It can convert between your currencies on Textile and send money only to your own wallet: at most {perTrade} per conversion and {daily} a day.",
  "agent.lastAction": "Last action: {title}",
  "agent.noActivity": "No actions yet.",
  "agent.pause": "Pause agent",
  "agent.resume": "Resume agent",
  "agent.working": "Saving…",
  "agent.settings": "Agent settings",
```

- [ ] **Step 6: Add the Server Action to `src/app/app/actions.ts`**

Add the imports:

```ts
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { rules } from "@/lib/db/schema";
import { logEvent } from "@/lib/treasury/repo";
```

and append:

```ts
/** The "Pause agent" / "Resume agent" control (spec §17.1 principle 4). */
export async function setAgentEnabled(formData: FormData): Promise<void> {
  const user = await requireUser();
  const enabled = formData.get("enabled") === "true";
  const db = getDb();
  const now = new Date();
  await db.update(rules).set({ enabled, updatedAt: now }).where(eq(rules.userId, user.id));
  await logEvent(db, user.id, enabled ? "resumed" : "paused", {}, now);
  refresh();
}
```

- [ ] **Step 7: Write the components**

```tsx
// src/app/app/agent-toggle.tsx
"use client";

import { LoaderCircle, Pause, Play } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { setAgentEnabled } from "./actions";

/** Outline, not primary: the screen's one primary action stays "New invoice" (MASTER.md "Buttons"). */
export function AgentToggle({ enabled }: { enabled: boolean }) {
  return (
    <form action={setAgentEnabled}>
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <ToggleButton enabled={enabled} />
    </form>
  );
}

function ToggleButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  const Icon = pending ? LoaderCircle : enabled ? Pause : Play;
  return (
    <Button type="submit" variant="outline" size="lg" className="min-h-11" disabled={pending} aria-disabled={pending}>
      <Icon aria-hidden="true" className={pending ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
      {pending ? t("agent.working") : enabled ? t("agent.pause") : t("agent.resume")}
    </Button>
  );
}
```

```tsx
// src/app/app/agent-status.tsx
import { eq } from "drizzle-orm";
import { CircleCheck, FlaskConical, Pause } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { parseServerEnv } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatMoney } from "@/lib/money/format";
import { describeEvent } from "@/lib/treasury/explain";
import { listEvents } from "@/lib/treasury/repo";
import { agentState, type AgentState } from "@/lib/treasury/view";
import type { AppUser } from "@/lib/users/queries";
import { AgentToggle } from "./agent-toggle";

const CHIPS: Record<AgentState, { icon: typeof Pause; className: string }> = {
  active: { icon: CircleCheck, className: "text-success" },
  dry_run: { icon: FlaskConical, className: "text-muted-foreground" },
  paused: { icon: Pause, className: "text-muted-foreground" },
  off: { icon: Pause, className: "text-muted-foreground" },
};

/** Spec §17.1 principles 4 and 5: the agent's state, what it may do, its last action, and a pause control. */
export async function AgentStatus({ user }: { user: AppUser }) {
  const db = getDb();
  const env = parseServerEnv();
  const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
  if (!row) return null;
  const [[last], rates] = await Promise.all([listEvents(db, user.id, 1), getReferenceRatesOrNull()]);
  const state = agentState({ globalEnabled: env.TREASURY_ENABLED, dryRun: env.TREASURY_DRY_RUN, userEnabled: row.enabled });
  const { icon: Icon, className } = CHIPS[state];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("agent.title")}</h2>
          <span
            role="status"
            className={`inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium ${className}`}
          >
            <Icon aria-hidden="true" className="size-4" />
            {t(`agent.state.${state}` as const)}
          </span>
        </div>
        <p className="text-muted-foreground">{t(`agent.help.${state}` as const)}</p>
        <p className="text-sm">
          {t("agent.guardrails", {
            perTrade: formatMoney(String(row.perTradeMaxUsd), "USD"),
            daily: formatMoney(String(row.dailyMaxUsd), "USD"),
          })}
        </p>
        <p className="text-sm">
          {last
            ? t("agent.lastAction", { title: describeEvent(last, { local: user.localCurrency, rates }).title })
            : t("agent.noActivity")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {state !== "off" && <AgentToggle enabled={row.enabled} />}
          <Link href="/app/rules" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">
            {t("agent.settings")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
```

```tsx
// src/app/app/treasury-summary.tsx
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import { displayAmount } from "@/lib/money/display";
import { formatMoney } from "@/lib/money/format";
import { loadTreasuryView } from "@/lib/treasury/view";
import type { AppUser } from "@/lib/users/queries";

const secondaryLink =
  "inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-primary px-4 font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Spec §17.2 Dashboard: total in local currency, Spending and Savings buckets with a reserve bar, value protected. */
export async function TreasurySummary({ user }: { user: AppUser }) {
  let loaded: Awaited<ReturnType<typeof loadTreasuryView>>;
  try {
    loaded = await loadTreasuryView(user);
  } catch (error) {
    console.error("Treasury view failed:", error instanceof Error ? error.message : error);
    return (
      <p role="alert" className="flex items-start gap-2 text-destructive">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        {t("treasury.loadError")}
      </p>
    );
  }
  if (!loaded) return null;
  const { view, rates } = loaded;
  const local = view.local;
  const currencyName = t(`event.target.${local}` as const);
  return (
    <section aria-labelledby="treasury-heading" className="flex flex-col gap-4">
      <h2 id="treasury-heading" className="sr-only">
        {t("treasury.title")}
      </h2>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("treasury.total")}</p>
          <Money size="lg" amount={displayAmount(view.totalUsd, "USD", local, rates)} />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t("treasury.spending", { currency: currencyName })}</p>
            <Money amount={displayAmount(view.spending, local, local, rates)} />
            {view.reservePercent !== null && (
              <>
                <div
                  role="progressbar"
                  aria-label={t("treasury.reserveLabel")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={view.reservePercent}
                  className="h-2 w-full rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${view.reservePercent}%` }} />
                </div>
                <p className="text-sm text-muted-foreground">{t("treasury.reserveOf", { reserve: formatMoney(view.reserve, local) })}</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t("treasury.savings")}</p>
            <Money amount={displayAmount(view.savingsUsd, "USD", local, rates)} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {view.protectedNegative ? t("treasury.behind", { currency: currencyName }) : t("treasury.protected")}
          </p>
          <Money amount={displayAmount(view.protectedUsd, "USD", local, rates)} />
          <p className="max-w-prose text-sm text-muted-foreground">{t("treasury.protectedHelp", { currency: currencyName })}</p>
        </CardContent>
      </Card>
      <Link href="/app/withdraw" className={secondaryLink}>
        {t("treasury.withdraw")}
      </Link>
    </section>
  );
}
```

- [ ] **Step 8: Put them on the dashboard**

In `src/app/app/page.tsx`, add the imports:

```ts
import { AgentStatus } from "./agent-status";
import { TreasurySummary } from "./treasury-summary";
```

In `Home`, right after `<SetupBanner status={user.treasuryStatus} />`, add:

```tsx
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <AgentStatus user={user} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TreasurySummary user={user} />
      </Suspense>
```

- [ ] **Step 9: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

By hand (dev server, signed in), `/app` shows:
- The agent card: the "Off" chip while `TREASURY_ENABLED` is unset, the "Test mode" chip with `TREASURY_ENABLED=true TREASURY_DRY_RUN=true`, and a guardrail sentence naming US$50 and US$200.
- The money cards: local currency first and USD second, and a reserve bar only when a reserve is set.
- An outline "Withdraw" link.

"Pause agent" switches the chip to "Paused" and adds "Agent paused" to the activity feed. "New invoice" is still the only filled button. At 375px nothing scrolls sideways.

```bash
git add src/lib/treasury/view.ts src/lib/treasury/view.test.ts src/app/app/treasury-summary.tsx src/app/app/agent-status.tsx src/app/app/agent-toggle.tsx src/app/app/actions.ts src/app/app/page.tsx src/i18n/en.ts
git commit -m "feat(dashboard): balances, value protected, agent status and pause control

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Rules page and the Agent tab

**Files:**
- Create: `src/lib/treasury/rules-form.ts`, `src/lib/treasury/rules-form.test.ts`, `src/app/app/rules/page.tsx`, `src/app/app/rules/rules-form.tsx`, `src/app/app/rules/actions.ts`
- Modify: `src/app/app/app-nav.tsx`, `src/i18n/en.ts`

**Interfaces:**
- Consumes:
  - Task 4: `decide`.
  - Task 6: `pickGasToken`.
  - Task 7: `spendableBalances`.
  - Task 8: `filledUsdWad24h`.
  - Task 9: `engineRules`.
  - Task 10: `liveExecutorDeps`.
  - Task 13: `describeDecision`.
  - `parseFiatInput`, `parseDecimal`, `formatDecimal`, `FormField`, `SubmitButton`, `rules`.
- Produces:
  - `type RulesField = "reserveAmount" | "maxSlippagePct" | "hardMaxSlippagePct" | "maxWaitHours" | "perTradeMaxUsd" | "dailyMaxUsd"`.
  - `interface RulesInput { reserveAmount: string; autoTopUp: boolean; maxSlippageBps: number; hardMaxSlippageBps: number; maxWaitMinutes: number; perTradeMaxUsd: number; dailyMaxUsd: number }`.
  - `parseRulesForm(fields): FormResult<RulesInput, RulesField>`.
  - `rulesFormValues(row: RulesRow): Record<string, string>`.
  - `saveRules(db, userId, input, now): Promise<void>`.
  - Page `/app/rules`, and the nav item "Agent".

Spec §17.2 Rules:
- Rules read as sentences ("Keep [300,000] ARS for spending. Save the rest in dollars.").
- The advanced settings (slippage, wait, caps) stay collapsed.
- An "If the agent ran now, it would…" preview comes from a dry run of the engine on live balances. It sends no RFQ.

Ranges:
- Normal price limit 0.05–5%.
- Hard limit from the normal limit up to 10%.
- Wait 0–48 hours.
- Per trade US$1–1,000.
- Daily from the per-trade cap up to US$5,000.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/treasury/rules-form.test.ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import { parseRulesForm, rulesFormValues, saveRules } from "./rules-form";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const VALID = {
  reserveAmount: "300000",
  autoTopUp: "on",
  maxSlippagePct: "0.5",
  hardMaxSlippagePct: "1,5",
  maxWaitHours: "6",
  perTradeMaxUsd: "50",
  dailyMaxUsd: "200",
};

describe("parseRulesForm", () => {
  it("reads the sentence and the advanced settings", () => {
    expect(parseRulesForm(VALID)).toEqual({
      ok: true,
      data: {
        reserveAmount: "300000.00",
        autoTopUp: true,
        maxSlippageBps: 50,
        hardMaxSlippageBps: 150,
        maxWaitMinutes: 360,
        perTradeMaxUsd: 50,
        dailyMaxUsd: 200,
      },
    });
  });

  it("treats an empty reserve as 0 and an unticked box as off", () => {
    const { autoTopUp: _unticked, ...rest } = VALID;
    expect(parseRulesForm({ ...rest, reserveAmount: "" })).toMatchObject({ ok: true, data: { reserveAmount: "0.00", autoTopUp: false } });
  });

  it("names every field that is out of range", () => {
    expect(
      parseRulesForm({
        reserveAmount: "1.500,50",
        maxSlippagePct: "0",
        hardMaxSlippagePct: "11",
        maxWaitHours: "49",
        perTradeMaxUsd: "0",
        dailyMaxUsd: "5001",
      }),
    ).toEqual({
      ok: false,
      errors: {
        reserveAmount: "money.error.format",
        maxSlippagePct: "rules.error.slippage",
        hardMaxSlippagePct: "rules.error.hardSlippage",
        maxWaitHours: "rules.error.wait",
        perTradeMaxUsd: "rules.error.perTrade",
        dailyMaxUsd: "rules.error.daily",
      },
    });
    expect(parseRulesForm({ ...VALID, hardMaxSlippagePct: "0.4" })).toEqual({
      ok: false,
      errors: { hardMaxSlippagePct: "rules.error.hardSlippage" },
    });
    expect(parseRulesForm({ ...VALID, dailyMaxUsd: "40" })).toEqual({ ok: false, errors: { dailyMaxUsd: "rules.error.daily" } });
  });
});

describe("saving rules", () => {
  it("stores them and shows them back as the form had them", async () => {
    const user = await seedFreelancer(db);
    const parsed = parseRulesForm(VALID);
    if (!parsed.ok) throw new Error("fixture must parse");
    await saveRules(db, user.id, parsed.data, new Date("2026-10-15T12:00:00Z"));
    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(row).toMatchObject({ reserveAmount: "300000.00", maxSlippageBps: 50, hardMaxSlippageBps: 150, maxWaitMinutes: 360 });
    expect(rulesFormValues(row)).toEqual({ ...VALID, reserveAmount: "300000.00", hardMaxSlippagePct: "1.5" });
    expect(parseRulesForm(rulesFormValues(row))).toEqual(parsed);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/treasury/rules-form.test.ts`
Expected: FAIL with "Failed to resolve import "./rules-form"".

- [ ] **Step 3: Implement `src/lib/treasury/rules-form.ts`**

```ts
// src/lib/treasury/rules-form.ts
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rules, type RulesRow } from "@/lib/db/schema";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { formatDecimal, parseDecimal } from "@/lib/money/decimal";
import { parseFiatInput } from "@/lib/money/input";

export type RulesField = "reserveAmount" | "maxSlippagePct" | "hardMaxSlippagePct" | "maxWaitHours" | "perTradeMaxUsd" | "dailyMaxUsd";

export interface RulesInput {
  reserveAmount: string;
  autoTopUp: boolean;
  maxSlippageBps: number;
  hardMaxSlippageBps: number;
  maxWaitMinutes: number;
  perTradeMaxUsd: number;
  dailyMaxUsd: number;
}

/** "0.5" or "0,5" → 50 basis points, at most two decimals; null when unreadable. */
function percentToBps(raw: string | undefined): number | null {
  const parsed = parseFiatInput(raw ?? "", { allowZero: true });
  return parsed.ok ? Number(parseDecimal(parsed.value, 2)) : null;
}

function wholeNumber(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

const within = (value: number | null, min: number, max: number): value is number => value !== null && value >= min && value <= max;

/** Spec §10.1 rules from the /app/rules form. Percentages become basis points, hours become minutes. */
export function parseRulesForm(fields: Record<string, string>): FormResult<RulesInput, RulesField> {
  const errors: FieldErrors<RulesField> = {};
  const rawReserve = (fields.reserveAmount ?? "").trim();
  const reserve = parseFiatInput(rawReserve === "" ? "0" : rawReserve, { allowZero: true });
  if (!reserve.ok) errors.reserveAmount = `money.error.${reserve.error}`;

  const maxSlippage = percentToBps(fields.maxSlippagePct);
  if (!within(maxSlippage, 5, 500)) errors.maxSlippagePct = "rules.error.slippage";
  const hardMax = percentToBps(fields.hardMaxSlippagePct);
  if (!within(hardMax, within(maxSlippage, 5, 500) ? maxSlippage : 5, 1000)) errors.hardMaxSlippagePct = "rules.error.hardSlippage";
  const waitHours = wholeNumber(fields.maxWaitHours);
  if (!within(waitHours, 0, 48)) errors.maxWaitHours = "rules.error.wait";
  const perTrade = wholeNumber(fields.perTradeMaxUsd);
  if (!within(perTrade, 1, 1000)) errors.perTradeMaxUsd = "rules.error.perTrade";
  const daily = wholeNumber(fields.dailyMaxUsd);
  if (!within(daily, within(perTrade, 1, 1000) ? perTrade : 1, 5000)) errors.dailyMaxUsd = "rules.error.daily";

  if (
    !reserve.ok ||
    Object.keys(errors).length > 0 ||
    maxSlippage === null ||
    hardMax === null ||
    waitHours === null ||
    perTrade === null ||
    daily === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      reserveAmount: reserve.value,
      autoTopUp: fields.autoTopUp === "on",
      maxSlippageBps: maxSlippage,
      hardMaxSlippageBps: hardMax,
      maxWaitMinutes: waitHours * 60,
      perTradeMaxUsd: perTrade,
      dailyMaxUsd: daily,
    },
  };
}

/** The stored rules as the form shows them (the inverse of parseRulesForm). */
export function rulesFormValues(row: RulesRow): Record<string, string> {
  return {
    reserveAmount: row.reserveAmount,
    autoTopUp: row.autoTopUp ? "on" : "",
    maxSlippagePct: formatDecimal(BigInt(row.maxSlippageBps), 2),
    hardMaxSlippagePct: formatDecimal(BigInt(row.hardMaxSlippageBps), 2),
    maxWaitHours: String(Math.round(row.maxWaitMinutes / 60)),
    perTradeMaxUsd: String(row.perTradeMaxUsd),
    dailyMaxUsd: String(row.dailyMaxUsd),
  };
}

export async function saveRules(db: Db, userId: string, input: RulesInput, now: Date): Promise<void> {
  await db.update(rules).set({ ...input, updatedAt: now }).where(eq(rules.userId, userId));
}
```

`rulesFormValues` writes `autoTopUp: ""` for an unticked box. The round-trip assertion uses `VALID`, whose `autoTopUp` is `"on"`.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/treasury/rules-form.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the strings to `src/i18n/en.ts`**

Before the closing `} as const;`:

```ts
  "nav.agent": "Agent",
  "rules.title": "Agent rules",
  "rules.intro": "Tell your agent how much to keep for spending. It saves the rest in dollars and converts only at fair prices.",
  "rules.reserveHelp": "Your agent keeps about this much in your currency and saves the rest in dollars.",
  "rules.autoTopUp": "Refill my spending money from savings when it runs low",
  "rules.advanced": "Advanced settings",
  "rules.maxSlippage": "Normal price limit (%)",
  "rules.maxSlippageHelp": "Convert only when the rate is at most this much below the market rate. From 0.05 to 5.",
  "rules.hardMaxSlippage": "Price limit after waiting (%)",
  "rules.hardMaxSlippageHelp": "After the wait below, accept up to this much below the market rate. At least the normal limit, at most 10.",
  "rules.maxWait": "Wait for a better price (hours)",
  "rules.maxWaitHelp": "How long to wait for a price within the normal limit. From 0 to 48.",
  "rules.perTrade": "Largest conversion (US$)",
  "rules.perTradeHelp": "Larger amounts are split across several conversions. From 1 to 1,000.",
  "rules.daily": "Most per day (US$)",
  "rules.dailyHelp": "At least the largest conversion, at most 5,000.",
  "rules.save": "Save rules",
  "rules.saving": "Saving…",
  "rules.saved": "Saved. Your agent uses these rules from its next check.",
  "rules.preview": "If the agent ran now, it would",
  "rules.previewUnavailable": "We can't show what the agent would do right now. Your rules still apply.",
  "rules.error.slippage": "Enter a percentage from 0.05 to 5.",
  "rules.error.hardSlippage": "Enter a percentage at least as high as the normal limit, up to 10.",
  "rules.error.wait": "Enter whole hours from 0 to 48.",
  "rules.error.perTrade": "Enter whole dollars from 1 to 1,000.",
  "rules.error.daily": "Enter whole dollars, at least the largest conversion and at most 5,000.",
```

- [ ] **Step 6: Write the Server Action `src/app/app/rules/actions.ts`**

```ts
"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { formFields, type FieldErrors } from "@/lib/forms";
import { parseRulesForm, saveRules, type RulesField } from "@/lib/treasury/rules-form";

export interface RulesState {
  errors: FieldErrors<RulesField>;
  values: Record<string, string>;
  saved: boolean;
}

export async function saveRulesAction(_previous: RulesState, formData: FormData): Promise<RulesState> {
  const user = await requireUser();
  const fields = formFields(formData);
  const parsed = parseRulesForm(fields);
  if (!parsed.ok) return { errors: parsed.errors, values: fields, saved: false };
  await saveRules(getDb(), user.id, parsed.data, new Date());
  refresh();
  return { errors: {}, values: fields, saved: true };
}
```

- [ ] **Step 7: Write the form `src/app/app/rules/rules-form.tsx`**

```tsx
"use client";

import { CircleCheck } from "lucide-react";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { LocalCurrency } from "@/lib/money/currencies";
import { saveRulesAction, type RulesState } from "./actions";

const ADVANCED = [
  { id: "maxSlippagePct", label: "rules.maxSlippage", help: "rules.maxSlippageHelp", mode: "decimal" },
  { id: "hardMaxSlippagePct", label: "rules.hardMaxSlippage", help: "rules.hardMaxSlippageHelp", mode: "decimal" },
  { id: "maxWaitHours", label: "rules.maxWait", help: "rules.maxWaitHelp", mode: "numeric" },
  { id: "perTradeMaxUsd", label: "rules.perTrade", help: "rules.perTradeHelp", mode: "numeric" },
  { id: "dailyMaxUsd", label: "rules.daily", help: "rules.dailyHelp", mode: "numeric" },
] as const;

/** Spec §17.2 Rules: the reserve as a sentence, advanced settings collapsed (open when one has an error). */
export function RulesForm({ currency, values }: { currency: LocalCurrency; values: Record<string, string> }) {
  const [state, action] = useActionState(saveRulesAction, { errors: {}, values, saved: false } satisfies RulesState);
  const reserveHelp = t("rules.reserveHelp");
  const advancedError = ADVANCED.some((field) => state.errors[field.id]);

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <FormField id="reserveAmount" label={t("onboarding.reserveLabel")} help={reserveHelp} error={state.errors.reserveAmount}>
        <p className="flex flex-wrap items-center gap-2 text-base">
          <span aria-hidden="true">{t("onboarding.reserveBefore")}</span>
          <Input
            {...fieldA11y("reserveAmount", { help: reserveHelp, error: state.errors.reserveAmount })}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values.reserveAmount}
            className="h-11 w-40 text-base tabular-nums"
          />
          <span aria-hidden="true">
            {currency} {t("onboarding.reserveAfter")}
          </span>
        </p>
      </FormField>

      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" name="autoTopUp" defaultChecked={state.values.autoTopUp === "on"} className="mt-1 size-4 accent-primary" />
        <span>{t("rules.autoTopUp")}</span>
      </label>

      <details open={advancedError || undefined} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">{t("rules.advanced")}</summary>
        <div className="mt-4 flex flex-col gap-6">
          {ADVANCED.map((field) => (
            <FormField key={field.id} id={field.id} label={t(field.label)} help={t(field.help)} error={state.errors[field.id]}>
              <Input
                {...fieldA11y(field.id, { help: t(field.help), error: state.errors[field.id] })}
                inputMode={field.mode}
                autoComplete="off"
                defaultValue={state.values[field.id]}
                className="h-11 w-32 text-base tabular-nums"
              />
            </FormField>
          ))}
        </div>
      </details>

      <SubmitButton pendingLabel={t("rules.saving")}>{t("rules.save")}</SubmitButton>
      <div aria-live="polite">
        {state.saved && (
          <p className="flex items-center gap-2 text-success">
            <CircleCheck aria-hidden="true" className="size-5" />
            {t("rules.saved")}
          </p>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 8: Write the page `src/app/app/rules/page.tsx`**

```tsx
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { pickGasToken } from "@/lib/chain/treasury-tx";
import { getDb } from "@/lib/db/client";
import { rules, type RulesRow } from "@/lib/db/schema";
import { getReferenceRates } from "@/lib/fx/rates";
import { spendableBalances } from "@/lib/treasury/balances";
import { decide } from "@/lib/treasury/engine";
import { engineRules } from "@/lib/treasury/executor";
import { describeDecision } from "@/lib/treasury/explain";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { filledUsdWad24h } from "@/lib/treasury/repo";
import { rulesFormValues } from "@/lib/treasury/rules-form";
import type { AppUser } from "@/lib/users/queries";
import { RulesForm } from "./rules-form";

export const metadata: Metadata = { title: `${t("rules.title")} · ${t("app.name")}` };

export default function RulesPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">{t("rules.title")}</h1>
      <p className="max-w-prose text-muted-foreground">{t("rules.intro")}</p>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Rules />
      </Suspense>
    </main>
  );
}

async function Rules() {
  const user = await requireUser();
  const [row] = await getDb().select().from(rules).where(eq(rules.userId, user.id));
  if (!row) redirect("/app/onboarding");
  return (
    <>
      <Suspense fallback={<Skeleton className="h-16 w-full" />}>
        <Preview user={user} row={row} />
      </Suspense>
      <RulesForm currency={row.localCurrency} values={rulesFormValues(row)} />
    </>
  );
}

/** "If the agent ran now, it would…": the engine on live balances, with nothing sent anywhere. */
async function Preview({ user, row }: { user: AppUser; row: RulesRow }) {
  if (!user.treasuryAddress) return null;
  try {
    const [balances, rates, filled] = await Promise.all([
      liveExecutorDeps().chain.readBalances(user.treasuryAddress),
      getReferenceRates(),
      filledUsdWad24h(getDb(), user.id, new Date()),
    ]);
    const decision = decide({
      balances: spendableBalances(balances, pickGasToken(balances)),
      rules: engineRules(row),
      rates,
      filledUsdWad24h: filled,
    });
    return (
      <p role="status" className="rounded-xl bg-muted p-4">
        <span className="font-medium">{t("rules.preview")}</span> {describeDecision(decision, { local: row.localCurrency, rates })}
      </p>
    );
  } catch (error) {
    console.error("Rules preview failed:", error instanceof Error ? error.message : error);
    return <p className="text-muted-foreground">{t("rules.previewUnavailable")}</p>;
  }
}
```

- [ ] **Step 9: Add the Agent tab**

In `src/app/app/app-nav.tsx`, change the lucide import to `import { Bot, House, Settings } from "lucide-react";`. Delete the comment line "// Plan 3 adds "Agent" …". Make `ITEMS`:

```ts
const ITEMS: { href: string; label: MessageKey; icon: typeof House }[] = [
  { href: "/app", label: "nav.home", icon: House },
  { href: "/app/rules", label: "nav.agent", icon: Bot },
  { href: "/app/settings", label: "nav.settings", icon: Settings },
];
```

- [ ] **Step 10: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass; the build lists `ƒ /app/rules`.

By hand (dev server, signed in):
- `/app/rules` shows the "If the agent ran now, it would …" sentence, the reserve sentence, the refill checkbox, and a collapsed "Advanced settings".
- Saving `0` for the normal limit opens the advanced section with "Enter a percentage from 0.05 to 5." announced.
- Saving valid values shows "Saved…", and the preview follows the new reserve.
- The bottom bar (375px) and the sidebar (1440px) show Home, Agent and Settings, and Agent is marked current.

```bash
git add src/lib/treasury/rules-form.ts src/lib/treasury/rules-form.test.ts src/app/app/rules src/app/app/app-nav.tsx src/i18n/en.ts
git commit -m "feat(rules): agent rules page with a live preview, and the Agent tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Reconcile x402 settlements with an unknown outcome

**Files:**
- Create: `src/lib/payments/reconcile.ts`, `src/lib/payments/reconcile.test.ts`
- Modify: `src/app/api/cron/treasury/route.ts`

**Interfaces:**
- Consumes:
  - `SETTLING_HOLD_MS`, `recordPayment` and `releaseInvoice` from `invoice-claim.ts`.
  - `invoiceQuotes`, `invoices`, `treasuryWallets`, `TOKENS`.
  - Task 8: `logEvent`.
  - `createCeloPublicClient`.
- Produces:
  - `interface FoundTransfer { txHash: Hex; from: Address }`.
  - `type FindTransfer = (input: { token: Address; to: Address; amount: bigint; since: Date }) => Promise<FoundTransfer | null>`.
  - `reconcileSettlements(db, find: FindTransfer, now: Date): Promise<{ recorded: number; reopened: number }>`.
  - `logTransferFinder(client, now?): FindTransfer`.
  - The cron response gains `reconciled`.

The Plan 2 ruling stands: an invoice whose settlement outcome was unknown stays `settling` until its hold expires. The hold is longer than the payer's signed authorization stays valid on-chain. After that, the transfer can no longer land. So the cron looks once for a `Transfer` of a locked quote amount to the treasury since the claim. If it finds one, it records the payment. If not, it reopens the invoice. This also clears the Plan 2 deferred minor where the dashboard showed "Confirming payment" forever.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/payments/reconcile.test.ts
import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { agentEvents, invoiceQuotes, invoices, payments } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice, TEST_TREASURY } from "@/lib/db/testing";
import { SETTLING_HOLD_MS } from "./invoice-claim";
import { logTransferFinder, reconcileSettlements, type FindTransfer } from "./reconcile";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const PAYER: Address = "0x9999999999999999999999999999999999999999";
const TX = `0x${"ef".repeat(32)}` as Hex;

async function stuckInvoice(settlingUntil = new Date(NOW.getTime() - 60_000)) {
  const user = await seedFreelancer(db);
  const invoice = await seedInvoice(db, user.id, { status: "settling", settlingUntil });
  await db.insert(invoiceQuotes).values([
    { invoiceId: invoice.id, asset: "USDT", amountAtomic: "300000000", rate: "1", expiresAt: NOW },
    { invoiceId: invoice.id, asset: "WARS", amountAtomic: "481648500000000000000000", rate: "1605.495", expiresAt: NOW },
  ]);
  return { user, invoice };
}
const invoiceRow = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0];

describe("reconcileSettlements", () => {
  it("records a transfer that landed after an unknown outcome", async () => {
    const { user, invoice } = await stuckInvoice();
    const find = vi.fn<FindTransfer>(async ({ token }) => (token === TOKENS.USDT.address ? { txHash: TX, from: PAYER } : null));
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 1, reopened: 0 });
    expect(find).toHaveBeenCalledWith({
      token: TOKENS.USDT.address,
      to: getAddress(TEST_TREASURY),
      amount: 300_000_000n,
      since: new Date(NOW.getTime() - 60_000 - SETTLING_HOLD_MS - 60_000),
    });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "paid", settlingUntil: null });
    expect(await db.select().from(payments)).toMatchObject([{ payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX }]);
    expect((await db.select().from(agentEvents).where(eq(agentEvents.userId, user.id)))[0].type).toBe("payment_reconciled");
  });

  it("reopens the invoice when nothing arrived", async () => {
    const { invoice } = await stuckInvoice();
    expect(await reconcileSettlements(db, vi.fn<FindTransfer>(async () => null), NOW)).toEqual({ recorded: 0, reopened: 1 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "open", settlingUntil: null });
  });

  it("leaves an invoice alone while its hold is still running", async () => {
    const { invoice } = await stuckInvoice(new Date(NOW.getTime() + 60_000));
    const find = vi.fn<FindTransfer>();
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 0 });
    expect(find).not.toHaveBeenCalled();
    expect((await invoiceRow(invoice.id)).status).toBe("settling");
  });
});

describe("logTransferFinder", () => {
  it("searches the blocks since the claim for a transfer of exactly the amount", async () => {
    const client = {
      getBlockNumber: vi.fn(async () => 10_000n),
      getLogs: vi.fn(async () => [
        { args: { from: PAYER, to: TEST_TREASURY, value: 5n }, transactionHash: `0x${"01".repeat(32)}` },
        { args: { from: PAYER, to: TEST_TREASURY, value: 7n }, transactionHash: TX },
      ]),
    };
    const find = logTransferFinder(client as unknown as Parameters<typeof logTransferFinder>[0], () => NOW.getTime());
    expect(await find({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 7n, since: new Date(NOW.getTime() - 600_000) })).toEqual({
      txHash: TX,
      from: PAYER,
    });
    // 600 s back plus a 120-block margin, at one block per second.
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 9_280n, toBlock: 10_000n, args: { to: TEST_TREASURY } }));
    expect(await find({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 8n, since: new Date(NOW.getTime() - 600_000) })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/payments/reconcile.test.ts`
Expected: FAIL with "Failed to resolve import "./reconcile"".

- [ ] **Step 3: Implement `src/lib/payments/reconcile.ts`**

```ts
// src/lib/payments/reconcile.ts
import { and, eq, lt } from "drizzle-orm";
import { getAddress, parseAbiItem, type Address, type Hex } from "viem";
import type { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { invoiceQuotes, invoices, treasuryWallets, type InvoiceQuoteRow } from "@/lib/db/schema";
import { logEvent } from "@/lib/treasury/repo";
import { recordPayment, releaseInvoice, SETTLING_HOLD_MS } from "./invoice-claim";

export interface FoundTransfer {
  txHash: Hex;
  from: Address;
}
export type FindTransfer = (input: { token: Address; to: Address; amount: bigint; since: Date }) => Promise<FoundTransfer | null>;

/**
 * Plan 2 ruling on unknown x402 outcomes (spec §12): once an invoice's hold has expired, no signed
 * authorization can still land. Record the transfer if one arrived, otherwise reopen the invoice.
 */
export async function reconcileSettlements(db: Db, find: FindTransfer, now: Date): Promise<{ recorded: number; reopened: number }> {
  const stuck = await db
    .select({
      id: invoices.id,
      slug: invoices.slug,
      userId: invoices.userId,
      settlingUntil: invoices.settlingUntil,
      treasury: treasuryWallets.address,
    })
    .from(invoices)
    .innerJoin(treasuryWallets, eq(treasuryWallets.userId, invoices.userId))
    .where(and(eq(invoices.status, "settling"), lt(invoices.settlingUntil, now)));

  let recorded = 0;
  let reopened = 0;
  for (const invoice of stuck) {
    const quotes = await db.select().from(invoiceQuotes).where(eq(invoiceQuotes.invoiceId, invoice.id));
    const found =
      invoice.treasury && invoice.settlingUntil
        ? await findPayment(find, quotes, getAddress(invoice.treasury), invoice.settlingUntil)
        : null;
    if (found) {
      await recordPayment(db, {
        invoiceId: invoice.id,
        payer: found.from,
        asset: found.asset,
        amountAtomic: found.amount,
        txHash: found.txHash,
        now,
      });
      await logEvent(
        db,
        invoice.userId,
        "payment_reconciled",
        { invoiceSlug: invoice.slug, asset: found.asset, amount: found.amount.toString(), txHash: found.txHash },
        now,
      );
      recorded += 1;
    } else {
      await releaseInvoice(db, invoice.id);
      reopened += 1;
    }
  }
  return { recorded, reopened };
}

async function findPayment(find: FindTransfer, quotes: InvoiceQuoteRow[], treasury: Address, settlingUntil: Date) {
  // The claim began one hold before settlingUntil; a minute of slack covers clock differences.
  const since = new Date(settlingUntil.getTime() - SETTLING_HOLD_MS - 60_000);
  for (const quote of quotes) {
    const amount = BigInt(quote.amountAtomic);
    const hit = await find({ token: TOKENS[quote.asset].address, to: treasury, amount, since });
    if (hit) return { ...hit, asset: quote.asset, amount };
  }
  return null;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Celo makes one block per second. Never look back more than a day. */
const MAX_LOOKBACK_BLOCKS = 86_400n;
const MARGIN_BLOCKS = 120n;

export function logTransferFinder(
  client: Pick<ReturnType<typeof createCeloPublicClient>, "getBlockNumber" | "getLogs">,
  now: () => number = Date.now,
): FindTransfer {
  return async ({ token, to, amount, since }) => {
    const latest = await client.getBlockNumber();
    const back = BigInt(Math.max(0, Math.ceil((now() - since.getTime()) / 1000))) + MARGIN_BLOCKS;
    const span = back < MAX_LOOKBACK_BLOCKS ? back : MAX_LOOKBACK_BLOCKS;
    const logs = await client.getLogs({
      address: token,
      event: TRANSFER,
      args: { to },
      fromBlock: latest > span ? latest - span : 0n,
      toBlock: latest,
    });
    const hit = logs.find((log) => log.args.value === amount && log.args.from);
    return hit?.args.from ? { txHash: hit.transactionHash, from: getAddress(hit.args.from) } : null;
  };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/lib/payments/reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run it from the cron**

In `src/app/api/cron/treasury/route.ts`, add the imports:

```ts
import { createCeloPublicClient } from "@/lib/chain/clients";
import { logTransferFinder, reconcileSettlements } from "@/lib/payments/reconcile";
```

Replace the lines from `const issued = …` to the `TREASURY_ENABLED` check with:

```ts
  const env = parseServerEnv();
  const issued = await issueDueRecurring(db, new Date());
  let reconciled: { recorded: number; reopened: number } | "error";
  try {
    reconciled = await reconcileSettlements(db, logTransferFinder(createCeloPublicClient(env.CELO_RPC_URL)), new Date());
  } catch (error) {
    console.error("Settlement reconciliation failed:", error);
    reconciled = "error";
  }
  if (!env.TREASURY_ENABLED) return Response.json({ issued, reconciled, treasury: "disabled" });
```

and make the last line `return Response.json({ issued, reconciled, treasury: summarizeRuns(results) });`.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

By hand, run the cron command from Task 10 Step 5 against the dev server.
Expected: `200 {"issued":0,"reconciled":{"recorded":0,"reopened":0},"treasury":"disabled"}`.

```bash
git add src/lib/payments/reconcile.ts src/lib/payments/reconcile.test.ts src/app/api/cron/treasury/route.ts
git commit -m "feat(payments): reconcile settlements whose outcome was unknown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Ship, dry run and mainnet smoke tests (with the user)

**Files:**
- Create: `docs/superpowers/smoke/2026-10-treasury.md`
- Modify: `docs/superpowers/specs/2026-10-08-cobro-design.md`, `.superpowers/sdd/2026-10-09-plan-3-treasury/progress.md` (ledger, gitignored)

This task moves real money and changes production. Ask the user before each step marked **(ask)** and do nothing in it until they say yes. The executing skill's final whole-branch review and its fix pass happen before this task, not inside it.

- [ ] **Step 1: Gate on the branch**

Run: `npm test && npm run typecheck && npm run lint && npm run build > .superpowers/sdd/plan-3-gate.log 2>&1; tail -20 .superpowers/sdd/plan-3-gate.log`
Expected: all green; `git status --short` is clean.

- [ ] **Step 2 (ask): Decisions for the user**

Ask, in one message:
1. **Production dry run.** Spec §13 says "Dry-run on production for at least one day before live conversions". Wait a full day, or go live once a few dry-run cycles look right?
2. **Smoke funds.** The user pays a US$2.00 invoice in USD₮ from their own wallet to their production account. Their treasury `0x3c9b…1a97` then holds about 3 USD₮. The swap smoke buys about US$1.87 of wARS (reserve ARS 3,000). The withdrawal smoke then sends the wARS and the rest of the USD₮ back to their Cobro wallet. The cost is gas only (under US$0.05) plus Textile's spread.
3. **Operator top-up.** The operator `0x35A2…b43B` holds about 0.49 USDC. Each gas drip costs 0.05 USDC plus gas. Top it up now, or later?

- [ ] **Step 3 (ask): Merge locally**

```bash
git checkout main && git pull --ff-only && git merge --no-ff plan-3-treasury -m "Merge branch 'plan-3-treasury': treasury agent (Plan 3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: the gate is green on the merge. Do not push yet.

- [ ] **Step 4 (ask): Migrate the Neon main branch (production)**

`npm run db:migrate` reaches only the dev branch. Ask the user to copy the **main** branch's pooled connection string from the Neon console. Then they run this in the prompt (the `!` prefix runs it in this session; the value never prints):

```
! DATABASE_URL="$(pbpaste)" npx tsx scripts/db-migrate.ts
```

Expected: `Migrations applied`.

- [ ] **Step 5 (ask): Production env**

Push the values through stdin; never as arguments, never printed:

```bash
printf true | vercel env add TREASURY_ENABLED production --yes
printf true | vercel env add TREASURY_DRY_RUN production --yes
printf USDC | vercel env add OPERATOR_FEE_TOKEN production --yes
node --env-file=.env.local -e 'process.stdout.write(process.env.OPERATOR_PRIVATE_KEY ?? "")' | vercel env add OPERATOR_PRIVATE_KEY production --sensitive --yes
vercel env ls production
```

Expected: `vercel env ls` lists the four names (values hidden). The operator key in `.env.local` is the same server key that Plan 2's refunds used.

- [ ] **Step 6 (ask): Push and check production**

```bash
git push origin main && git branch -d plan-3-treasury
```

Poll `vercel ls cobro-agent` until the newest Production deployment is `Ready`. Then run the `/ship` probes:
- `/` → 200 and `/app` → 307 to `/signin`.
- `/api/pay/nope?asset=USDT` → 404.
- `POST /api/cron/treasury` without a bearer → 401.
- `gh workflow run treasury-cron.yml` then `gh run watch <id> --exit-status`. The log shows `{"issued":N,"reconciled":{"recorded":0,"reopened":0},"treasury":{…}}`, where the treasury counts contain only `idle`, `dry_run` or `disabled`.

- [ ] **Step 7: Dry run with the user's account**

The user signs in at `https://cobro-agent.vercel.app`. On `/app/rules` they set the reserve to `3000` (ARS) and save.

Expected:
- The preview reads "If the agent ran now, it would wait: your spending money is low, but there are no savings to refill it from.", or "convert …", depending on the balances.
- The dashboard chip shows "Test mode".
- After the next cron run, the feed shows "Would convert …" with a "Why?".

Wait as long as the user chose in Step 2.

- [ ] **Step 8 (ask): Smoke D, the first autonomous Textile swap**

1. Go live:

   ```bash
   vercel env rm TREASURY_DRY_RUN production --yes && printf false | vercel env add TREASURY_DRY_RUN production --yes
   ```

   Redeploy the latest production deployment with `vercel redeploy <url from vercel ls cobro-agent>` and wait for `Ready`.
2. The user creates a US$2.00 invoice and pays it with USD₮ from their own wallet. The payment's `after()` runs the agent, or the next cron run does.
3. Expected in the feed:
   - "Converted ≈ ARS … to pesos" with a top-up reason.
   - A "Why?" that states the price against the market rate.
   - A Celoscan link.
   
   In the DB, the `fx_trades` row is `filled`, and the `treasury_txs` approve and swap rows are `success`.
4. Run `/celo-tx-check <hash>` on the approval and on the swap. Expected for both:
   - status success, sent by the treasury;
   - gas paid in USD₮ (CIP-64);
   - **attribution tag `celo_bc3965e128ba` present**;
   - for the swap, USD₮ out and wARS in.

   If the tag is missing, stop. Set `TREASURY_DRY_RUN=true` again and report.

- [ ] **Step 9 (ask): Smoke E, a withdrawal**

On `/app/withdraw`, the user withdraws everything in wARS, then everything available in USD₮. Each one shows "Sent…" with a Celoscan link. Run `/celo-tx-check` on each.

Expected:
- A transfer from the treasury to the user's Cobro wallet (`users.personal_wallet`).
- Gas paid in USD₮ or USDC.
- The tag present.

The feed shows "Sent … to your wallet".

- [ ] **Step 10: Record the results**

Write `docs/superpowers/smoke/2026-10-treasury.md` with:
- one row per smoke: date, what was done, the tx links, the tag result and PASS/FAIL;
- the dry-run period;
- the operator balance after.

Update the spec (`docs/superpowers/specs/2026-10-08-cobro-design.md`):
- **§8.3**: `takerProof` must be fresh (`issuedAt` within 60 s), so it is signed per request. Approve and call `quote.spender`. Cite the v2 OpenAPI.
- **§8.6**: the 2026-10-09 decision. Treasury gas is CIP-64 in USD₮, then USA₮, then USDC, signed with Para `sign-raw`, plus a 0.05 USDC operator drip at most once per day. Add the Smoke D result.
- **§10.4**: the deviations from this plan's intro, items 1–7.
- **§11**: under "Added in Plan 3", list:
  - `treasury_txs`;
  - `fx_trades` as an RFQ log;
  - `agent_events` without a `message` column;
  - `fx_intents.retry_after`, with no `deadline_at`;
  - `payments.rates_snapshot`.
- **§14**: week 3 "Done <date>", with proof links to the smoke file.
- **§15**: the custom-id risk is resolved (`para:<Para user id>`, adopt before create).

Append the outcome lines to the plan's ledger.

- [ ] **Step 11 (ask): Commit and push the docs**

```bash
git add docs/superpowers/smoke/2026-10-treasury.md docs/superpowers/specs/2026-10-08-cobro-design.md
git commit -m "docs: record treasury mainnet smoke tests and Plan 3 spec updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

Ask the user whether production should stay live (`TREASURY_DRY_RUN=false`) after the smoke tests, or go back to dry run until Plan 4.
