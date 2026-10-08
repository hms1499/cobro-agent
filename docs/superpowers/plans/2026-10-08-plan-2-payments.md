# Plan 2: Invoices and x402 Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freelancer signs in with email, gets an agent-managed treasury wallet, creates one-off or recurring invoices, and a client pays one on Celo mainnet through Celo's x402 facilitator in USA₮, USD₮, wARS or wBRL, gaslessly, with the invoice marked paid.

**Architecture:** Neon Postgres through Drizzle holds users, treasury wallets, rules, invoices, quotes and payments. Domain logic lives in small modules under `src/lib/` (`db/`, `money/`, `fx/`, `auth/`, `users/`, `invoices/`, `payments/`, `cron/`) as plain functions with colocated Vitest tests. DB tests run against in-memory PGlite with the real migrations. The x402 route is our own Route Handler around `x402HTTPResourceServer` from `@x402/core`, so that we claim the invoice before settling and record the payment only after the facilitator confirms. Pages stay thin and read request data inside `<Suspense>`, because `cacheComponents` is on.

**Tech Stack:** Everything from Plan 1 (Next.js 16.4.0, React 19.3, viem 2.57.3, wagmi 3.7.7, zod 4.6.5, jose 6.2.12, @getpara/react-sdk 3.21.0, Vitest 5.0.3, tsx 4.23.15), plus drizzle-orm 0.45.3, drizzle-kit 0.31.11, @neondatabase/serverless 1.1.0, @electric-sql/pglite 0.5.8 (tests only), @x402/core 2.28.0, @x402/evm 2.28.0, @x402/extensions 2.28.0, @x402/fetch 2.28.0.

**Spec:** `docs/superpowers/specs/2026-10-08-cobro-design.md`. This plan covers milestone week 2 in §14 (§6.2 flows 1–3, §7.4 pages, §8.2, §9, §9.1, §11, §16, §17). Signer decision: `docs/superpowers/spikes/2026-10-11-para.md`. Visual rules: `design-system/cobro/MASTER.md`.

This is plan 2 of 4. Plan 3 is the treasury (TreasurySigner, gas drip, engine, executor, Textile swaps, balances and P&L on the dashboard). Plan 4 is chat, the landing page and polish. Deliberate deviations from the spec, each small:

- `TreasurySigner`, the gas drip and the "treasury run after a payment" trigger move to Plan 3. Nothing in this plan signs with a treasury wallet, so building them now would be unused code.
- `invoices.status` gains a `settling` state and a `settling_until` column. It is a short claim taken before settlement, so that two payers cannot both pay one invoice (§12 "no double charge").
- `users.display_name` (shown as "From" on the payment page instead of the freelancer's email), `treasury_wallets.status` (wallet creation is asynchronous at Para), and `recurring_invoices.anchor_day` (monthly invoices keep their day of month).
- `rules.local_currency` stores `ARS` or `BRL`. The token (wARS or wBRL) follows from it.
- USD amounts render as `US$300.00`, as in MASTER.md.
- The dashboard's grouping of payments per recurring template and its repeat-payer view (§9.1) move to Plan 3 with the rest of the dashboard. This plan stores everything they need (`invoices.recurring_id`, `payments.payer`).
- `/r/[slug]` redirects to the current period's payment page (§9.1, §6.2). Once every period is paid it lists them (§17.2).
- The payment page's "insufficient balance" state shows the wallet's balance and suggests another currency. It has no USA₮ faucet link, because USA₮ has no mainnet faucet.

## Global Constraints

- Celo mainnet only: chain id `42220`, x402 network id `eip155:42220`, RPC `https://forno.celo.org`, explorer `https://celoscan.io`.
- x402 facilitator `https://api.x402.celo.org`, header `X-API-Key` (env `X402_API_KEY`). Prices are explicit `{ asset, amount, extra }` objects, never `"$0.01"` strings. The facilitator settles and pays gas; it does not tag settlement transactions yet (spec §8.2, §15 question 1). Nothing in this plan broadcasts a transaction of our own.
- Pay assets and their EIP-712 domains come only from `TOKENS` in `src/lib/chain/tokens.ts`: USDT and USAT use EIP-3009; WARS and WBRL use Permit2 with `extra.assetTransferMethod: "permit2"` and the `eip2612GasSponsoring` extension.
- Secrets (`DATABASE_URL`, `SESSION_SECRET`, `X402_API_KEY`, `CRON_SECRET`, `PARA_API_KEY`, `OPERATOR_PRIVATE_KEY`) live only in `.env.local` (gitignored), Vercel env and GitHub Actions secrets. Never print, log or commit them.
- Next.js 16.4 runs with `cacheComponents: true`. Any component that reads `cookies()`, `params`, `searchParams` or the database sits inside `<Suspense>`, and it awaits the request value (`params`, `cookies()`) before touching the database, so nothing runs at build time. Read `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md` before Task 6.
- Exact dependency versions as listed in Tech Stack. Install with `npm install <pkg>@<version>`.
- All user-facing text goes through `t()` from `src/i18n` with keys in `src/i18n/en.ts`.
- UI follows `design-system/cobro/MASTER.md`: tokens only (no raw hex), IBM Plex, Lucide icons with `aria-hidden`, touch targets ≥ 44px (`min-h-11`), one primary button per screen, visible labels, `aria-live` for status changes, skeleton/empty/error/success states. Default views never show token units, gas, Permit2 or addresses; those live behind a "Details" disclosure.
- Every fiat amount on screen goes through `formatMoney` or `displayAmount` (Task 2–3). No component formats money by hand.
- Token amounts are `bigint` in code and base-10 strings in the database and JSON. Never floats. `Number()` is allowed only inside `formatMoney` for display.
- Tests are colocated `*.test.ts` files run by `npm test`. Unit tests never touch the network: inject `fetch`. DB tests use `createTestDb()` (PGlite with the real migrations).
- The payment page and `/r/[slug]` work without sign-in: the payer is a stranger with a browser wallet.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A client paying a real invoice (say US$300) with the stock x402 browser client is rejected before signing, because `x402Client` caps every payment at $1 by default (`spendControls.maxAmountPerPayment`). The payer client must lift that cap only for the quoted asset, amount and `payTo`, and refuse anything else. Pinned in Task 11.
2. Two payers (or one double-click, or two tabs) pay the same invoice at once. Exactly one settles; the other gets 409 before anything is settled. A failed settlement reopens the invoice; a settlement whose outcome is unknown keeps it held so nobody is invited to pay twice. Pinned in Task 10.
3. A freelancer in Buenos Aires types `1.500,50`, `1,500.50`, `1.005`, `0` or an empty amount. Each gets a clear field error; nothing is silently read as a different number. Pinned in Task 2 (and Task 7, Task 8 use the same parser).
4. Textile's tickers are one-sided (`USAT_USDT` has `ask: "0"`), zero, malformed or down. No quote is ever made at a bogus rate, USD invoices stay payable in USD₮/USA₮ without any rate, and a recent rate (≤ 10 min) is reused through a short outage. Pinned in Tasks 3 and 4.
5. A freelancer double-clicks sign-in, or two tabs post `/api/session` at once, or the server dies mid-creation. Exactly one Para treasury wallet exists per user, and a stuck creation recovers on the next sign-in. Pinned in Task 5.

---

## File Structure

```
drizzle.config.ts                          drizzle-kit config (schema → ./drizzle)
drizzle/0000_*.sql, drizzle/meta/*         generated migrations (committed)
scripts/db-migrate.ts                      applies migrations to DATABASE_URL
.github/workflows/treasury-cron.yml        calls the cron route every 10 minutes
src/proxy.ts                               redirects signed-out /app/* requests to /signin
src/lib/db/schema.ts                       tables, enums, row types
src/lib/db/client.ts                       Db type, getDb() (Neon pool)
src/lib/db/testing.ts                      createTestDb(), resetDb(), seedFreelancer() for tests
src/lib/money/currencies.ts                fiat/local/pay-asset lists, asset denomination
src/lib/money/decimal.ts                   parseDecimal, formatDecimal, ceilDiv, RATE_ONE
src/lib/money/input.ts                     parseFiatInput (form amounts)
src/lib/money/format.ts                    formatMoney, formatTokenAmount
src/lib/fx/rates.ts                        Textile tickers → ReferenceRates, cache with stale fallback
src/lib/fx/convert.ts                      fiatPerUsd, convertFiat
src/lib/money/display.ts                   displayAmount (local currency first)
src/lib/payments/quote.ts                  quoteInvoice, needsRates (pure)
src/lib/payments/quotes-repo.ts            lockQuote (10-minute rate lock)
src/lib/auth/session.ts                    signSession, verifySession, cookie options
src/lib/auth/gate.ts                       signInRedirect, safeNext (pure)
src/lib/auth/current-user.ts               getCurrentUser, requireUser (server only)
src/lib/users/provision.ts                 upsertUser, ensureTreasuryWallet
src/lib/users/queries.ts                   loadAppUser
src/lib/users/para.ts                      Para REST provider and JWKS from env
src/lib/users/onboarding.ts                parseOnboardingForm, saveOnboarding
src/lib/invoices/slug.ts                   newSlug (base58, 10 chars)
src/lib/invoices/schedule.ts               nextIssueAt (weekly/monthly)
src/lib/invoices/input.ts                  parseInvoiceForm
src/lib/invoices/repo.ts                   create/list/find invoices, recurring issuance and links
src/lib/payments/x402-server.ts            resource server, route builder, request context, processX402
src/lib/payments/invoice-claim.ts          claimInvoice, releaseInvoice, recordPayment
src/lib/payments/pay-flow.ts               preparePayment, runPayFlow (orchestration, testable)
src/lib/payments/payer-client.ts           x402 client limited to one quote (browser)
src/lib/payments/wallet-signer.ts          wagmi wallet client → x402 ClientEvmSigner
src/lib/payments/pay-state.ts              payBlocker, payErrorKey (pure, for the pay page)
src/lib/cron/auth.ts                       isAuthorizedCron (timing-safe)
src/components/providers/para-provider.tsx Para + react-query providers
src/components/money.tsx                   renders a DisplayAmount
src/components/status-chip.tsx             invoice status chip (icon + label)
src/components/copy-link.tsx               share link with copy button
src/components/ui/input.tsx, label.tsx, skeleton.tsx   shadcn
src/app/signin/page.tsx, sign-in.tsx       email sign-in
src/app/api/session/route.ts               POST create session, DELETE sign out
src/app/app/layout.tsx, app-nav.tsx        app shell (bottom bar / sidebar)
src/app/app/page.tsx                       home: setup status, invoice list
src/app/app/actions.ts                     finishSetup server action
src/app/app/onboarding/page.tsx, onboarding-form.tsx, actions.ts
src/app/app/invoices/new/page.tsx, invoice-form.tsx, actions.ts
src/app/app/invoices/[id]/page.tsx         share link, status, payments
src/app/app/settings/page.tsx, sign-out.tsx
src/app/pay/[slug]/page.tsx, pay-invoice.tsx   public payment page
src/app/r/[slug]/page.tsx                  stable link of a recurring invoice
src/app/api/pay/[slug]/route.ts            x402-protected payment endpoint
src/app/api/pay/[slug]/quote/route.ts      locked quote for the payment page
src/app/api/cron/treasury/route.ts         issues due recurring invoices (Plan 3 adds the treasury run)
docs/superpowers/smoke/2026-10-payments.md mainnet smoke results
```

Removed: `src/app/spike/para-login/*`, `src/app/api/spike/para-verify/route.ts` (replaced by the real sign-in in Task 6).

---

### Task 1: Database, schema and new environment variables

**Files:**
- Create: `drizzle.config.ts`, `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `src/lib/db/testing.ts`, `src/lib/db/schema.test.ts`, `scripts/db-migrate.ts`, `drizzle/` (generated)
- Modify: `package.json`, `src/lib/config/server.ts`, `src/lib/config/public.ts`, `src/lib/config/config.test.ts`, `.env.example`

**Interfaces:**
- Consumes: `parseServerEnv`, `requireValue`, `emptyToUndefined`, `parseOrThrow` (Plan 1).
- Produces:
  - Tables `users`, `treasuryWallets`, `rules`, `recurringInvoices`, `invoices`, `invoiceQuotes`, `payments`; enums `fiatCurrency`, `localCurrency`, `payAsset`, `invoiceStatus`, `recurringInterval`, `walletStatus`, `signerType`.
  - Row types `UserRow`, `TreasuryWalletRow`, `RulesRow`, `RecurringInvoiceRow`, `InvoiceRow`, `InvoiceQuoteRow`, `PaymentRow`; `type InvoiceStatus = "open" | "settling" | "paid" | "cancelled"`; `type RecurringInterval = "weekly" | "monthly"`.
  - `type Db = PgDatabase<PgQueryResultHKT, typeof schema>`, `getDb(): Db`.
  - Test helpers `createTestDb(): Promise<Db>`, `resetDb(db): Promise<void>`, `TEST_TREASURY`, `seedFreelancer(db, opts?: { localCurrency?; treasuryAddress?: string | null; displayName? }): Promise<UserRow>` (ready treasury `TEST_TREASURY`, rules with `localCurrency` ARS by default), `seedInvoice(db, userId, overrides?): Promise<InvoiceRow>` (open, 300.00 USD).
  - Server env: `DATABASE_URL?`, `SESSION_SECRET?` (≥ 32 chars), `X402_API_KEY?`, `X402_FACILITATOR_URL` (default `https://api.x402.celo.org`), `CRON_SECRET?` (≥ 32 chars), `TEXTILE_API_URL` (default `https://api.textilecredit.com`).
  - Public env: `NEXT_PUBLIC_PARA_API_KEY?`, `NEXT_PUBLIC_PARA_ENVIRONMENT: "BETA" | "PROD"` (default `BETA`).

- [ ] **Step 1: Create the branch and install the database libraries**

```bash
git checkout main && git pull --ff-only && git checkout -b plan-2-payments
npm install drizzle-orm@0.45.3 @neondatabase/serverless@1.1.0
npm install -D drizzle-kit@0.31.11 @electric-sql/pglite@0.5.8
```

Add two scripts to `package.json` `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx --env-file=.env.local scripts/db-migrate.ts"
```

- [ ] **Step 2: Write the failing config tests**

Append to `src/lib/config/config.test.ts`:

```ts
describe("Plan 2 server variables", () => {
  it("defaults the facilitator and Textile URLs", () => {
    const env = parseServerEnv({});
    expect(env.X402_FACILITATOR_URL).toBe("https://api.x402.celo.org");
    expect(env.TEXTILE_API_URL).toBe("https://api.textilecredit.com");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("accepts a Neon connection string", () => {
    const url = "postgresql://cobro:pw@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
    expect(parseServerEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a short session secret without echoing it", () => {
    let message = "";
    try {
      parseServerEnv({ SESSION_SECRET: "short-secret-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/SESSION_SECRET/);
    expect(message).not.toContain("short-secret-value");
  });

  it("rejects a short cron secret", () => {
    expect(() => parseServerEnv({ CRON_SECRET: "abc" })).toThrow(/CRON_SECRET/);
  });
});

describe("Para public variables", () => {
  it("defaults the Para environment to BETA and leaves the key unset", () => {
    const env = parsePublicEnv(validPublic);
    expect(env.NEXT_PUBLIC_PARA_ENVIRONMENT).toBe("BETA");
    expect(env.NEXT_PUBLIC_PARA_API_KEY).toBeUndefined();
  });

  it("rejects an unknown Para environment", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_PARA_ENVIRONMENT: "STAGING" })).toThrow(
      /NEXT_PUBLIC_PARA_ENVIRONMENT/,
    );
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/lib/config`
Expected: FAIL, `expected undefined to be 'https://api.x402.celo.org'` and the Para tests fail the same way.

- [ ] **Step 4: Add the variables to both schemas**

In `src/lib/config/server.ts`, add these keys inside `serverEnvSchema` after `PARA_JWKS_URL`:

```ts
  DATABASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, "must be at least 32 characters").optional()),
  X402_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  X402_FACILITATOR_URL: z.preprocess(emptyToUndefined, z.url().default("https://api.x402.celo.org")),
  CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, "must be at least 32 characters").optional()),
  TEXTILE_API_URL: z.preprocess(emptyToUndefined, z.url().default("https://api.textilecredit.com")),
```

In `src/lib/config/public.ts`, add to `publicEnvSchema` after `NEXT_PUBLIC_AGENT_ID`:

```ts
  NEXT_PUBLIC_PARA_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  NEXT_PUBLIC_PARA_ENVIRONMENT: z.preprocess(emptyToUndefined, z.enum(["BETA", "PROD"]).default("BETA")),
```

and to the object in `readPublicEnv()` (written out literally so Next.js inlines them):

```ts
    NEXT_PUBLIC_PARA_API_KEY: process.env.NEXT_PUBLIC_PARA_API_KEY,
    NEXT_PUBLIC_PARA_ENVIRONMENT: process.env.NEXT_PUBLIC_PARA_ENVIRONMENT,
```

If `z.url()` rejects the `postgresql://` URL in the Neon test, replace it for `DATABASE_URL` only with `z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL")`.

- [ ] **Step 5: Run the config tests to see them pass**

Run: `npx vitest run src/lib/config`
Expected: PASS (all old and new tests).

- [ ] **Step 6: Write the schema**

`src/lib/db/schema.ts`:

```ts
import {
  boolean,
  date,
  index,
  integer,
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

export const fiatCurrency = pgEnum("fiat_currency", ["USD", "ARS", "BRL"]);
export const localCurrency = pgEnum("local_currency", ["ARS", "BRL"]);
export const payAsset = pgEnum("pay_asset", ["USAT", "USDT", "WARS", "WBRL"]);
export const invoiceStatus = pgEnum("invoice_status", ["open", "settling", "paid", "cancelled"]);
export const recurringInterval = pgEnum("recurring_interval", ["weekly", "monthly"]);
export const walletStatus = pgEnum("wallet_status", ["creating", "ready", "failed"]);
export const signerType = pgEnum("signer_type", ["para", "local"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Token amounts in atomic units (up to uint256), returned by drizzle as base-10 strings. */
const atomic = (name: string) => numeric(name, { precision: 78, scale: 0 });
/** Fiat amounts with cents, returned as strings such as "300.00". */
const fiatAmount = (name: string) => numeric(name, { precision: 20, scale: 2 });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  paraUserId: text("para_user_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  personalWallet: text("personal_wallet"),
  createdAt: createdAt(),
});

export const treasuryWallets = pgTable("treasury_wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  status: walletStatus("status").notNull().default("creating"),
  signerType: signerType("signer_type").notNull().default("para"),
  paraWalletId: text("para_wallet_id"),
  address: text("address"),
  gasDrippedAt: timestamp("gas_dripped_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rules = pgTable("rules", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  localCurrency: localCurrency("local_currency").notNull(),
  reserveAmount: fiatAmount("reserve_amount").notNull().default("0"),
  autoTopUp: boolean("auto_top_up").notNull().default(true),
  maxSlippageBps: integer("max_slippage_bps").notNull().default(50),
  hardMaxSlippageBps: integer("hard_max_slippage_bps").notNull().default(150),
  maxWaitMinutes: integer("max_wait_minutes").notNull().default(360),
  perTradeMaxUsd: integer("per_trade_max_usd").notNull().default(50),
  dailyMaxUsd: integer("daily_max_usd").notNull().default(200),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientName: text("client_name").notNull(),
    description: text("description").notNull(),
    amount: fiatAmount("amount").notNull(),
    currency: fiatCurrency("currency").notNull(),
    interval: recurringInterval("interval").notNull(),
    /** Day of month (1–31) of the first issue; monthly invoices return to it when the month allows. */
    anchorDay: smallint("anchor_day").notNull(),
    nextIssueAt: timestamp("next_issue_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_due_idx").on(t.active, t.nextIssueAt)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recurringId: uuid("recurring_id").references(() => recurringInvoices.id, { onDelete: "set null" }),
    periodStart: timestamp("period_start", { withTimezone: true }),
    clientName: text("client_name").notNull(),
    description: text("description").notNull(),
    amount: fiatAmount("amount").notNull(),
    currency: fiatCurrency("currency").notNull(),
    dueDate: date("due_date"),
    status: invoiceStatus("status").notNull().default("open"),
    /** While status is "settling": the claim expires at this time (see invoice-claim.ts). */
    settlingUntil: timestamp("settling_until", { withTimezone: true }),
    createdAt: createdAt(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("invoices_recurring_period_uq").on(t.recurringId, t.periodStart),
    index("invoices_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const invoiceQuotes = pgTable(
  "invoice_quotes",
  {
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    asset: payAsset("asset").notNull(),
    amountAtomic: atomic("amount_atomic").notNull(),
    /** Tokens per one unit of the invoice currency, 18 decimals. */
    rate: numeric("rate", { precision: 60, scale: 18 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.asset] })],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    payer: text("payer").notNull(),
    asset: payAsset("asset").notNull(),
    amountAtomic: atomic("amount_atomic").notNull(),
    txHash: text("tx_hash").notNull().unique(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

export type UserRow = typeof users.$inferSelect;
export type TreasuryWalletRow = typeof treasuryWallets.$inferSelect;
export type RulesRow = typeof rules.$inferSelect;
export type RecurringInvoiceRow = typeof recurringInvoices.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceQuoteRow = typeof invoiceQuotes.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export type RecurringInterval = (typeof recurringInterval.enumValues)[number];
```

- [ ] **Step 7: Add the drizzle-kit config and generate the first migration**

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

// `generate` needs no database; `npm run db:migrate` applies the files with scripts/db-migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
```

Run: `npm run db:generate`
Expected: `drizzle/0000_<name>.sql` and `drizzle/meta/` are created; the SQL contains `CREATE TYPE "public"."invoice_status"` and `CREATE TABLE "invoices"`.

- [ ] **Step 8: Add the database client and test helpers**

`src/lib/db/client.ts`:

```ts
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import * as schema from "./schema";

/** Driver-neutral handle: Neon in the app, PGlite in tests. Transactions are PgDatabase too. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | undefined;

export function getDb(): Db {
  if (!cached) {
    const url = requireValue(parseServerEnv().DATABASE_URL, "DATABASE_URL");
    cached = drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as Db;
  }
  return cached;
}
```

`src/lib/db/testing.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

/** In-memory Postgres with the real migrations. Create once per test file; resetDb between tests. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Db;
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, treasury_wallets, rules, recurring_invoices, invoices, invoice_quotes, payments CASCADE`,
  );
}

export const TEST_TREASURY = "0x1111111111111111111111111111111111111111";

/** A signed-up, onboarded freelancer with a ready treasury wallet unless told otherwise. */
export async function seedFreelancer(
  db: Db,
  opts: { localCurrency?: "ARS" | "BRL"; treasuryAddress?: string | null; displayName?: string } = {},
): Promise<schema.UserRow> {
  const [user] = await db
    .insert(schema.users)
    .values({
      paraUserId: `para-${crypto.randomUUID()}`,
      email: "ana@example.com",
      displayName: opts.displayName ?? "Ana Diseño",
    })
    .returning();
  const address = opts.treasuryAddress === undefined ? TEST_TREASURY : opts.treasuryAddress;
  await db.insert(schema.treasuryWallets).values({
    userId: user.id,
    status: address ? "ready" : "creating",
    paraWalletId: address ? "para-wallet-1" : null,
    address,
  });
  await db.insert(schema.rules).values({ userId: user.id, localCurrency: opts.localCurrency ?? "ARS" });
  return user;
}

/** An open one-off invoice for 300.00 USD unless overridden. */
export async function seedInvoice(
  db: Db,
  userId: string,
  overrides: Partial<typeof schema.invoices.$inferInsert> = {},
): Promise<schema.InvoiceRow> {
  const [row] = await db
    .insert(schema.invoices)
    .values({
      slug: `s${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}`,
      userId,
      clientName: "Acme",
      description: "Logo",
      amount: "300",
      currency: "USD",
      ...overrides,
    })
    .returning();
  return row;
}
```

`scripts/db-migrate.ts`:

```ts
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { parseServerEnv, requireValue } from "@/lib/config/server";

async function main() {
  const pool = new Pool({ connectionString: requireValue(parseServerEnv().DATABASE_URL, "DATABASE_URL") });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("Migrations applied");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 9: Write the schema tests**

`src/lib/db/schema.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./client";
import { invoiceQuotes, payments, recurringInvoices, rules } from "./schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice as seedInvoiceIn } from "./testing";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const seedInvoice = (userId: string, overrides: Parameters<typeof seedInvoiceIn>[2] = {}) =>
  seedInvoiceIn(db, userId, overrides);

describe("schema", () => {
  it("applies the migrations and the column defaults", async () => {
    const user = await seedFreelancer(db);
    const invoice = await seedInvoice(user.id);
    expect(invoice.status).toBe("open");
    expect(invoice.amount).toBe("300.00");
    const [userRules] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(userRules).toMatchObject({ localCurrency: "ARS", reserveAmount: "0.00", perTradeMaxUsd: 50, enabled: true });
  });

  it("keeps one quote per invoice and asset", async () => {
    const user = await seedFreelancer(db);
    const invoice = await seedInvoice(user.id);
    const quote = { invoiceId: invoice.id, asset: "USDT" as const, amountAtomic: "300000000", rate: "1", expiresAt: new Date() };
    await db.insert(invoiceQuotes).values(quote);
    await expect(db.insert(invoiceQuotes).values(quote)).rejects.toThrow();
  });

  it("refuses to record the same settlement transaction twice", async () => {
    const user = await seedFreelancer(db);
    const invoice = await seedInvoice(user.id);
    const payment = { invoiceId: invoice.id, payer: "0xabc", asset: "USDT" as const, amountAtomic: "1", txHash: "0x01" };
    await db.insert(payments).values(payment);
    await expect(db.insert(payments).values(payment)).rejects.toThrow();
  });

  it("allows many one-off invoices but one instance per recurring period", async () => {
    const user = await seedFreelancer(db);
    await seedInvoice(user.id);
    await seedInvoice(user.id);
    const [template] = await db
      .insert(recurringInvoices)
      .values({
        slug: "rTemplate01",
        userId: user.id,
        clientName: "Acme",
        description: "Maintenance",
        amount: "100",
        currency: "USD",
        interval: "weekly",
        anchorDay: 8,
        nextIssueAt: new Date("2026-10-15T00:00:00Z"),
      })
      .returning();
    const periodStart = new Date("2026-10-08T00:00:00Z");
    await seedInvoice(user.id, { recurringId: template.id, periodStart });
    await expect(seedInvoice(user.id, { recurringId: template.id, periodStart })).rejects.toThrow();
  });
});
```

- [ ] **Step 10: Run the schema tests**

Run: `npx vitest run src/lib/db`
Expected: PASS (4 tests). The first run takes a few seconds while PGlite starts.

- [ ] **Step 11: Create the Neon database (user-assisted)**

Ask the user to do this, then wait:

1. In the Vercel dashboard, open the `cobro-agent` project → **Storage** → **Create Database** → **Neon** (free plan), region close to the Vercel functions (Washington, D.C. `iad1` by default), and connect it to all environments. Vercel adds `DATABASE_URL` to the project's env.
2. Copy the `DATABASE_URL` value (Storage → the database → `.env.local` tab) into the local `.env.local`. Do not paste it into the chat.

Then run: `npm run db:migrate`
Expected: `Migrations applied`. Running it a second time prints the same and changes nothing.

- [ ] **Step 12: Update `.env.example`**

Append to `.env.example` under `# ---- Server only ----` (no real values):

```
# Neon Postgres (Vercel Storage → Neon); server only
DATABASE_URL=
# 32+ random characters: openssl rand -base64 48
SESSION_SECRET=
# Celo x402 facilitator key (x402.celo.org → Create API key)
X402_API_KEY=
X402_FACILITATOR_URL=https://api.x402.celo.org
# 32+ random characters; also stored as the CRON_SECRET GitHub Actions secret
CRON_SECRET=
TEXTILE_API_URL=https://api.textilecredit.com
```

and rename the comment `# ---- Para sign-in spike (public client key) ----` to `# ---- Para sign-in (public client key) ----`.

Ask the user to fill `SESSION_SECRET` and `CRON_SECRET` in `.env.local` with `openssl rand -base64 48` output each (run it with the `!` prefix so the value stays in their terminal), and to create the x402 key at https://x402.celo.org (connect a wallet, **Create API key**, sign) and paste it into `.env.local` as `X402_API_KEY`.

- [ ] **Step 13: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

```bash
git add package.json package-lock.json drizzle.config.ts drizzle src/lib/db scripts/db-migrate.ts src/lib/config .env.example
git commit -m "feat(db): add Drizzle schema, Neon client, PGlite test harness and Plan 2 env

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Money: currencies, decimals, form input and formatting

**Files:**
- Create: `src/lib/money/currencies.ts`, `src/lib/money/decimal.ts`, `src/lib/money/input.ts`, `src/lib/money/format.ts`, `src/lib/money/money.test.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: `TOKENS`, `TokenSymbol` (Plan 1).
- Produces:
  - `FIAT_CURRENCIES`, `type FiatCurrency = "USD" | "ARS" | "BRL"`; `LOCAL_CURRENCIES`, `type LocalCurrency = "ARS" | "BRL"`; `PAY_ASSETS`, `type PayAsset = "USAT" | "USDT" | "WARS" | "WBRL"`; `ASSET_DENOMINATION: Record<PayAsset, FiatCurrency>`; `isPayAsset(v): v is PayAsset`; `isFiatCurrency(v)`; `isLocalCurrency(v)`.
  - `RATE_DECIMALS = 18`, `RATE_ONE = 10n ** 18n`, `parseDecimal(value: string, decimals: number): bigint`, `formatDecimal(value: bigint, decimals: number): string`, `ceilDiv(n: bigint, d: bigint): bigint`.
  - `MAX_FIAT_AMOUNT = "1000000000"`, `type FiatInputError = "required" | "format" | "decimals" | "range"`, `parseFiatInput(raw: string, opts?: { allowZero?: boolean }): { ok: true; value: string } | { ok: false; error: FiatInputError }` (value is canonical, e.g. `"1500.50"`).
  - `formatMoney(amount: string, currency: FiatCurrency, locale?: string): string`, `formatTokenAmount(atomic: bigint, asset: PayAsset, locale?: string): string`.
  - i18n keys `asset.<SYMBOL>.name`, `asset.<SYMBOL>.symbol`, `money.error.<FiatInputError>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/money/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ASSET_DENOMINATION, isPayAsset } from "./currencies";
import { ceilDiv, formatDecimal, parseDecimal, RATE_ONE } from "./decimal";
import { formatMoney, formatTokenAmount } from "./format";
import { parseFiatInput } from "./input";

const NBSP = " ";

describe("currencies", () => {
  it("knows which fiat each pay asset tracks", () => {
    expect(ASSET_DENOMINATION).toEqual({ USAT: "USD", USDT: "USD", WARS: "ARS", WBRL: "BRL" });
  });

  it("accepts only the four pay assets", () => {
    expect(isPayAsset("WARS")).toBe(true);
    expect(isPayAsset("USDC")).toBe(false);
    expect(isPayAsset(null)).toBe(false);
  });
});

describe("decimal", () => {
  it("parses decimals into scaled integers", () => {
    expect(parseDecimal("1605.495", 18)).toBe(1605495000000000000000n);
    expect(parseDecimal("300", 6)).toBe(300_000000n);
    expect(parseDecimal("0.01", 2)).toBe(1n);
    expect(parseDecimal("5", 0)).toBe(5n);
  });

  it("rejects malformed input and excess precision", () => {
    expect(() => parseDecimal("1,5", 2)).toThrow(/decimal/);
    expect(() => parseDecimal("-1", 2)).toThrow(/decimal/);
    expect(() => parseDecimal("1.005", 2)).toThrow(/2 decimal places/);
  });

  it("formats without trailing zeros", () => {
    expect(formatDecimal(1605495000000000000000n, 18)).toBe("1605.495");
    expect(formatDecimal(300_000000n, 6)).toBe("300");
    expect(formatDecimal(RATE_ONE, 18)).toBe("1");
    expect(formatDecimal(7n, 6)).toBe("0.000007");
  });

  it("divides rounding up", () => {
    expect(ceilDiv(10n, 5n)).toBe(2n);
    expect(ceilDiv(11n, 5n)).toBe(3n);
    expect(ceilDiv(0n, 5n)).toBe(0n);
    expect(() => ceilDiv(1n, 0n)).toThrow();
  });
});

describe("parseFiatInput", () => {
  it("accepts plain amounts and canonicalises them", () => {
    expect(parseFiatInput("1500")).toEqual({ ok: true, value: "1500.00" });
    expect(parseFiatInput(" 1500.5 ")).toEqual({ ok: true, value: "1500.50" });
    expect(parseFiatInput("0.01")).toEqual({ ok: true, value: "0.01" });
    expect(parseFiatInput("007.10")).toEqual({ ok: true, value: "7.10" });
  });

  it("refuses separators that could mean two different numbers", () => {
    expect(parseFiatInput("1,500.50")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("1.500,50")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("1500,50")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("1 500")).toEqual({ ok: false, error: "format" });
    expect(parseFiatInput("$300")).toEqual({ ok: false, error: "format" });
  });

  it("refuses more than two decimals, zero, empty and huge amounts", () => {
    expect(parseFiatInput("1.005")).toEqual({ ok: false, error: "decimals" });
    expect(parseFiatInput("0")).toEqual({ ok: false, error: "range" });
    expect(parseFiatInput("")).toEqual({ ok: false, error: "required" });
    expect(parseFiatInput("1000000000.01")).toEqual({ ok: false, error: "range" });
  });

  it("allows zero when asked (spending reserve)", () => {
    expect(parseFiatInput("0", { allowZero: true })).toEqual({ ok: true, value: "0.00" });
  });
});

describe("formatMoney", () => {
  it("shows dollars as US$ with cents", () => {
    expect(formatMoney("300", "USD")).toBe("US$300.00");
    expect(formatMoney("1234.5", "USD")).toBe("US$1,234.50");
  });

  it("shows pesos and reais with the currency code, dropping .00", () => {
    expect(formatMoney("482000.00", "ARS")).toBe(`ARS${NBSP}482,000`);
    expect(formatMoney("1500.50", "BRL")).toBe(`BRL${NBSP}1,500.50`);
  });
});

describe("formatTokenAmount", () => {
  it("rounds up to cents so the shown amount is never less than what is charged", () => {
    expect(formatTokenAmount(622861n, "USDT")).toBe("0.63 USD₮");
    expect(formatTokenAmount(300_000000n, "USAT")).toBe("300.00 USA₮");
    expect(formatTokenAmount(481648500000000000000000n, "WARS")).toBe("481,648.50 wARS");
    expect(formatTokenAmount(31876880007147749947881n, "WBRL")).toBe("31,876.89 wBRL");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/money`
Expected: FAIL, `Failed to resolve import "./currencies"`.

- [ ] **Step 3: Implement `currencies.ts` and `decimal.ts`**

`src/lib/money/currencies.ts`:

```ts
import type { TokenSymbol } from "@/lib/chain/tokens";

export const FIAT_CURRENCIES = ["USD", "ARS", "BRL"] as const;
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export const LOCAL_CURRENCIES = ["ARS", "BRL"] as const;
export type LocalCurrency = (typeof LOCAL_CURRENCIES)[number];

/** Tokens a client can pay an invoice with (USDC is out of scope, spec §5). */
export const PAY_ASSETS = ["USAT", "USDT", "WARS", "WBRL"] as const satisfies readonly TokenSymbol[];
export type PayAsset = (typeof PAY_ASSETS)[number];

/** The fiat currency each pay asset tracks one-to-one. */
export const ASSET_DENOMINATION: Record<PayAsset, FiatCurrency> = {
  USAT: "USD",
  USDT: "USD",
  WARS: "ARS",
  WBRL: "BRL",
};

export function isPayAsset(value: unknown): value is PayAsset {
  return typeof value === "string" && (PAY_ASSETS as readonly string[]).includes(value);
}

export function isFiatCurrency(value: unknown): value is FiatCurrency {
  return typeof value === "string" && (FIAT_CURRENCIES as readonly string[]).includes(value);
}

export function isLocalCurrency(value: unknown): value is LocalCurrency {
  return typeof value === "string" && (LOCAL_CURRENCIES as readonly string[]).includes(value);
}
```

`src/lib/money/decimal.ts`:

```ts
/** Rates are fixed-point integers with 18 decimals. */
export const RATE_DECIMALS = 18;
export const RATE_ONE = 10n ** 18n;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** "1605.495" with 18 decimals → 1605495000000000000000n. Throws on anything but a plain non-negative decimal. */
export function parseDecimal(value: string, decimals: number): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error(`Not a plain decimal number: "${value}"`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Inverse of parseDecimal, without trailing zeros: 300_000000n with 6 decimals → "300". */
export function formatDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / base}${fraction ? `.${fraction}` : ""}`;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator < 0n) throw new Error("numerator must not be negative");
  return (numerator + denominator - 1n) / denominator;
}
```

- [ ] **Step 4: Implement `input.ts`**

`src/lib/money/input.ts`:

```ts
import { parseDecimal } from "./decimal";

export const MAX_FIAT_AMOUNT = "1000000000";
export type FiatInputError = "required" | "format" | "decimals" | "range";

const PLAIN = /^\d+(\.\d+)?$/;

/**
 * Reads an amount typed into a form. Only digits and one dot are accepted: "1.500,50" (Argentina)
 * and "1,500.50" (US) mean the same number, while "1.500" means different numbers in each, so any
 * comma or space is refused instead of guessed.
 */
export function parseFiatInput(
  raw: string,
  opts: { allowZero?: boolean } = {},
): { ok: true; value: string } | { ok: false; error: FiatInputError } {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "required" };
  if (!PLAIN.test(text)) return { ok: false, error: "format" };
  if ((text.split(".")[1] ?? "").length > 2) return { ok: false, error: "decimals" };
  const cents = parseDecimal(text, 2);
  if ((cents === 0n && !opts.allowZero) || cents > parseDecimal(MAX_FIAT_AMOUNT, 2)) {
    return { ok: false, error: "range" };
  }
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return { ok: true, value: `${whole}.${fraction}` };
}
```

- [ ] **Step 5: Add the money strings**

Add to `src/i18n/en.ts` (inside the `en` object, before `"spike.title"`):

```ts
  "asset.USAT.name": "US dollar (USA₮)",
  "asset.USAT.symbol": "USA₮",
  "asset.USDT.name": "Dollar (USD₮)",
  "asset.USDT.symbol": "USD₮",
  "asset.WARS.name": "Argentine peso (wARS)",
  "asset.WARS.symbol": "wARS",
  "asset.WBRL.name": "Brazilian real (wBRL)",
  "asset.WBRL.symbol": "wBRL",
  "money.error.required": "Enter an amount.",
  "money.error.format": "Use digits and a dot for cents, with no commas or spaces. Example: 1500.50",
  "money.error.decimals": "Use at most two digits after the dot.",
  "money.error.range": "Enter an amount above 0 and up to 1,000,000,000.",
```

- [ ] **Step 6: Implement `format.ts`**

`src/lib/money/format.ts`:

```ts
import { TOKENS } from "@/lib/chain/tokens";
import { t } from "@/i18n";
import type { FiatCurrency, PayAsset } from "./currencies";
import { ceilDiv, formatDecimal } from "./decimal";

/** The only fiat formatter in the app (MASTER.md "Money formatting"). Display only. */
export function formatMoney(amount: string, currency: FiatCurrency, locale = "en-US"): string {
  const value = Number(amount);
  if (currency === "USD") {
    // en-US renders "$300.00"; the "US" prefix keeps dollars distinct from pesos.
    return `US${new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value)}`;
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    trailingZeroDisplay: "stripIfInteger",
  }).format(value);
}

/** "481,648.50 wARS". Rounded up to cents so a payer never sees less than what is charged. */
export function formatTokenAmount(atomic: bigint, asset: PayAsset, locale = "en-US"): string {
  const decimals = TOKENS[asset].decimals;
  const cents = ceilDiv(atomic, 10n ** BigInt(decimals - 2));
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(formatDecimal(cents, 2)),
  );
  return `${number} ${t(`asset.${asset}.symbol` as const)}`;
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run src/lib/money`
Expected: PASS. If `trailingZeroDisplay` is missing from the TypeScript lib types, `npm run typecheck` will say so; in that case cast the options object `as Intl.NumberFormatOptions`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/money src/i18n/en.ts
git commit -m "feat(money): add currencies, fixed-point helpers, strict amount input and formatMoney

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reference rates from Textile, conversion and display amounts

**Files:**
- Create: `src/lib/fx/rates.ts`, `src/lib/fx/rates.test.ts`, `src/lib/fx/convert.ts`, `src/lib/money/display.ts`, `src/lib/money/display.test.ts`

**Interfaces:**
- Consumes: `parseDecimal`, `RATE_ONE`, `formatDecimal` (Task 2); `FiatCurrency`, `LocalCurrency` (Task 2); `formatMoney` (Task 2); `parseServerEnv` (Task 1).
- Produces:
  - `interface ReferenceRates { perUsd: Record<LocalCurrency, bigint>; fetchedAt: number }` (local units per 1 USD₮, 18 decimals).
  - `class RatesUnavailableError extends Error`.
  - `parseTickers(json: unknown, now: number): ReferenceRates`.
  - `fetchReferenceRates(opts: { baseUrl: string; fetchImpl?: typeof fetch; now?: () => number }): Promise<ReferenceRates>`.
  - `createRatesCache(load: () => Promise<ReferenceRates>, opts?: { ttlMs?: number; maxStaleMs?: number; now?: () => number }): () => Promise<ReferenceRates>`.
  - `getReferenceRates(): Promise<ReferenceRates>` (process-wide cache, TTL 60 s, stale up to 10 min), `getReferenceRatesOrNull(): Promise<ReferenceRates | null>`.
  - `fiatPerUsd(rates: ReferenceRates | null, currency: FiatCurrency): bigint` (throws `RatesUnavailableError` when rates are needed and null).
  - `convertFiat(amount: string, from: FiatCurrency, to: FiatCurrency, rates: ReferenceRates | null): string` (2-decimal string, half-up).
  - `interface DisplayAmount { primary: string; secondary?: string }`, `displayAmount(amount: string, currency: FiatCurrency, local: LocalCurrency | null, rates: ReferenceRates | null): DisplayAmount`.

- [ ] **Step 1: Write the failing rate tests**

`src/lib/fx/rates.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { convertFiat, fiatPerUsd } from "./convert";
import { createRatesCache, fetchReferenceRates, parseTickers, RatesUnavailableError, type ReferenceRates } from "./rates";

// Shape and values from GET https://api.textilecredit.com/tickers on 2026-10-08.
const TICKERS = [
  { ticker_id: "USDT_WARS", base_currency: "USDT", target_currency: "WARS", last_price: "1606.94", bid: "1605.17", ask: "1605.82" },
  { ticker_id: "USDT_WBRL", base_currency: "USDT", target_currency: "WBRL", last_price: "5.0367", bid: "5.0348", ask: "5.0383" },
  { ticker_id: "USAT_USDT", base_currency: "USAT", target_currency: "USDT", last_price: "0.999450", bid: "0.999450", ask: "0" },
];

const E18 = 10n ** 18n;
const rates: ReferenceRates = { perUsd: { ARS: 1605495n * 10n ** 15n, BRL: 503655n * 10n ** 13n }, fetchedAt: 0 };

describe("parseTickers", () => {
  it("takes the mid of bid and ask", () => {
    const parsed = parseTickers(TICKERS, 1000);
    expect(parsed.perUsd.ARS).toBe(1605495n * 10n ** 15n); // 1605.495
    expect(parsed.perUsd.BRL).toBe(503655n * 10n ** 13n); // 5.03655
    expect(parsed.fetchedAt).toBe(1000);
  });

  it("falls back to the one live side, then to the last price", () => {
    const oneSided = [
      { ...TICKERS[0], bid: "0", ask: "1606" },
      { ...TICKERS[1], bid: "0", ask: "0", last_price: "5.04" },
    ];
    const parsed = parseTickers(oneSided, 0);
    expect(parsed.perUsd.ARS).toBe(1606n * E18);
    expect(parsed.perUsd.BRL).toBe(504n * 10n ** 16n);
  });

  it("refuses a pair with no usable price at all", () => {
    const dead = [{ ...TICKERS[0], bid: "0", ask: "0", last_price: "0" }, TICKERS[1]];
    expect(() => parseTickers(dead, 0)).toThrow(RatesUnavailableError);
  });

  it("refuses a missing pair or a malformed payload", () => {
    expect(() => parseTickers([TICKERS[0]], 0)).toThrow(/USDT_WBRL/);
    expect(() => parseTickers({ error: "maintenance" }, 0)).toThrow(RatesUnavailableError);
    expect(() => parseTickers([{ ...TICKERS[0], bid: "abc" }, TICKERS[1]], 0)).toThrow(RatesUnavailableError);
  });
});

describe("fetchReferenceRates", () => {
  it("reads /tickers from the configured base URL", async () => {
    const fetchImpl = vi.fn(async () => Response.json(TICKERS));
    const parsed = await fetchReferenceRates({ baseUrl: "https://textile.test", fetchImpl, now: () => 5 });
    expect(fetchImpl).toHaveBeenCalledWith("https://textile.test/tickers", expect.anything());
    expect(parsed.perUsd.ARS).toBe(1605495n * 10n ** 15n);
  });

  it("turns HTTP errors into RatesUnavailableError", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(fetchReferenceRates({ baseUrl: "https://textile.test", fetchImpl })).rejects.toThrow(RatesUnavailableError);
  });
});

describe("createRatesCache", () => {
  it("serves from cache within the TTL", async () => {
    let clock = 0;
    const load = vi.fn(async () => ({ ...rates, fetchedAt: clock }));
    const get = createRatesCache(load, { ttlMs: 60_000, now: () => clock });
    await get();
    clock = 59_000;
    await get();
    expect(load).toHaveBeenCalledTimes(1);
    clock = 61_000;
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps serving a recent value through an outage, then gives up", async () => {
    let clock = 0;
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new RatesUnavailableError("down");
      return { ...rates, fetchedAt: clock };
    });
    const get = createRatesCache(load, { ttlMs: 60_000, maxStaleMs: 600_000, now: () => clock });
    await get();
    fail = true;
    clock = 300_000;
    await expect(get()).resolves.toMatchObject({ fetchedAt: 0 });
    clock = 601_000;
    await expect(get()).rejects.toThrow(RatesUnavailableError);
  });
});

describe("convert", () => {
  it("needs no rates for dollars", () => {
    expect(fiatPerUsd(null, "USD")).toBe(E18);
    expect(() => fiatPerUsd(null, "ARS")).toThrow(RatesUnavailableError);
  });

  it("converts through USD and rounds half up to cents", () => {
    expect(convertFiat("300.00", "USD", "ARS", rates)).toBe("481648.50");
    expect(convertFiat("482000.00", "ARS", "USD", rates)).toBe("300.22");
    expect(convertFiat("1500.50", "BRL", "USD", rates)).toBe("297.92");
    expect(convertFiat("10.00", "ARS", "ARS", null)).toBe("10.00");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/fx`
Expected: FAIL, `Failed to resolve import "./convert"`.

- [ ] **Step 3: Implement `rates.ts`**

`src/lib/fx/rates.ts`:

```ts
import { z } from "zod";
import { parseServerEnv } from "@/lib/config/server";
import type { LocalCurrency } from "@/lib/money/currencies";
import { parseDecimal, RATE_DECIMALS } from "@/lib/money/decimal";

/** Local-currency units per 1 USD₮, 18 decimals, from Textile's public tickers (spec §8.3). */
export interface ReferenceRates {
  perUsd: Record<LocalCurrency, bigint>;
  fetchedAt: number;
}

export class RatesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatesUnavailableError";
  }
}

const PAIRS: Record<LocalCurrency, string> = { ARS: "USDT_WARS", BRL: "USDT_WBRL" };

const tickerSchema = z.object({
  ticker_id: z.string(),
  bid: z.string(),
  ask: z.string(),
  last_price: z.string(),
});

function priceOf(value: string, pair: string): bigint {
  try {
    return parseDecimal(value, RATE_DECIMALS);
  } catch {
    throw new RatesUnavailableError(`Textile ${pair} has a malformed price "${value}"`);
  }
}

/** Mid of bid and ask; one live side if the other is 0; else the last trade. Never 0. */
function referencePrice(ticker: z.infer<typeof tickerSchema>): bigint {
  const bid = priceOf(ticker.bid, ticker.ticker_id);
  const ask = priceOf(ticker.ask, ticker.ticker_id);
  if (bid > 0n && ask > 0n) return (bid + ask) / 2n;
  if (bid > 0n || ask > 0n) return bid > 0n ? bid : ask;
  const last = priceOf(ticker.last_price, ticker.ticker_id);
  if (last > 0n) return last;
  throw new RatesUnavailableError(`Textile ${ticker.ticker_id} has no price`);
}

export function parseTickers(json: unknown, now: number): ReferenceRates {
  const parsed = z.array(z.unknown()).safeParse(json);
  if (!parsed.success) throw new RatesUnavailableError("Textile tickers response is not a list");
  const tickers = new Map<string, z.infer<typeof tickerSchema>>();
  for (const item of parsed.data) {
    const ticker = tickerSchema.safeParse(item);
    if (ticker.success) tickers.set(ticker.data.ticker_id, ticker.data);
  }
  const perUsd = {} as Record<LocalCurrency, bigint>;
  for (const [currency, pair] of Object.entries(PAIRS) as [LocalCurrency, string][]) {
    const ticker = tickers.get(pair);
    if (!ticker) throw new RatesUnavailableError(`Textile tickers have no ${pair}`);
    perUsd[currency] = referencePrice(ticker);
  }
  return { perUsd, fetchedAt: now };
}

export async function fetchReferenceRates(opts: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<ReferenceRates> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/tickers`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new RatesUnavailableError(`Textile tickers unreachable: ${error instanceof Error ? error.message : error}`);
  }
  if (!response.ok) throw new RatesUnavailableError(`Textile tickers returned ${response.status}`);
  return parseTickers(await response.json().catch(() => null), (opts.now ?? Date.now)());
}

/** Fresh for ttlMs; on a failed refresh, keeps serving a value younger than maxStaleMs. */
export function createRatesCache(
  load: () => Promise<ReferenceRates>,
  opts: { ttlMs?: number; maxStaleMs?: number; now?: () => number } = {},
): () => Promise<ReferenceRates> {
  const ttlMs = opts.ttlMs ?? 60_000;
  const maxStaleMs = opts.maxStaleMs ?? 600_000;
  const now = opts.now ?? Date.now;
  let last: { value: ReferenceRates; at: number } | undefined;
  return async () => {
    const time = now();
    if (last && time - last.at < ttlMs) return last.value;
    try {
      const value = await load();
      last = { value, at: time };
      return value;
    } catch (error) {
      if (last && time - last.at < maxStaleMs) return last.value;
      throw error;
    }
  };
}

let shared: (() => Promise<ReferenceRates>) | undefined;

export function getReferenceRates(): Promise<ReferenceRates> {
  shared ??= createRatesCache(() => fetchReferenceRates({ baseUrl: parseServerEnv().TEXTILE_API_URL }));
  return shared();
}

/** For views that can render without rates (the dashboard falls back to invoice currency). */
export async function getReferenceRatesOrNull(): Promise<ReferenceRates | null> {
  try {
    return await getReferenceRates();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement `convert.ts`**

`src/lib/fx/convert.ts`:

```ts
import type { FiatCurrency } from "@/lib/money/currencies";
import { parseDecimal, RATE_ONE } from "@/lib/money/decimal";
import { RatesUnavailableError, type ReferenceRates } from "./rates";

/** Units of `currency` per 1 USD, 18 decimals. Dollars need no rates. */
export function fiatPerUsd(rates: ReferenceRates | null, currency: FiatCurrency): bigint {
  if (currency === "USD") return RATE_ONE;
  if (!rates) throw new RatesUnavailableError(`No reference rate for ${currency}`);
  return rates.perUsd[currency];
}

/** Converts a fiat amount through USD, rounded half up to cents. For display, never for charging. */
export function convertFiat(amount: string, from: FiatCurrency, to: FiatCurrency, rates: ReferenceRates | null): string {
  const cents = parseDecimal(amount, 2);
  const result =
    from === to ? cents : (cents * fiatPerUsd(rates, to) * 2n + fiatPerUsd(rates, from)) / (2n * fiatPerUsd(rates, from));
  return `${result / 100n}.${(result % 100n).toString().padStart(2, "0")}`;
}
```

- [ ] **Step 5: Run the rate tests to see them pass**

Run: `npx vitest run src/lib/fx`
Expected: PASS.

- [ ] **Step 6: Write the failing display tests**

`src/lib/money/display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ReferenceRates } from "@/lib/fx/rates";
import { displayAmount } from "./display";

const NBSP = " ";
const rates: ReferenceRates = { perUsd: { ARS: 1605495n * 10n ** 15n, BRL: 503655n * 10n ** 13n }, fetchedAt: 0 };

describe("displayAmount", () => {
  it("puts the freelancer's currency first, with dollars underneath", () => {
    expect(displayAmount("482000.00", "ARS", "ARS", rates)).toEqual({
      primary: `ARS${NBSP}482,000`,
      secondary: "≈ US$300.22",
    });
  });

  it("converts a dollar invoice into the local currency, marked approximate", () => {
    expect(displayAmount("300.00", "USD", "ARS", rates)).toEqual({
      primary: `≈ ARS${NBSP}481,648.50`,
      secondary: "US$300.00",
    });
  });

  it("falls back to the invoice currency when rates are missing", () => {
    expect(displayAmount("300.00", "USD", "ARS", null)).toEqual({ primary: "US$300.00" });
    expect(displayAmount("482000.00", "ARS", "ARS", null)).toEqual({ primary: `ARS${NBSP}482,000` });
  });

  it("shows only the invoice currency before onboarding picks a local one", () => {
    expect(displayAmount("300.00", "USD", null, rates)).toEqual({ primary: "US$300.00" });
  });
});
```

- [ ] **Step 7: Implement `display.ts`**

`src/lib/money/display.ts`:

```ts
import { convertFiat } from "@/lib/fx/convert";
import type { ReferenceRates } from "@/lib/fx/rates";
import type { FiatCurrency, LocalCurrency } from "./currencies";
import { formatMoney } from "./format";

export interface DisplayAmount {
  primary: string;
  secondary?: string;
}

/** Spec §17.1 principle 2: local currency large, USD (or the invoice currency) small. */
export function displayAmount(
  amount: string,
  currency: FiatCurrency,
  local: LocalCurrency | null,
  rates: ReferenceRates | null,
): DisplayAmount {
  const exact = formatMoney(amount, currency);
  if (!local || !rates) return { primary: exact };
  if (currency === local) {
    return { primary: exact, secondary: `≈ ${formatMoney(convertFiat(amount, currency, "USD", rates), "USD")}` };
  }
  return { primary: `≈ ${formatMoney(convertFiat(amount, currency, local, rates), local)}`, secondary: exact };
}
```

- [ ] **Step 8: Run all money and fx tests**

Run: `npx vitest run src/lib/money src/lib/fx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/fx src/lib/money
git commit -m "feat(fx): read Textile reference rates with a stale-tolerant cache and local-first display

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Invoice quotes with a 10-minute rate lock

**Files:**
- Create: `src/lib/payments/quote.ts`, `src/lib/payments/quote.test.ts`, `src/lib/payments/quotes-repo.ts`, `src/lib/payments/quotes-repo.test.ts`

**Interfaces:**
- Consumes: `TOKENS` (Plan 1); `ASSET_DENOMINATION`, `PayAsset`, `FiatCurrency`, `parseDecimal`, `formatDecimal`, `ceilDiv`, `RATE_ONE`, `RATE_DECIMALS` (Task 2); `fiatPerUsd`, `ReferenceRates`, `RatesUnavailableError` (Task 3); `Db`, `invoiceQuotes`, `createTestDb`, `resetDb`, `seedFreelancer`, `seedInvoice` (Task 1).
- Produces:
  - `interface InvoiceQuote { amountAtomic: bigint; rate: string }`
  - `needsRates(currency: FiatCurrency, asset: PayAsset): boolean`
  - `quoteInvoice(input: { amount: string; currency: FiatCurrency; asset: PayAsset; rates: ReferenceRates | null }): InvoiceQuote` (throws `RatesUnavailableError` only when a rate is needed and missing)
  - `QUOTE_TTL_MS = 600_000`, `interface LockedQuote { asset: PayAsset; amountAtomic: bigint; rate: string; expiresAt: Date }`
  - `lockQuote(db: Db, input: { invoiceId: string; asset: PayAsset; now: Date; compute: () => InvoiceQuote | Promise<InvoiceQuote> }): Promise<LockedQuote>`

- [ ] **Step 1: Write the failing quote tests**

`src/lib/payments/quote.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RatesUnavailableError, type ReferenceRates } from "@/lib/fx/rates";
import { needsRates, quoteInvoice } from "./quote";

const rates: ReferenceRates = { perUsd: { ARS: 1605495n * 10n ** 15n, BRL: 503655n * 10n ** 13n }, fetchedAt: 0 };

describe("needsRates", () => {
  it("is false when the token tracks the invoice currency", () => {
    expect(needsRates("USD", "USDT")).toBe(false);
    expect(needsRates("USD", "USAT")).toBe(false);
    expect(needsRates("ARS", "WARS")).toBe(false);
    expect(needsRates("USD", "WARS")).toBe(true);
    expect(needsRates("ARS", "USDT")).toBe(true);
  });
});

describe("quoteInvoice", () => {
  it("prices dollar invoices in dollar tokens 1:1 without any rate", () => {
    expect(quoteInvoice({ amount: "300.00", currency: "USD", asset: "USDT", rates: null })).toEqual({
      amountAtomic: 300_000000n,
      rate: "1",
    });
    expect(quoteInvoice({ amount: "300.00", currency: "USD", asset: "USAT", rates: null }).amountAtomic).toBe(300_000000n);
  });

  it("prices peso invoices in wARS 1:1 with 18 decimals", () => {
    expect(quoteInvoice({ amount: "1000.00", currency: "ARS", asset: "WARS", rates: null }).amountAtomic).toBe(
      1000n * 10n ** 18n,
    );
  });

  it("converts dollars to pesos at the reference mid", () => {
    expect(quoteInvoice({ amount: "300.00", currency: "USD", asset: "WARS", rates })).toEqual({
      amountAtomic: 481648500000000000000000n,
      rate: "1605.495",
    });
  });

  it("converts pesos to dollars, rounding up to the token's smallest unit", () => {
    expect(quoteInvoice({ amount: "1000.00", currency: "ARS", asset: "USDT", rates })).toEqual({
      amountAtomic: 622861n,
      rate: "0.000622860862226291",
    });
  });

  it("crosses reais to pesos through the dollar", () => {
    expect(quoteInvoice({ amount: "100.00", currency: "BRL", asset: "WARS", rates })).toEqual({
      amountAtomic: 31876880007147749947881n,
      rate: "318.768800071477499478",
    });
  });

  it("never quotes zero for a tiny invoice", () => {
    expect(quoteInvoice({ amount: "0.01", currency: "ARS", asset: "USDT", rates }).amountAtomic).toBe(7n);
  });

  it("refuses to guess a rate it does not have", () => {
    expect(() => quoteInvoice({ amount: "300.00", currency: "USD", asset: "WARS", rates: null })).toThrow(
      RatesUnavailableError,
    );
  });

  it("refuses a zero invoice", () => {
    expect(() => quoteInvoice({ amount: "0.00", currency: "USD", asset: "USDT", rates: null })).toThrow(/positive/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/payments/quote.test.ts`
Expected: FAIL, `Failed to resolve import "./quote"`.

- [ ] **Step 3: Implement `quote.ts`**

`src/lib/payments/quote.ts`:

```ts
import { TOKENS } from "@/lib/chain/tokens";
import { fiatPerUsd } from "@/lib/fx/convert";
import type { ReferenceRates } from "@/lib/fx/rates";
import { ASSET_DENOMINATION, type FiatCurrency, type PayAsset } from "@/lib/money/currencies";
import { ceilDiv, formatDecimal, parseDecimal, RATE_DECIMALS, RATE_ONE } from "@/lib/money/decimal";

export interface InvoiceQuote {
  amountAtomic: bigint;
  /** Tokens per one unit of the invoice currency, as a decimal string. */
  rate: string;
}

/** True when pricing this invoice in `asset` needs Textile reference rates. */
export function needsRates(currency: FiatCurrency, asset: PayAsset): boolean {
  return ASSET_DENOMINATION[asset] !== currency;
}

/** Spec §9: the invoice amount in `asset` at the reference mid, rounded up to the token's smallest unit. */
export function quoteInvoice(input: {
  amount: string;
  currency: FiatCurrency;
  asset: PayAsset;
  rates: ReferenceRates | null;
}): InvoiceQuote {
  const cents = parseDecimal(input.amount, 2);
  if (cents <= 0n) throw new Error("Invoice amount must be positive");
  const decimals = TOKENS[input.asset].decimals;
  const same = !needsRates(input.currency, input.asset);
  const targetPerUsd = same ? RATE_ONE : fiatPerUsd(input.rates, ASSET_DENOMINATION[input.asset]);
  const sourcePerUsd = same ? RATE_ONE : fiatPerUsd(input.rates, input.currency);
  return {
    amountAtomic: ceilDiv(cents * targetPerUsd * 10n ** BigInt(decimals), 100n * sourcePerUsd),
    rate: formatDecimal((targetPerUsd * RATE_ONE) / sourcePerUsd, RATE_DECIMALS),
  };
}
```

- [ ] **Step 4: Run the quote tests to see them pass**

Run: `npx vitest run src/lib/payments/quote.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing lock tests**

`src/lib/payments/quotes-repo.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import { lockQuote } from "./quotes-repo";

let db: Db;
let invoiceId: string;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  const user = await seedFreelancer(db);
  invoiceId = (await seedInvoice(db, user.id)).id;
});

const at = (iso: string) => new Date(`2026-10-15T${iso}Z`);

describe("lockQuote", () => {
  it("prices once and keeps that price for 10 minutes", async () => {
    const compute = vi.fn(() => ({ amountAtomic: 300_000000n, rate: "1" }));
    const first = await lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute });
    expect(first.amountAtomic).toBe(300_000000n);
    expect(first.expiresAt).toEqual(at("12:10:00"));

    const again = await lockQuote(db, {
      invoiceId,
      asset: "USDT",
      now: at("12:09:59"),
      compute: () => ({ amountAtomic: 1n, rate: "9" }),
    });
    expect(again.amountAtomic).toBe(300_000000n);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("re-prices once the lock has expired", async () => {
    await lockQuote(db, { invoiceId, asset: "WARS", now: at("12:00:00"), compute: () => ({ amountAtomic: 5n, rate: "1" }) });
    const later = await lockQuote(db, {
      invoiceId,
      asset: "WARS",
      now: at("12:10:00"),
      compute: () => ({ amountAtomic: 6n, rate: "1.2" }),
    });
    expect(later.amountAtomic).toBe(6n);
    expect(later.expiresAt).toEqual(at("12:20:00"));
  });

  it("keeps a separate lock per asset", async () => {
    await lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute: () => ({ amountAtomic: 1n, rate: "1" }) });
    const wars = await lockQuote(db, {
      invoiceId,
      asset: "WARS",
      now: at("12:00:00"),
      compute: () => ({ amountAtomic: 2n, rate: "1" }),
    });
    expect(wars.amountAtomic).toBe(2n);
  });

  it("lets two simultaneous requests agree on one price", async () => {
    const [a, b] = await Promise.all([
      lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute: () => ({ amountAtomic: 1n, rate: "1" }) }),
      lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute: () => ({ amountAtomic: 2n, rate: "1" }) }),
    ]);
    expect(a.amountAtomic).toBe(b.amountAtomic);
  });

  it("does not store anything when pricing fails", async () => {
    await expect(
      lockQuote(db, {
        invoiceId,
        asset: "WARS",
        now: at("12:00:00"),
        compute: () => {
          throw new Error("rates down");
        },
      }),
    ).rejects.toThrow("rates down");
    const retry = await lockQuote(db, {
      invoiceId,
      asset: "WARS",
      now: at("12:00:01"),
      compute: () => ({ amountAtomic: 3n, rate: "1" }),
    });
    expect(retry.amountAtomic).toBe(3n);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx vitest run src/lib/payments/quotes-repo.test.ts`
Expected: FAIL, `Failed to resolve import "./quotes-repo"`.

- [ ] **Step 7: Implement `quotes-repo.ts`**

`src/lib/payments/quotes-repo.ts`:

```ts
import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { invoiceQuotes, type InvoiceQuoteRow } from "@/lib/db/schema";
import type { PayAsset } from "@/lib/money/currencies";
import type { InvoiceQuote } from "./quote";

export const QUOTE_TTL_MS = 10 * 60 * 1000;

export interface LockedQuote {
  asset: PayAsset;
  amountAtomic: bigint;
  rate: string;
  expiresAt: Date;
}

function toLocked(row: InvoiceQuoteRow): LockedQuote {
  return { asset: row.asset, amountAtomic: BigInt(row.amountAtomic), rate: row.rate, expiresAt: row.expiresAt };
}

/**
 * Spec §9: the 402 response and the paid retry must price the same amount, so a quote is locked
 * per (invoice, asset) for 10 minutes. `compute` runs only when there is no live lock.
 */
export async function lockQuote(
  db: Db,
  input: { invoiceId: string; asset: PayAsset; now: Date; compute: () => InvoiceQuote | Promise<InvoiceQuote> },
): Promise<LockedQuote> {
  const where = and(eq(invoiceQuotes.invoiceId, input.invoiceId), eq(invoiceQuotes.asset, input.asset));
  const [current] = await db.select().from(invoiceQuotes).where(where);
  if (current && current.expiresAt > input.now) return toLocked(current);

  const fresh = await input.compute();
  const values = {
    amountAtomic: fresh.amountAtomic.toString(),
    rate: fresh.rate,
    expiresAt: new Date(input.now.getTime() + QUOTE_TTL_MS),
    createdAt: input.now,
  };
  const [written] = await db
    .insert(invoiceQuotes)
    .values({ invoiceId: input.invoiceId, asset: input.asset, ...values })
    .onConflictDoUpdate({
      target: [invoiceQuotes.invoiceId, invoiceQuotes.asset],
      set: values,
      setWhere: lte(invoiceQuotes.expiresAt, input.now),
    })
    .returning();
  if (written) return toLocked(written);

  // Another request locked a live quote between our read and our write: everyone uses theirs.
  const [winner] = await db.select().from(invoiceQuotes).where(where);
  return toLocked(winner);
}
```

- [ ] **Step 8: Run all payment tests to see them pass**

Run: `npx vitest run src/lib/payments`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/payments
git commit -m "feat(payments): price invoices per token and lock the quote for 10 minutes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sessions, user provisioning and the treasury wallet

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/session.test.ts`, `src/lib/users/provision.ts`, `src/lib/users/provision.test.ts`, `src/lib/users/queries.ts`, `src/lib/users/queries.test.ts`, `src/lib/users/para.ts`, `src/lib/auth/current-user.ts`, `src/app/api/session/route.ts`

**Interfaces:**
- Consumes: `verifyParaJwt`, `paraJwks`, `ParaSession` (Plan 1 `src/lib/auth/para-jwt.ts`); `ParaRestClient`, `ParaWallet` (Plan 1 `src/lib/signer/para-rest.ts`); `parseServerEnv`, `requireValue` (Task 1); `Db`, `getDb`, `users`, `treasuryWallets`, `rules`, `UserRow`, test helpers (Task 1); `LocalCurrency` (Task 2).
- Produces:
  - `SESSION_COOKIE = "cobro_session"`, `SESSION_TTL_SECONDS = 604800`, `signSession(userId: string, secret: string, nowSeconds?: number): Promise<string>`, `verifySession(token: string, secret: string, nowSeconds?: number): Promise<{ userId: string } | null>`, `sessionCookieOptions()`.
  - `interface TreasuryWalletProvider { createWallet(userId: string): Promise<ParaWallet>; waitUntilReady(walletId: string): Promise<ParaWallet> }`, `type TreasuryState = { status: "ready"; address: Address } | { status: "creating" }`, `STALE_CREATION_MS = 120_000`.
  - `upsertUser(db: Db, session: ParaSession): Promise<UserRow>`, `ensureTreasuryWallet(db: Db, userId: string, provider: TreasuryWalletProvider, now?: Date): Promise<TreasuryState>`.
  - `interface AppUser { id: string; email: string | null; displayName: string | null; treasuryStatus: "missing" | "creating" | "ready" | "failed"; treasuryAddress: Address | null; localCurrency: LocalCurrency | null }`, `loadAppUser(db: Db, userId: string): Promise<AppUser | null>`.
  - `paraSessionKeys(): JWTVerifyGetKey`, `paraRestClient(): ParaRestClient`.
  - `getCurrentUser(): Promise<AppUser | null>`, `requireUser(opts?: { allowOnboarding?: boolean }): Promise<AppUser>` (redirects to `/signin`, or to `/app/onboarding` when `localCurrency` is null).
  - `POST /api/session` body `{ token }` → `200 { next: "/app" | "/app/onboarding" }` and the session cookie; `400 { error: "token_required" }`; `401 { error: "invalid_session" }`. `DELETE /api/session` → 204 and the cookie removed.

- [ ] **Step 1: Write the failing session tests**

`src/lib/auth/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SESSION_TTL_SECONDS, sessionCookieOptions, signSession, verifySession } from "./session";

const SECRET = "x".repeat(32);
const NOW = 1_791_000_000;

describe("session tokens", () => {
  it("round-trips the user id", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(await verifySession(token, SECRET, NOW + 60)).toEqual({ userId: "user-1" });
  });

  it("expires after seven days", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(await verifySession(token, SECRET, NOW + SESSION_TTL_SECONDS + 1)).toBeNull();
  });

  it("rejects another secret, a tampered token and garbage", async () => {
    const token = await signSession("user-1", SECRET, NOW);
    expect(await verifySession(token, "y".repeat(32), NOW)).toBeNull();
    const [header, payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "user-2", iss: "cobro", exp: NOW + 100 })).toString("base64url");
    expect(await verifySession(`${header}.${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(await verifySession(`${header}.${payload}`, SECRET, NOW)).toBeNull();
    expect(await verifySession("not-a-token", SECRET, NOW)).toBeNull();
  });

  it("sets an HTTP-only, same-site cookie for the whole app", () => {
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: FAIL, `Failed to resolve import "./session"`.

- [ ] **Step 3: Implement `session.ts`**

`src/lib/auth/session.ts`:

```ts
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "cobro_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ISSUER = "cobro";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Our own session, issued after Para's JWT is verified once in POST /api/session. */
export async function signSession(userId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + SESSION_TTL_SECONDS)
    .sign(key(secret));
}

export async function verifySession(
  token: string,
  secret: string,
  nowSeconds?: number,
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      algorithms: ["HS256"],
      currentDate: nowSeconds === undefined ? undefined : new Date(nowSeconds * 1000),
    });
    return payload.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
```

- [ ] **Step 4: Run the session tests to see them pass**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing provisioning tests**

`src/lib/users/provision.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { treasuryWallets, users } from "@/lib/db/schema";
import { createTestDb, resetDb } from "@/lib/db/testing";
import type { ParaWallet } from "@/lib/signer/para-rest";
import { ensureTreasuryWallet, upsertUser, type TreasuryWalletProvider } from "./provision";

const ADDRESS = "0x2222222222222222222222222222222222222222";

function fakeProvider(overrides: Partial<TreasuryWalletProvider> = {}) {
  return {
    createWallet: vi.fn(async (): Promise<ParaWallet> => ({ id: "para-w1", type: "EVM", status: "creating" })),
    waitUntilReady: vi.fn(
      async (id: string): Promise<ParaWallet> => ({ id, type: "EVM", status: "ready", address: ADDRESS }),
    ),
    ...overrides,
  };
}

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const session = { paraUserId: "para-123", email: "ana@example.com", expiresAt: 0 };

async function walletRow(userId: string) {
  const [row] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, userId));
  return row;
}

describe("upsertUser", () => {
  it("creates the user once and keeps known fields when a later token omits them", async () => {
    const first = await upsertUser(db, { ...session, evmAddress: "0x3333333333333333333333333333333333333333" });
    const second = await upsertUser(db, { paraUserId: "para-123", expiresAt: 0 });
    expect(second.id).toBe(first.id);
    expect(second.email).toBe("ana@example.com");
    expect(second.personalWallet).toBe("0x3333333333333333333333333333333333333333");
    expect(await db.select().from(users)).toHaveLength(1);
  });
});

describe("ensureTreasuryWallet", () => {
  it("creates one app-owned wallet keyed by our user id", async () => {
    const user = await upsertUser(db, session);
    const provider = fakeProvider();
    const state = await ensureTreasuryWallet(db, user.id, provider);
    expect(state).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).toHaveBeenCalledWith(user.id);
    expect(await walletRow(user.id)).toMatchObject({ status: "ready", paraWalletId: "para-w1", address: ADDRESS });
  });

  it("does nothing when the wallet is already ready", async () => {
    const user = await upsertUser(db, session);
    await ensureTreasuryWallet(db, user.id, fakeProvider());
    const provider = fakeProvider();
    expect(await ensureTreasuryWallet(db, user.id, provider)).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).not.toHaveBeenCalled();
  });

  it("creates exactly one wallet when two sign-ins race", async () => {
    const user = await upsertUser(db, session);
    const provider = fakeProvider();
    const states = await Promise.all([
      ensureTreasuryWallet(db, user.id, provider),
      ensureTreasuryWallet(db, user.id, provider),
    ]);
    expect(provider.createWallet).toHaveBeenCalledTimes(1);
    expect(states.map((s) => s.status)).toContain("ready");
  });

  it("marks a failed creation and resumes it with the same Para wallet next time", async () => {
    const user = await upsertUser(db, session);
    const failing = fakeProvider({
      waitUntilReady: vi.fn(async () => {
        throw new Error("Para timeout");
      }),
    });
    await expect(ensureTreasuryWallet(db, user.id, failing)).rejects.toThrow("Para timeout");
    expect(await walletRow(user.id)).toMatchObject({ status: "failed", paraWalletId: "para-w1" });

    const provider = fakeProvider();
    expect(await ensureTreasuryWallet(db, user.id, provider)).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).not.toHaveBeenCalled();
    expect(provider.waitUntilReady).toHaveBeenCalledWith("para-w1");
  });

  it("leaves a fresh creation alone but takes over one that died", async () => {
    const user = await upsertUser(db, session);
    const now = new Date("2026-10-15T12:00:00Z");
    await db.insert(treasuryWallets).values({ userId: user.id, status: "creating", updatedAt: new Date("2026-10-15T11:59:30Z") });
    const provider = fakeProvider();
    expect(await ensureTreasuryWallet(db, user.id, provider, now)).toEqual({ status: "creating" });
    expect(provider.createWallet).not.toHaveBeenCalled();

    const later = new Date("2026-10-15T12:03:00Z");
    expect(await ensureTreasuryWallet(db, user.id, provider, later)).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx vitest run src/lib/users/provision.test.ts`
Expected: FAIL, `Failed to resolve import "./provision"`.

- [ ] **Step 7: Implement `provision.ts`**

`src/lib/users/provision.ts`:

```ts
import { and, eq, lt, or, sql } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { ParaSession } from "@/lib/auth/para-jwt";
import type { Db } from "@/lib/db/client";
import { treasuryWallets, users, type UserRow } from "@/lib/db/schema";
import type { ParaWallet } from "@/lib/signer/para-rest";

/** ParaRestClient satisfies this; tests pass a fake. */
export interface TreasuryWalletProvider {
  createWallet(userId: string): Promise<ParaWallet>;
  waitUntilReady(walletId: string): Promise<ParaWallet>;
}

export type TreasuryState = { status: "ready"; address: Address } | { status: "creating" };

/** A creation older than this is assumed dead (its request was killed) and may be taken over. */
export const STALE_CREATION_MS = 2 * 60 * 1000;

export async function upsertUser(db: Db, session: ParaSession): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ paraUserId: session.paraUserId, email: session.email ?? null, personalWallet: session.evmAddress ?? null })
    .onConflictDoUpdate({
      target: users.paraUserId,
      set: {
        email: sql`coalesce(excluded.email, ${users.email})`,
        personalWallet: sql`coalesce(excluded.personal_wallet, ${users.personalWallet})`,
      },
    })
    .returning();
  return row;
}

/**
 * Spec §6.2 flow 1: one app-owned Para wallet per user (CUSTOM_ID = our user id, so email sign-in
 * never claims it). The row is inserted first as a claim, so concurrent sign-ins create one wallet.
 */
export async function ensureTreasuryWallet(
  db: Db,
  userId: string,
  provider: TreasuryWalletProvider,
  now = new Date(),
): Promise<TreasuryState> {
  const claimed = await db
    .insert(treasuryWallets)
    .values({ userId, status: "creating", updatedAt: now })
    .onConflictDoNothing({ target: treasuryWallets.userId })
    .returning({ id: treasuryWallets.id });
  if (claimed.length === 1) return createOrResume(db, userId, provider, null);

  const [row] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, userId));
  if (row.status === "ready" && row.address) return { status: "ready", address: getAddress(row.address) };

  const staleBefore = new Date(now.getTime() - STALE_CREATION_MS);
  const retaken = await db
    .update(treasuryWallets)
    .set({ status: "creating", updatedAt: now })
    .where(
      and(
        eq(treasuryWallets.userId, userId),
        or(
          eq(treasuryWallets.status, "failed"),
          and(eq(treasuryWallets.status, "creating"), lt(treasuryWallets.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning({ paraWalletId: treasuryWallets.paraWalletId });
  if (retaken.length === 0) return { status: "creating" };
  return createOrResume(db, userId, provider, retaken[0].paraWalletId);
}

async function createOrResume(
  db: Db,
  userId: string,
  provider: TreasuryWalletProvider,
  existingWalletId: string | null,
): Promise<TreasuryState> {
  const mark = (fields: Partial<typeof treasuryWallets.$inferInsert>) =>
    db.update(treasuryWallets).set({ ...fields, updatedAt: new Date() }).where(eq(treasuryWallets.userId, userId));
  try {
    let walletId = existingWalletId;
    if (!walletId) {
      walletId = (await provider.createWallet(userId)).id;
      await mark({ paraWalletId: walletId });
    }
    const ready = await provider.waitUntilReady(walletId);
    if (!ready.address) throw new Error(`Para wallet ${walletId} is ready without an address`);
    const address = getAddress(ready.address);
    await mark({ status: "ready", address });
    return { status: "ready", address };
  } catch (error) {
    await mark({ status: "failed" });
    throw error;
  }
}
```

- [ ] **Step 8: Run the provisioning tests to see them pass**

Run: `npx vitest run src/lib/users/provision.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing query test**

`src/lib/users/queries.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import { loadAppUser } from "./queries";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

describe("loadAppUser", () => {
  it("joins the treasury wallet and the chosen local currency", async () => {
    const user = await seedFreelancer(db, { localCurrency: "BRL" });
    expect(await loadAppUser(db, user.id)).toEqual({
      id: user.id,
      email: "ana@example.com",
      displayName: "Ana Diseño",
      treasuryStatus: "ready",
      treasuryAddress: TEST_TREASURY,
      localCurrency: "BRL",
    });
  });

  it("reports a user who has not onboarded and has no wallet yet", async () => {
    const [user] = await db.insert(users).values({ paraUserId: "para-new" }).returning();
    expect(await loadAppUser(db, user.id)).toMatchObject({
      treasuryStatus: "missing",
      treasuryAddress: null,
      localCurrency: null,
    });
  });

  it("returns null for an unknown user", async () => {
    expect(await loadAppUser(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
```

- [ ] **Step 10: Implement `queries.ts`**

`src/lib/users/queries.ts`:

```ts
import { eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import { rules, treasuryWallets, users } from "@/lib/db/schema";
import type { LocalCurrency } from "@/lib/money/currencies";

export interface AppUser {
  id: string;
  email: string | null;
  displayName: string | null;
  treasuryStatus: "missing" | "creating" | "ready" | "failed";
  treasuryAddress: Address | null;
  /** Null until onboarding (Task 7) creates the rules row. */
  localCurrency: LocalCurrency | null;
}

export async function loadAppUser(db: Db, userId: string): Promise<AppUser | null> {
  const [row] = await db
    .select({ user: users, wallet: treasuryWallets, localCurrency: rules.localCurrency })
    .from(users)
    .leftJoin(treasuryWallets, eq(treasuryWallets.userId, users.id))
    .leftJoin(rules, eq(rules.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) return null;
  const ready = row.wallet?.status === "ready" && row.wallet.address;
  return {
    id: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    treasuryStatus: row.wallet?.status ?? "missing",
    treasuryAddress: ready ? getAddress(row.wallet!.address!) : null,
    localCurrency: row.localCurrency ?? null,
  };
}
```

`TEST_TREASURY` is all `1`s, which is its own checksum form, so the equality in the test holds.

- [ ] **Step 11: Run the user tests to see them pass**

Run: `npx vitest run src/lib/users src/lib/auth`
Expected: PASS.

- [ ] **Step 12: Add the env-backed Para helpers, the current-user helpers and the session route**

`src/lib/users/para.ts`:

```ts
import type { JWTVerifyGetKey } from "jose";
import { paraJwks } from "@/lib/auth/para-jwt";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { ParaRestClient } from "@/lib/signer/para-rest";

let keys: JWTVerifyGetKey | undefined;

/** Cached per instance so Para's JWKS is fetched once, not on every sign-in. */
export function paraSessionKeys(): JWTVerifyGetKey {
  keys ??= paraJwks(parseServerEnv().PARA_JWKS_URL);
  return keys;
}

export function paraRestClient(): ParaRestClient {
  const env = parseServerEnv();
  return new ParaRestClient({ apiKey: requireValue(env.PARA_API_KEY, "PARA_API_KEY"), baseUrl: env.PARA_REST_BASE_URL });
}
```

`src/lib/auth/current-user.ts`:

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { loadAppUser, type AppUser } from "@/lib/users/queries";
import { SESSION_COOKIE, verifySession } from "./session";

/** Reads the request's cookies: call it only inside a <Suspense> boundary, a Route Handler or a Server Action. */
export async function getCurrentUser(): Promise<AppUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token, requireValue(parseServerEnv().SESSION_SECRET, "SESSION_SECRET"));
  if (!session) return null;
  return loadAppUser(getDb(), session.userId);
}

export async function requireUser(opts: { allowOnboarding?: boolean } = {}): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!user.localCurrency && !opts.allowOnboarding) redirect("/app/onboarding");
  return user;
}
```

`src/app/api/session/route.ts`:

```ts
import { cookies } from "next/headers";
import { verifyParaJwt, type ParaSession } from "@/lib/auth/para-jwt";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { paraRestClient, paraSessionKeys } from "@/lib/users/para";
import { ensureTreasuryWallet, upsertUser } from "@/lib/users/provision";
import { loadAppUser } from "@/lib/users/queries";

/** Exchanges a Para session JWT for our own session cookie and provisions the user. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") return Response.json({ error: "token_required" }, { status: 400 });

  let session: ParaSession;
  try {
    session = await verifyParaJwt(body.token, paraSessionKeys());
  } catch {
    return Response.json({ error: "invalid_session" }, { status: 401 });
  }

  const db = getDb();
  const user = await upsertUser(db, session);
  try {
    await ensureTreasuryWallet(db, user.id, paraRestClient());
  } catch (error) {
    // The session still starts; the home page offers "Finish setup", which retries.
    console.error("Treasury wallet setup failed:", error instanceof Error ? error.message : error);
  }

  const token = await signSession(user.id, requireValue(parseServerEnv().SESSION_SECRET, "SESSION_SECRET"));
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  const appUser = await loadAppUser(db, user.id);
  return Response.json({ next: appUser?.localCurrency ? "/app" : "/app/onboarding" });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 13: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: all pass.

```bash
git add src/lib/auth src/lib/users src/app/api/session
git commit -m "feat(auth): exchange Para sign-in for a session and provision one treasury wallet per user

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sign-in page, app shell, settings and sign-out

**Files:**
- Create: `src/lib/auth/gate.ts`, `src/lib/auth/gate.test.ts`, `src/proxy.ts`, `src/components/providers/para-provider.tsx`, `src/components/submit-button.tsx`, `src/app/signin/page.tsx`, `src/app/signin/sign-in.tsx`, `src/app/app/layout.tsx`, `src/app/app/app-nav.tsx`, `src/app/app/page.tsx`, `src/app/app/actions.ts`, `src/app/app/settings/page.tsx`, `src/app/app/settings/sign-out.tsx`, `src/components/ui/skeleton.tsx` (shadcn)
- Modify: `src/app/page.tsx`, `src/i18n/en.ts`
- Delete: `src/app/spike/para-login/page.tsx`, `src/app/spike/para-login/para-login.tsx`, `src/app/spike/para-login/para-provider.tsx`, `src/app/api/spike/para-verify/route.ts`

**Interfaces:**
- Consumes: `SESSION_COOKIE` (Task 5), `requireUser`, `AppUser` (Task 5), `ensureTreasuryWallet`, `paraRestClient` (Task 5), `getDb` (Task 1), `readPublicEnv` with the Para keys (Task 1), `Button`, `Card*` (Plan 1).
- Produces:
  - `safeNext(next: string | null | undefined): string` (only `/app`, `/app/…` or `/app?…`, else `/app`), `signInRedirect(pathname: string, search: string, hasSession: boolean): string | null`.
  - `<ParaProviders apiKey environment>`; `<SubmitButton pendingLabel>` (client, `useFormStatus`, disabled with a spinner while pending).
  - Pages `/signin`, `/app` (home; Task 9 rewrites its body), `/app/settings`; server action `finishSetup()`.
  - i18n keys under `signin.*`, `nav.*`, `app.*`, `setup.*`, `settings.*`, `currency.*`, `common.*`.

- [ ] **Step 1: Write the failing gate tests**

`src/lib/auth/gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { safeNext, signInRedirect } from "./gate";

describe("signInRedirect", () => {
  it("sends signed-out visitors of /app to sign-in and remembers where they were", () => {
    expect(signInRedirect("/app/invoices/new", "?first=1", false)).toBe("/signin?next=%2Fapp%2Finvoices%2Fnew%3Ffirst%3D1");
    expect(signInRedirect("/app", "", false)).toBe("/signin?next=%2Fapp");
  });

  it("lets signed-in visitors and public pages through", () => {
    expect(signInRedirect("/app", "", true)).toBeNull();
    expect(signInRedirect("/pay/abc", "", false)).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps paths inside the app", () => {
    expect(safeNext("/app/invoices/new?first=1")).toBe("/app/invoices/new?first=1");
    expect(safeNext("/app")).toBe("/app");
  });

  it("refuses anything that could leave the app", () => {
    expect(safeNext("//evil.example")).toBe("/app");
    expect(safeNext("https://evil.example/app")).toBe("/app");
    expect(safeNext("/apple")).toBe("/app");
    expect(safeNext("/app\\@evil.example")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/auth/gate.test.ts`
Expected: FAIL, `Failed to resolve import "./gate"`.

- [ ] **Step 3: Implement `gate.ts` and the proxy**

`src/lib/auth/gate.ts`:

```ts
/** Where to return after sign-in. Only app paths, so ?next= can never send someone off-site. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.includes("\\")) return "/app";
  if (next === "/app" || next.startsWith("/app/") || next.startsWith("/app?")) return next;
  return "/app";
}

/** Proxy check: a cookie's presence only; requireUser() verifies it inside the page. */
export function signInRedirect(pathname: string, search: string, hasSession: boolean): string | null {
  if (hasSession || !(pathname === "/app" || pathname.startsWith("/app/"))) return null;
  return `/signin?next=${encodeURIComponent(pathname + search)}`;
}
```

`src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { signInRedirect } from "@/lib/auth/gate";
import { SESSION_COOKIE } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const target = signInRedirect(request.nextUrl.pathname, request.nextUrl.search, request.cookies.has(SESSION_COOKIE));
  return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
}

export const config = { matcher: ["/app", "/app/:path*"] };
```

- [ ] **Step 4: Run the gate tests to see them pass**

Run: `npx vitest run src/lib/auth/gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the strings**

Add to `src/i18n/en.ts`, and delete every `"spike.*"` key and `"home.status"`:

```ts
  "home.start": "Start with email",
  "home.how": "Create an invoice, share the link, and get paid in dollars or pesos. No crypto knowledge needed.",
  "common.loading": "Loading…",
  "common.details": "Details",
  "currency.USD": "US dollars (USD)",
  "currency.ARS": "Argentine pesos (ARS)",
  "currency.BRL": "Brazilian reais (BRL)",
  "signin.title": "Sign in to Cobro",
  "signin.intro": "Use your email. We create your account and wallets for you, with no password or recovery phrase to keep.",
  "signin.continue": "Continue with email",
  "signin.creating": "Setting up your account… This can take up to 30 seconds.",
  "signin.error": "We couldn't sign you in. Please try again.",
  "signin.retry": "Try again",
  "signin.missingKey": "Sign-in is not configured. Set NEXT_PUBLIC_PARA_API_KEY and rebuild.",
  "nav.label": "Main",
  "nav.home": "Home",
  "nav.settings": "Settings",
  "app.greeting": "Hi, {name}",
  "setup.creating": "We're still setting up your wallet. This usually takes a few seconds.",
  "setup.failed": "We couldn't finish setting up your wallet.",
  "setup.retry": "Finish setup",
  "setup.working": "Finishing setup…",
  "settings.title": "Settings",
  "settings.email": "Email",
  "settings.name": "Name on invoices",
  "settings.currency": "Spending currency",
  "settings.notSet": "Not set yet",
  "settings.signOut": "Sign out",
  "settings.signingOut": "Signing out…",
```

- [ ] **Step 6: Add the shared providers and submit button**

Run: `npx shadcn@4.21.4 add skeleton --yes`
Expected: `src/components/ui/skeleton.tsx` is created.

`src/components/providers/para-provider.tsx` (moved from the spike):

```tsx
"use client";

import { Environment, ParaProvider } from "@getpara/react-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

// Para 3.21 deprecates paraModalConfig (auth methods, layout, theme): email-only sign-in and
// Cobro branding are configured in the Para Developer Portal instead.
export function ParaProviders({
  apiKey,
  environment,
  children,
}: {
  apiKey: string;
  environment: "BETA" | "PROD";
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{ apiKey, env: environment === "PROD" ? Environment.PROD : Environment.BETA }}
        config={{ appName: "Cobro" }}
      >
        {children}
      </ParaProvider>
    </QueryClientProvider>
  );
}
```

`src/components/submit-button.tsx`:

```tsx
"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Primary form button: disabled with a spinner while its form's Server Action runs (MASTER.md "Buttons"). */
export function SubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="min-h-11 w-full sm:w-auto" disabled={pending} aria-disabled={pending}>
      {pending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
      {pending ? pendingLabel : children}
    </Button>
  );
}
```

Then delete the spike UI and route:

```bash
git rm -r src/app/spike src/app/api/spike
```

- [ ] **Step 7: Build the sign-in page**

`src/app/signin/page.tsx`:

```tsx
import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ParaProviders } from "@/components/providers/para-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { readPublicEnv } from "@/lib/config/public";
import { SignIn } from "./sign-in";

export const metadata: Metadata = { title: `${t("signin.title")} · ${t("app.name")}` };

export default function SignInPage() {
  const env = readPublicEnv();
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center px-4 py-12 md:px-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">{t("signin.title")}</CardTitle>
          <CardDescription>{t("signin.intro")}</CardDescription>
        </CardHeader>
        <CardContent>
          {env.NEXT_PUBLIC_PARA_API_KEY ? (
            <ParaProviders apiKey={env.NEXT_PUBLIC_PARA_API_KEY} environment={env.NEXT_PUBLIC_PARA_ENVIRONMENT}>
              {/* useSearchParams suspends during prerender */}
              <Suspense fallback={<p className="text-muted-foreground">{t("common.loading")}</p>}>
                <SignIn />
              </Suspense>
            </ParaProviders>
          ) : (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              {t("signin.missingKey")}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

`src/app/signin/sign-in.tsx`:

```tsx
"use client";

import { useAccount, useIssueJwt, useModal } from "@getpara/react-sdk";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { safeNext } from "@/lib/auth/gate";

type Phase = "idle" | "creating" | "error";

export function SignIn() {
  const { isConnected } = useAccount();
  const { openModal } = useModal();
  const { issueJwtAsync } = useIssueJwt();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const started = useRef(false);

  async function createSession() {
    started.current = true;
    setPhase("creating");
    try {
      const { token } = await issueJwtAsync();
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error(`Session request failed with ${response.status}`);
      const { next } = (await response.json()) as { next: string };
      router.replace(next === "/app" ? safeNext(searchParams.get("next")) : next);
    } catch {
      started.current = false;
      setPhase("error");
    }
  }

  // Para's modal closes once the email code is accepted; continue without another click.
  // If lint reports react-hooks/set-state-in-effect here, move setPhase("creating") below the
  // first await in createSession; `started` already prevents a second run.
  useEffect(() => {
    if (isConnected && !started.current) void createSession();
  });

  return (
    <div className="flex flex-col gap-4">
      {phase === "creating" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
          {t("signin.creating")}
        </p>
      ) : (
        <Button
          size="lg"
          className="min-h-11"
          onClick={() => (isConnected ? void createSession() : openModal())}
        >
          {phase === "error" ? t("signin.retry") : t("signin.continue")}
        </Button>
      )}
      <div aria-live="polite">
        {phase === "error" && (
          <p className="flex items-start gap-2 text-destructive" role="alert">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t("signin.error")}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build the app shell, home and settings**

`src/app/app/layout.tsx`:

```tsx
import { Suspense } from "react";
import { AppNav, AppNavLinks } from "./app-nav";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* usePathname can suspend on dynamic routes; the fallback is the same nav without the active mark */}
      <Suspense fallback={<AppNavLinks pathname={null} />}>
        <AppNav />
      </Suspense>
      {/* pb-20 keeps content clear of the fixed mobile bar */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-0">{children}</div>
    </div>
  );
}
```

`src/app/app/app-nav.tsx`:

```tsx
"use client";

import { House, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type MessageKey } from "@/i18n";

// Plan 3 adds "Agent" (rules) between these, as MASTER.md lists: Home, Invoices, Agent, Settings.
const ITEMS: { href: string; label: MessageKey; icon: typeof House }[] = [
  { href: "/app", label: "nav.home", icon: House },
  { href: "/app/settings", label: "nav.settings", icon: Settings },
];

export function AppNav() {
  return <AppNavLinks pathname={usePathname()} />;
}

export function AppNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label={t("nav.label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card lg:static lg:w-60 lg:shrink-0 lg:border-r lg:border-t-0"
    >
      <p className="hidden px-6 py-6 text-lg font-semibold text-primary lg:block">{t("app.name")}</p>
      <ul className="flex lg:flex-col">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname !== null && (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
          return (
            <li key={href} className="flex-1 lg:flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-6 lg:text-sm ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon aria-hidden="true" className="size-5" />
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`src/app/app/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { paraRestClient } from "@/lib/users/para";
import { ensureTreasuryWallet } from "@/lib/users/provision";

/** Retries treasury wallet creation for the signed-in user ("Finish setup"). */
export async function finishSetup(): Promise<void> {
  const user = await requireUser({ allowOnboarding: true });
  try {
    await ensureTreasuryWallet(getDb(), user.id, paraRestClient());
  } catch (error) {
    console.error("Treasury wallet setup failed:", error instanceof Error ? error.message : error);
  }
  redirect(user.localCurrency ? "/app" : "/app/onboarding");
}
```

`src/app/app/page.tsx` (Task 9 replaces the body of `Home`):

```tsx
import { CircleAlert, Clock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import type { AppUser } from "@/lib/users/queries";
import { finishSetup } from "./actions";

export const metadata: Metadata = { title: `${t("nav.home")} · ${t("app.name")}` };

export default function AppHomePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Suspense fallback={<Skeleton className="h-8 w-48" />}>
        <Home />
      </Suspense>
    </main>
  );
}

async function Home() {
  const user = await requireUser();
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("app.greeting", { name: user.displayName ?? user.email ?? "" })}</h1>
      <SetupBanner status={user.treasuryStatus} />
    </>
  );
}

// Not exported: a page module may only export Next.js page fields.
function SetupBanner({ status }: { status: AppUser["treasuryStatus"] }) {
  if (status === "ready") return null;
  const failed = status === "failed" || status === "missing";
  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className={`flex items-start gap-2 ${failed ? "text-destructive" : "text-warning"}`}>
        {failed ? (
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        ) : (
          <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        )}
        {failed ? t("setup.failed") : t("setup.creating")}
      </p>
      <form action={finishSetup}>
        <SubmitButton pendingLabel={t("setup.working")}>{t("setup.retry")}</SubmitButton>
      </form>
    </section>
  );
}
```

`src/app/app/settings/page.tsx`:

```tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { ParaProviders } from "@/components/providers/para-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { readPublicEnv } from "@/lib/config/public";
import { SignOutButton } from "./sign-out";

export const metadata: Metadata = { title: `${t("settings.title")} · ${t("app.name")}` };

export default function SettingsPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <Settings />
      </Suspense>
    </main>
  );
}

async function Settings() {
  const user = await requireUser({ allowOnboarding: true });
  const env = readPublicEnv();
  const rows = [
    { label: t("settings.email"), value: user.email ?? t("settings.notSet") },
    { label: t("settings.name"), value: user.displayName ?? t("settings.notSet") },
    { label: t("settings.currency"), value: user.localCurrency ? t(`currency.${user.localCurrency}` as const) : t("settings.notSet") },
  ];
  return (
    <>
      <Card>
        <CardContent>
          <dl className="flex flex-col gap-4">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {env.NEXT_PUBLIC_PARA_API_KEY && (
        <ParaProviders apiKey={env.NEXT_PUBLIC_PARA_API_KEY} environment={env.NEXT_PUBLIC_PARA_ENVIRONMENT}>
          <SignOutButton />
        </ParaProviders>
      )}
    </>
  );
}
```

`src/app/app/settings/sign-out.tsx`:

```tsx
"use client";

import { useLogout } from "@getpara/react-sdk";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function SignOutButton() {
  const { logoutAsync } = useLogout();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await logoutAsync();
    } catch {
      // Para may already be signed out; our cookie is what matters.
    }
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/");
  }

  return (
    <Button variant="outline" size="lg" className="min-h-11 w-fit" onClick={signOut} disabled={pending}>
      <LogOut aria-hidden="true" className="size-4" />
      {pending ? t("settings.signingOut") : t("settings.signOut")}
    </Button>
  );
}
```

If `useLogout` is not exported by `@getpara/react-sdk`, import it from `@getpara/react-core` (it is defined there in 3.21).

- [ ] **Step 9: Point the landing page at sign-in**

In `src/app/page.tsx`, replace the `<p className="max-w-prose text-muted-foreground">{t("home.status")}</p>` line with:

```tsx
      <p className="max-w-prose text-muted-foreground">{t("home.how")}</p>
      <Link
        href="/signin"
        className="inline-flex min-h-11 w-fit items-center rounded-lg bg-primary px-5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t("home.start")}
      </Link>
```

- [ ] **Step 10: Verify the build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. The build must not report "Uncached data was accessed outside of <Suspense>" or "blocking-route"; if it does, the named component reads `cookies()`/`params` outside a boundary — move that read under the page's `<Suspense>`.

- [ ] **Step 11: Check sign-in by hand**

Run: `npm run dev`, then in a browser at 375px width:
1. Open `/app` signed out → redirected to `/signin?next=%2Fapp`.
2. "Continue with email" → Para modal → enter an email and the code → "Setting up your account…" → redirected to `/app/onboarding` (404 until Task 7; that is expected now).
3. Open `/app/settings` → email shown, "Not set yet" for name and currency; "Sign out" → back on `/`; `/app` redirects to `/signin` again.
4. Sign in again with the same email → no second treasury wallet: `select count(*) from treasury_wallets` in the Neon SQL editor is 1.
5. Keyboard only: Tab reaches every control with a visible focus ring.

- [ ] **Step 12: Commit**

```bash
git add -A src/proxy.ts src/lib/auth src/components src/app src/i18n/en.ts
git commit -m "feat(app): email sign-in page, signed-in app shell, settings and sign-out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Onboarding: name, spending currency and reserve

**Files:**
- Create: `src/lib/forms.ts`, `src/lib/users/onboarding.ts`, `src/lib/users/onboarding.test.ts`, `src/components/form-field.tsx`, `src/app/app/onboarding/page.tsx`, `src/app/app/onboarding/onboarding-form.tsx`, `src/app/app/onboarding/actions.ts`, `src/components/ui/input.tsx`, `src/components/ui/label.tsx` (shadcn)
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: `parseFiatInput` (Task 2), `isLocalCurrency`, `LocalCurrency` (Task 2), `Db`, `users`, `rules`, test helpers (Task 1), `requireUser` (Task 5), `SubmitButton` (Task 6), `MessageKey` (Plan 1).
- Produces:
  - `type FieldErrors<F extends string> = Partial<Record<F, MessageKey>>`, `type FormResult<T, F extends string> = { ok: true; data: T } | { ok: false; errors: FieldErrors<F> }`, `formFields(formData: FormData): Record<string, string>`.
  - `interface OnboardingInput { displayName: string; localCurrency: LocalCurrency; reserveAmount: string }`, `type OnboardingField = "displayName" | "localCurrency" | "reserveAmount"`, `parseOnboardingForm(fields): FormResult<OnboardingInput, OnboardingField>`, `saveOnboarding(db, userId, input): Promise<void>`.
  - `<FormField id label help? error?>` and `fieldA11y(id, { help?, error? })` returning `id`, `name`, `aria-invalid`, `aria-describedby`.
  - Page `/app/onboarding` (step 2 of 3), which sends the user on to `/app/invoices/new?first=1` (step 3, Task 9).

- [ ] **Step 1: Write the failing onboarding tests**

`src/lib/users/onboarding.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { rules, users } from "@/lib/db/schema";
import { createTestDb, resetDb } from "@/lib/db/testing";
import { parseOnboardingForm, saveOnboarding } from "./onboarding";

describe("parseOnboardingForm", () => {
  it("accepts a name, a currency and a reserve", () => {
    expect(parseOnboardingForm({ displayName: "  Ana Diseño ", localCurrency: "ARS", reserveAmount: "300000" })).toEqual({
      ok: true,
      data: { displayName: "Ana Diseño", localCurrency: "ARS", reserveAmount: "300000.00" },
    });
  });

  it("treats an empty reserve as zero", () => {
    const result = parseOnboardingForm({ displayName: "Ana", localCurrency: "BRL", reserveAmount: "" });
    expect(result).toMatchObject({ ok: true, data: { reserveAmount: "0.00" } });
  });

  it("names every problem at once", () => {
    expect(parseOnboardingForm({ displayName: " ", localCurrency: "USD", reserveAmount: "300.000,00" })).toEqual({
      ok: false,
      errors: {
        displayName: "onboarding.error.name",
        localCurrency: "onboarding.error.currency",
        reserveAmount: "money.error.format",
      },
    });
    expect(parseOnboardingForm({ displayName: "x".repeat(61), localCurrency: "ARS", reserveAmount: "0" })).toMatchObject({
      ok: false,
      errors: { displayName: "onboarding.error.nameLong" },
    });
  });
});

describe("saveOnboarding", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it("stores the name and creates the rules, then updates them on a second save", async () => {
    const [user] = await db.insert(users).values({ paraUserId: "para-1" }).returning();
    await saveOnboarding(db, user.id, { displayName: "Ana", localCurrency: "ARS", reserveAmount: "300000.00" });
    await saveOnboarding(db, user.id, { displayName: "Ana D.", localCurrency: "BRL", reserveAmount: "1500.00" });
    const [saved] = await db.select().from(users).where(eq(users.id, user.id));
    const [userRules] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(saved.displayName).toBe("Ana D.");
    expect(userRules).toMatchObject({ localCurrency: "BRL", reserveAmount: "1500.00" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/users/onboarding.test.ts`
Expected: FAIL, `Failed to resolve import "./onboarding"`.

- [ ] **Step 3: Implement `forms.ts` and `onboarding.ts`**

`src/lib/forms.ts`:

```ts
import type { MessageKey } from "@/i18n";

export type FieldErrors<F extends string> = Partial<Record<F, MessageKey>>;
export type FormResult<T, F extends string> = { ok: true; data: T } | { ok: false; errors: FieldErrors<F> };

/** String fields of a submitted form (file inputs are ignored). */
export function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}
```

`src/lib/users/onboarding.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rules, users } from "@/lib/db/schema";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { isLocalCurrency, type LocalCurrency } from "@/lib/money/currencies";
import { parseFiatInput } from "@/lib/money/input";

export interface OnboardingInput {
  displayName: string;
  localCurrency: LocalCurrency;
  reserveAmount: string;
}
export type OnboardingField = "displayName" | "localCurrency" | "reserveAmount";

export function parseOnboardingForm(fields: Record<string, string>): FormResult<OnboardingInput, OnboardingField> {
  const errors: FieldErrors<OnboardingField> = {};
  const displayName = (fields.displayName ?? "").trim();
  if (displayName === "") errors.displayName = "onboarding.error.name";
  else if (displayName.length > 60) errors.displayName = "onboarding.error.nameLong";

  const localCurrency = fields.localCurrency;
  if (!isLocalCurrency(localCurrency)) errors.localCurrency = "onboarding.error.currency";

  const rawReserve = (fields.reserveAmount ?? "").trim();
  const reserve = parseFiatInput(rawReserve === "" ? "0" : rawReserve, { allowZero: true });
  if (!reserve.ok) errors.reserveAmount = `money.error.${reserve.error}`;

  if (Object.keys(errors).length > 0 || !isLocalCurrency(localCurrency) || !reserve.ok) return { ok: false, errors };
  return { ok: true, data: { displayName, localCurrency, reserveAmount: reserve.value } };
}

export async function saveOnboarding(db: Db, userId: string, input: OnboardingInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, userId));
    await tx
      .insert(rules)
      .values({ userId, localCurrency: input.localCurrency, reserveAmount: input.reserveAmount })
      .onConflictDoUpdate({
        target: rules.userId,
        set: { localCurrency: input.localCurrency, reserveAmount: input.reserveAmount, updatedAt: new Date() },
      });
  });
}
```

- [ ] **Step 4: Add the strings**

Add to `src/i18n/en.ts`:

```ts
  "onboarding.title": "Set up your account",
  "onboarding.step": "Step {step} of {total}",
  "onboarding.name": "Your name or business",
  "onboarding.nameHelp": "Clients see this on your invoices.",
  "onboarding.currency": "What do you spend in?",
  "onboarding.reserveBefore": "Keep",
  "onboarding.reserveAfter": "for spending. Save the rest in dollars.",
  "onboarding.reserveLabel": "Spending reserve",
  "onboarding.reserveHelp": "Your agent keeps this much in your currency and protects the rest from inflation. You can change it later.",
  "onboarding.submit": "Continue",
  "onboarding.saving": "Saving…",
  "onboarding.error.name": "Enter the name clients should see.",
  "onboarding.error.nameLong": "Use at most 60 characters.",
  "onboarding.error.currency": "Choose pesos or reais.",
```

- [ ] **Step 5: Add the form building blocks**

Run: `npx shadcn@4.21.4 add input label --yes`
Expected: `src/components/ui/input.tsx` and `src/components/ui/label.tsx` are created.

`src/components/form-field.tsx`:

```tsx
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { t, type MessageKey } from "@/i18n";

/** Accessible wiring for an input: label above, help and error below, linked by aria-describedby. */
export function fieldA11y(id: string, opts: { help?: string; error?: MessageKey }) {
  const describedBy = [opts.help ? `${id}-help` : null, opts.error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    id,
    name: id,
    "aria-invalid": opts.error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

export function FormField({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: MessageKey;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1 text-sm text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t(error)}
        </p>
      )}
    </div>
  );
}
```

Inputs in Cobro forms use `className="h-11 text-base"` (44px target, 16px text so iOS does not zoom).

- [ ] **Step 6: Build the onboarding page**

`src/app/app/onboarding/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { formFields, type FieldErrors } from "@/lib/forms";
import { parseOnboardingForm, saveOnboarding, type OnboardingField } from "@/lib/users/onboarding";

export interface OnboardingState {
  errors: FieldErrors<OnboardingField>;
  values: Record<string, string>;
}

export async function completeOnboarding(_previous: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const user = await requireUser({ allowOnboarding: true });
  const fields = formFields(formData);
  const parsed = parseOnboardingForm(fields);
  if (!parsed.ok) return { errors: parsed.errors, values: fields };
  await saveOnboarding(getDb(), user.id, parsed.data);
  redirect("/app/invoices/new?first=1");
}
```

`src/app/app/onboarding/onboarding-form.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { LOCAL_CURRENCIES, type LocalCurrency } from "@/lib/money/currencies";
import { completeOnboarding, type OnboardingState } from "./actions";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState(completeOnboarding, {
    errors: {},
    values: { displayName: defaultName, localCurrency: "ARS", reserveAmount: "" },
  } satisfies OnboardingState);
  const [currency, setCurrency] = useState<LocalCurrency>(state.values.localCurrency === "BRL" ? "BRL" : "ARS");
  const reserveHelp = t("onboarding.reserveHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <FormField id="displayName" label={t("onboarding.name")} help={t("onboarding.nameHelp")} error={state.errors.displayName}>
        <Input
          {...fieldA11y("displayName", { help: t("onboarding.nameHelp"), error: state.errors.displayName })}
          autoComplete="organization"
          defaultValue={state.values.displayName}
          className="h-11 text-base"
        />
      </FormField>

      <fieldset className="flex flex-col gap-2" aria-describedby={state.errors.localCurrency ? "localCurrency-error" : undefined}>
        <legend className="mb-2 text-sm font-medium">{t("onboarding.currency")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {LOCAL_CURRENCIES.map((code) => (
            <label
              key={code}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-4 py-3 has-checked:border-primary has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name="localCurrency"
                value={code}
                checked={currency === code}
                onChange={() => setCurrency(code)}
                className="size-4 accent-primary"
              />
              <span className="font-medium">{t(`currency.${code}` as const)}</span>
            </label>
          ))}
        </div>
        {state.errors.localCurrency && (
          <p id="localCurrency-error" className="text-sm text-destructive">
            {t(state.errors.localCurrency)}
          </p>
        )}
      </fieldset>

      <FormField id="reserveAmount" label={t("onboarding.reserveLabel")} help={reserveHelp} error={state.errors.reserveAmount}>
        <p className="flex flex-wrap items-center gap-2 text-base">
          <span aria-hidden="true">{t("onboarding.reserveBefore")}</span>
          <Input
            {...fieldA11y("reserveAmount", { help: reserveHelp, error: state.errors.reserveAmount })}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            defaultValue={state.values.reserveAmount}
            className="h-11 w-40 text-base tabular-nums"
          />
          <span aria-hidden="true">
            {currency} {t("onboarding.reserveAfter")}
          </span>
        </p>
      </FormField>

      <SubmitButton pendingLabel={t("onboarding.saving")}>{t("onboarding.submit")}</SubmitButton>
    </form>
  );
}
```

`src/app/app/onboarding/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: `${t("onboarding.title")} · ${t("app.name")}` };

export default function OnboardingPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">{t("onboarding.step", { step: 2, total: 3 })}</p>
        <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden="true">
          <div className="h-full w-2/3 rounded-full bg-primary" />
        </div>
      </div>
      <h1 className="text-2xl font-semibold">{t("onboarding.title")}</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Onboarding />
      </Suspense>
    </main>
  );
}

async function Onboarding() {
  const user = await requireUser({ allowOnboarding: true });
  if (user.localCurrency) redirect("/app");
  return <OnboardingForm defaultName={user.displayName ?? ""} />;
}
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

By hand (`npm run dev`, 375px): sign in as a new user → `/app/onboarding` → submit empty → "Enter the name clients should see." under the name field, focus stays usable; enter `300.000,00` → the format error under the reserve; fix and continue → `/app/invoices/new?first=1` (404 until Task 9). Revisit `/app/onboarding` → redirected to `/app`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/forms.ts src/lib/users src/components src/app/app/onboarding src/i18n/en.ts
git commit -m "feat(onboarding): ask for name, spending currency and reserve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Invoices and recurring invoices (domain)

**Files:**
- Create: `src/lib/invoices/slug.ts`, `src/lib/invoices/dates.ts`, `src/lib/invoices/schedule.ts`, `src/lib/invoices/input.ts`, `src/lib/invoices/repo.ts`, and tests `src/lib/invoices/slug.test.ts`, `src/lib/invoices/schedule.test.ts`, `src/lib/invoices/input.test.ts`, `src/lib/invoices/repo.test.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: `parseFiatInput`, `isFiatCurrency`, `FiatCurrency` (Task 2); `FieldErrors`, `FormResult` (Task 7); `Db`, tables, row types, `InvoiceStatus`, `RecurringInterval`, test helpers (Task 1).
- Produces:
  - `SLUG_LENGTH = 10`, `newSlug(randomBytes?: (n: number) => Uint8Array): string`.
  - `DAY_MS`, `addDays(date: Date, days: number): Date`, `isoDate(date: Date): string` (`YYYY-MM-DD`, UTC), `formatDate(value: Date | string, locale?: string): string` (e.g. `Oct 15, 2026`).
  - `nextIssueAt(previous: Date, interval: RecurringInterval, anchorDay: number): Date`.
  - `interface InvoiceInput { clientName: string; description: string; amount: string; currency: FiatCurrency; dueDate: string | null; repeat: "none" | RecurringInterval }`, `type InvoiceField`, `parseInvoiceForm(fields: Record<string, string>, today: string): FormResult<InvoiceInput, InvoiceField>`.
  - `RECURRING_DUE_DAYS = 7`.
  - `createInvoice(db, userId, input): Promise<InvoiceRow>`; `createRecurring(db, userId, input, now: Date): Promise<{ recurring: RecurringInvoiceRow; first: InvoiceRow }>`; `issueDueRecurring(db, now: Date, limit?: number): Promise<number>`.
  - `listInvoices(db, userId, limit?): Promise<InvoiceRow[]>` (newest first); `getOwnedInvoice(db, userId, invoiceId): Promise<OwnedInvoice | null>` with `interface OwnedInvoice { invoice: InvoiceRow; recurring: { slug: string; interval: RecurringInterval } | null; payments: PaymentRow[] }`.
  - `interface PublicInvoice { id; slug; clientName; description; amount: string; currency: FiatCurrency; dueDate: string | null; status: InvoiceStatus; settlingUntil: Date | null; freelancerName: string | null; payTo: Address | null; recurringSlug: string | null }`, `findPublicInvoice(db, slug): Promise<PublicInvoice | null>`.
  - `type RecurringLink = { kind: "open"; invoiceSlug: string } | { kind: "all-paid"; clientName: string; description: string; freelancerName: string | null; paid: { slug: string; periodStart: Date | null; paidAt: Date | null; amount: string; currency: FiatCurrency }[] }`, `resolveRecurringLink(db, slug): Promise<RecurringLink | null>`.

- [ ] **Step 1: Write the failing slug, date and schedule tests**

`src/lib/invoices/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newSlug, SLUG_LENGTH } from "./slug";

describe("newSlug", () => {
  it("makes 10 base58 characters", () => {
    const slug = newSlug();
    expect(slug).toHaveLength(SLUG_LENGTH);
    expect(slug).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
    expect(newSlug()).not.toBe(slug);
  });

  it("maps bytes onto the alphabet and skips bytes that would bias it", () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 255 : i - 1));
    expect(newSlug(bytes)).toBe("123456789A");
  });
});
```

`src/lib/invoices/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, formatDate, isoDate } from "./dates";
import { nextIssueAt } from "./schedule";

const d = (iso: string) => new Date(iso);

describe("dates", () => {
  it("adds days and prints UTC dates", () => {
    expect(isoDate(addDays(d("2026-10-30T22:00:00Z"), 7))).toBe("2026-11-06");
    expect(formatDate("2026-10-15")).toBe("Oct 15, 2026");
    expect(formatDate(d("2026-10-15T23:30:00Z"))).toBe("Oct 15, 2026");
  });
});

describe("nextIssueAt", () => {
  it("adds a week, keeping the time of day", () => {
    expect(nextIssueAt(d("2026-10-08T14:30:00Z"), "weekly", 8)).toEqual(d("2026-10-15T14:30:00Z"));
  });

  it("moves to the same day next month", () => {
    expect(nextIssueAt(d("2026-10-15T09:00:00Z"), "monthly", 15)).toEqual(d("2026-11-15T09:00:00Z"));
    expect(nextIssueAt(d("2026-12-15T09:00:00Z"), "monthly", 15)).toEqual(d("2027-01-15T09:00:00Z"));
  });

  it("clamps to short months and returns to the anchor day afterwards", () => {
    const feb = nextIssueAt(d("2027-01-31T09:00:00Z"), "monthly", 31);
    expect(feb).toEqual(d("2027-02-28T09:00:00Z"));
    expect(nextIssueAt(feb, "monthly", 31)).toEqual(d("2027-03-31T09:00:00Z"));
    expect(nextIssueAt(d("2028-01-31T09:00:00Z"), "monthly", 31)).toEqual(d("2028-02-29T09:00:00Z"));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/invoices`
Expected: FAIL, `Failed to resolve import "./slug"` (and `./dates`).

- [ ] **Step 3: Implement `slug.ts`, `dates.ts` and `schedule.ts`**

`src/lib/invoices/slug.ts`:

```ts
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SLUG_LENGTH = 10;
/** 232 = 4 × 58: bytes at or above it are skipped so every character is equally likely. */
const LIMIT = 232;

export function newSlug(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  let slug = "";
  while (slug.length < SLUG_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte < LIMIT && slug.length < SLUG_LENGTH) slug += ALPHABET[byte % 58];
    }
  }
  return slug;
}
```

`src/lib/invoices/dates.ts`:

```ts
export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** YYYY-MM-DD in UTC, the format of Postgres `date` columns. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "Oct 15, 2026". Dates are calendar days, so they are read and printed in UTC. */
export function formatDate(value: Date | string, locale = "en-US"): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
```

`src/lib/invoices/schedule.ts`:

```ts
import type { RecurringInterval } from "@/lib/db/schema";
import { addDays } from "./dates";

/** Spec §9.1: the next issue time. Monthly invoices return to `anchorDay` whenever the month has it. */
export function nextIssueAt(previous: Date, interval: RecurringInterval, anchorDay: number): Date {
  if (interval === "weekly") return addDays(previous, 7);
  const year = previous.getUTCFullYear();
  const month = previous.getUTCMonth() + 1;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const next = new Date(previous);
  next.setUTCFullYear(year, month, Math.min(anchorDay, daysInMonth));
  return next;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/lib/invoices`
Expected: PASS.

- [ ] **Step 5: Write the failing form tests**

`src/lib/invoices/input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseInvoiceForm } from "./input";

const TODAY = "2026-10-15";
const valid = {
  clientName: "Acme Inc.",
  description: "Logo design",
  amount: "300",
  currency: "USD",
  dueDate: "2026-10-20",
  repeat: "none",
};

describe("parseInvoiceForm", () => {
  it("accepts a one-off invoice", () => {
    expect(parseInvoiceForm(valid, TODAY)).toEqual({
      ok: true,
      data: {
        clientName: "Acme Inc.",
        description: "Logo design",
        amount: "300.00",
        currency: "USD",
        dueDate: "2026-10-20",
        repeat: "none",
      },
    });
  });

  it("allows no due date, and ignores it for recurring invoices", () => {
    expect(parseInvoiceForm({ ...valid, dueDate: "" }, TODAY)).toMatchObject({ ok: true, data: { dueDate: null } });
    expect(parseInvoiceForm({ ...valid, repeat: "weekly" }, TODAY)).toMatchObject({
      ok: true,
      data: { dueDate: null, repeat: "weekly" },
    });
  });

  it("reports every invalid field", () => {
    expect(
      parseInvoiceForm(
        { clientName: "", description: "", amount: "1.500,50", currency: "EUR", dueDate: "2026-10-14", repeat: "daily" },
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: {
        clientName: "invoiceForm.error.client",
        description: "invoiceForm.error.description",
        amount: "money.error.format",
        currency: "invoiceForm.error.currency",
        dueDate: "invoiceForm.error.duePast",
        repeat: "invoiceForm.error.repeat",
      },
    });
  });

  it("rejects over-long text and impossible dates", () => {
    expect(
      parseInvoiceForm({ ...valid, clientName: "x".repeat(81), description: "y".repeat(201), dueDate: "2026-02-30" }, TODAY),
    ).toEqual({
      ok: false,
      errors: {
        clientName: "invoiceForm.error.clientLong",
        description: "invoiceForm.error.descriptionLong",
        dueDate: "invoiceForm.error.dueDate",
      },
    });
  });
});
```

- [ ] **Step 6: Implement `input.ts` and add its strings**

`src/lib/invoices/input.ts`:

```ts
import type { RecurringInterval } from "@/lib/db/schema";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { isFiatCurrency, type FiatCurrency } from "@/lib/money/currencies";
import { parseFiatInput } from "@/lib/money/input";
import { isoDate } from "./dates";

export interface InvoiceInput {
  clientName: string;
  description: string;
  amount: string;
  currency: FiatCurrency;
  dueDate: string | null;
  repeat: "none" | RecurringInterval;
}
export type InvoiceField = keyof InvoiceInput;

const REPEATS = ["none", "weekly", "monthly"] as const;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && isoDate(date) === value;
}

export function parseInvoiceForm(fields: Record<string, string>, today: string): FormResult<InvoiceInput, InvoiceField> {
  const errors: FieldErrors<InvoiceField> = {};
  const clientName = (fields.clientName ?? "").trim();
  if (clientName === "") errors.clientName = "invoiceForm.error.client";
  else if (clientName.length > 80) errors.clientName = "invoiceForm.error.clientLong";

  const description = (fields.description ?? "").trim();
  if (description === "") errors.description = "invoiceForm.error.description";
  else if (description.length > 200) errors.description = "invoiceForm.error.descriptionLong";

  const amount = parseFiatInput(fields.amount ?? "");
  if (!amount.ok) errors.amount = `money.error.${amount.error}`;

  const currency = fields.currency;
  if (!isFiatCurrency(currency)) errors.currency = "invoiceForm.error.currency";

  const repeat = fields.repeat ?? "none";
  const validRepeat = (REPEATS as readonly string[]).includes(repeat);
  if (!validRepeat) errors.repeat = "invoiceForm.error.repeat";

  // Recurring periods are due RECURRING_DUE_DAYS after issue, so their due date field is ignored.
  const rawDue = (fields.dueDate ?? "").trim();
  const recurring = repeat === "weekly" || repeat === "monthly";
  let dueDate: string | null = null;
  if (rawDue !== "" && !recurring) {
    if (!isRealDate(rawDue)) errors.dueDate = "invoiceForm.error.dueDate";
    else if (rawDue < today) errors.dueDate = "invoiceForm.error.duePast";
    else dueDate = rawDue;
  }

  if (Object.keys(errors).length > 0 || !amount.ok || !isFiatCurrency(currency)) return { ok: false, errors };
  return {
    ok: true,
    data: { clientName, description, amount: amount.value, currency, dueDate, repeat: repeat as InvoiceInput["repeat"] },
  };
}
```

Add to `src/i18n/en.ts`:

```ts
  "invoiceForm.error.client": "Enter who you are billing.",
  "invoiceForm.error.clientLong": "Use at most 80 characters.",
  "invoiceForm.error.description": "Say what the invoice is for.",
  "invoiceForm.error.descriptionLong": "Use at most 200 characters.",
  "invoiceForm.error.currency": "Choose US dollars, Argentine pesos or Brazilian reais.",
  "invoiceForm.error.dueDate": "Enter a real date.",
  "invoiceForm.error.duePast": "Pick today or a later date.",
  "invoiceForm.error.repeat": "Choose how often to repeat this invoice.",
```

- [ ] **Step 7: Run the form tests to see them pass**

Run: `npx vitest run src/lib/invoices/input.test.ts`
Expected: PASS.

- [ ] **Step 8: Write the failing repository tests**

`src/lib/invoices/repo.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { invoices, payments, recurringInvoices } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { InvoiceInput } from "./input";
import {
  createInvoice,
  createRecurring,
  findPublicInvoice,
  getOwnedInvoice,
  issueDueRecurring,
  listInvoices,
  resolveRecurringLink,
} from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const input: InvoiceInput = {
  clientName: "Acme",
  description: "Logo",
  amount: "300.00",
  currency: "USD",
  dueDate: "2026-10-20",
  repeat: "none",
};
const NOW = new Date("2026-10-15T12:00:00Z");

describe("one-off invoices", () => {
  it("creates, lists and finds an invoice", async () => {
    const user = await seedFreelancer(db);
    const invoice = await createInvoice(db, user.id, input);
    expect(invoice).toMatchObject({ status: "open", amount: "300.00", dueDate: "2026-10-20", recurringId: null });
    expect(invoice.slug).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
    expect((await listInvoices(db, user.id)).map((i) => i.id)).toEqual([invoice.id]);

    expect(await findPublicInvoice(db, invoice.slug)).toMatchObject({
      id: invoice.id,
      clientName: "Acme",
      currency: "USD",
      freelancerName: "Ana Diseño",
      payTo: TEST_TREASURY,
      recurringSlug: null,
    });
  });

  it("hides the pay-to address until the treasury wallet is ready", async () => {
    const user = await seedFreelancer(db, { treasuryAddress: null });
    const invoice = await createInvoice(db, user.id, input);
    expect((await findPublicInvoice(db, invoice.slug))?.payTo).toBeNull();
  });

  it("shows an invoice only to its owner", async () => {
    const owner = await seedFreelancer(db);
    const stranger = await seedFreelancer(db);
    const invoice = await createInvoice(db, owner.id, input);
    await db.insert(payments).values({ invoiceId: invoice.id, payer: "0xpayer", asset: "USDT", amountAtomic: "300000000", txHash: "0xaa" });
    expect(await getOwnedInvoice(db, owner.id, invoice.id)).toMatchObject({
      invoice: { id: invoice.id },
      recurring: null,
      payments: [{ txHash: "0xaa" }],
    });
    expect(await getOwnedInvoice(db, stranger.id, invoice.id)).toBeNull();
    expect(await getOwnedInvoice(db, owner.id, "not-a-uuid")).toBeNull();
    expect(await findPublicInvoice(db, "nope")).toBeNull();
  });
});

describe("recurring invoices", () => {
  it("issues the first instance now and schedules the next", async () => {
    const user = await seedFreelancer(db);
    const { recurring, first } = await createRecurring(db, user.id, { ...input, repeat: "weekly", dueDate: null }, NOW);
    expect(recurring).toMatchObject({ interval: "weekly", anchorDay: 15, nextIssueAt: new Date("2026-10-22T12:00:00Z") });
    expect(first).toMatchObject({ recurringId: recurring.id, periodStart: NOW, dueDate: "2026-10-22" });
    expect((await findPublicInvoice(db, first.slug))?.recurringSlug).toBe(recurring.slug);
    expect(await getOwnedInvoice(db, user.id, first.id)).toMatchObject({
      recurring: { slug: recurring.slug, interval: "weekly" },
    });
  });

  it("issues a due period exactly once, even when runs overlap", async () => {
    const user = await seedFreelancer(db);
    const { recurring } = await createRecurring(db, user.id, { ...input, repeat: "weekly", dueDate: null }, NOW);
    expect(await issueDueRecurring(db, new Date("2026-10-22T11:59:59Z"))).toBe(0);

    const due = new Date("2026-10-22T12:05:00Z");
    const counts = await Promise.all([issueDueRecurring(db, due), issueDueRecurring(db, due)]);
    expect(counts[0] + counts[1]).toBe(1);
    expect(await issueDueRecurring(db, due)).toBe(0);

    const instances = await db.select().from(invoices).where(eq(invoices.recurringId, recurring.id));
    expect(instances.map((i) => i.periodStart?.toISOString()).sort()).toEqual([
      "2026-10-15T12:00:00.000Z",
      "2026-10-22T12:00:00.000Z",
    ]);
    const [template] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, recurring.id));
    expect(template.nextIssueAt).toEqual(new Date("2026-10-29T12:00:00Z"));
  });

  it("skips paused templates", async () => {
    const user = await seedFreelancer(db);
    const { recurring } = await createRecurring(db, user.id, { ...input, repeat: "monthly", dueDate: null }, NOW);
    await db.update(recurringInvoices).set({ active: false }).where(eq(recurringInvoices.id, recurring.id));
    expect(await issueDueRecurring(db, new Date("2026-12-01T00:00:00Z"))).toBe(0);
  });

  it("sends the stable link to the oldest open period, or lists paid periods", async () => {
    const user = await seedFreelancer(db);
    const { recurring, first } = await createRecurring(db, user.id, { ...input, repeat: "weekly", dueDate: null }, NOW);
    await issueDueRecurring(db, new Date("2026-10-22T12:00:00Z"));
    expect(await resolveRecurringLink(db, recurring.slug)).toEqual({ kind: "open", invoiceSlug: first.slug });

    const paidAt = new Date("2026-10-23T10:00:00Z");
    await db.update(invoices).set({ status: "paid", paidAt }).where(eq(invoices.recurringId, recurring.id));
    const link = await resolveRecurringLink(db, recurring.slug);
    expect(link).toMatchObject({ kind: "all-paid", clientName: "Acme", freelancerName: "Ana Diseño" });
    expect(link?.kind === "all-paid" && link.paid.map((p) => p.periodStart?.toISOString())).toEqual([
      "2026-10-22T12:00:00.000Z",
      "2026-10-15T12:00:00.000Z",
    ]);
    expect(await resolveRecurringLink(db, "unknown")).toBeNull();
  });
});
```

- [ ] **Step 9: Run them to see them fail**

Run: `npx vitest run src/lib/invoices/repo.test.ts`
Expected: FAIL, `Failed to resolve import "./repo"`.

- [ ] **Step 10: Implement `repo.ts`**

`src/lib/invoices/repo.ts`:

```ts
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import {
  invoices,
  payments,
  recurringInvoices,
  treasuryWallets,
  users,
  type InvoiceRow,
  type InvoiceStatus,
  type PaymentRow,
  type RecurringInterval,
  type RecurringInvoiceRow,
} from "@/lib/db/schema";
import type { FiatCurrency } from "@/lib/money/currencies";
import { addDays, isoDate } from "./dates";
import type { InvoiceInput } from "./input";
import { nextIssueAt } from "./schedule";
import { newSlug } from "./slug";

export const RECURRING_DUE_DAYS = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OwnedInvoice {
  invoice: InvoiceRow;
  recurring: { slug: string; interval: RecurringInterval } | null;
  payments: PaymentRow[];
}

/** What the public payment page and the x402 route may know about an invoice. */
export interface PublicInvoice {
  id: string;
  slug: string;
  clientName: string;
  description: string;
  amount: string;
  currency: FiatCurrency;
  dueDate: string | null;
  status: InvoiceStatus;
  settlingUntil: Date | null;
  freelancerName: string | null;
  /** The owner's treasury wallet, or null while it is still being created. */
  payTo: Address | null;
  recurringSlug: string | null;
}

export type RecurringLink =
  | { kind: "open"; invoiceSlug: string }
  | {
      kind: "all-paid";
      clientName: string;
      description: string;
      freelancerName: string | null;
      paid: { slug: string; periodStart: Date | null; paidAt: Date | null; amount: string; currency: FiatCurrency }[];
    };

export async function createInvoice(db: Db, userId: string, input: InvoiceInput): Promise<InvoiceRow> {
  const [row] = await db
    .insert(invoices)
    .values({
      slug: newSlug(),
      userId,
      clientName: input.clientName,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate,
    })
    .returning();
  return row;
}

/** Inserts one period of a template; undefined when that period already exists. */
async function insertInstance(db: Db, recurring: RecurringInvoiceRow, periodStart: Date) {
  const [row] = await db
    .insert(invoices)
    .values({
      slug: newSlug(),
      userId: recurring.userId,
      recurringId: recurring.id,
      periodStart,
      clientName: recurring.clientName,
      description: recurring.description,
      amount: recurring.amount,
      currency: recurring.currency,
      dueDate: isoDate(addDays(periodStart, RECURRING_DUE_DAYS)),
    })
    .onConflictDoNothing({ target: [invoices.recurringId, invoices.periodStart] })
    .returning();
  return row as InvoiceRow | undefined;
}

export async function createRecurring(
  db: Db,
  userId: string,
  input: InvoiceInput,
  now: Date,
): Promise<{ recurring: RecurringInvoiceRow; first: InvoiceRow }> {
  if (input.repeat === "none") throw new Error("createRecurring needs a weekly or monthly invoice");
  const interval = input.repeat;
  return db.transaction(async (tx) => {
    const anchorDay = now.getUTCDate();
    const [recurring] = await tx
      .insert(recurringInvoices)
      .values({
        slug: newSlug(),
        userId,
        clientName: input.clientName,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        interval,
        anchorDay,
        nextIssueAt: nextIssueAt(now, interval, anchorDay),
      })
      .returning();
    const first = await insertInstance(tx, recurring, now);
    if (!first) throw new Error("First period of a new recurring invoice already exists");
    return { recurring, first };
  });
}

/**
 * Spec §9.1: for each active template whose next issue time has passed, insert that period and
 * advance the schedule by one interval. Advancing is conditional on the old value and the unique
 * (recurring_id, period_start) index backs it up, so overlapping runs issue each period once.
 */
export async function issueDueRecurring(db: Db, now: Date, limit = 100): Promise<number> {
  const due = await db
    .select()
    .from(recurringInvoices)
    .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.nextIssueAt, now)))
    .orderBy(asc(recurringInvoices.nextIssueAt))
    .limit(limit);
  let issued = 0;
  for (const recurring of due) {
    await db.transaction(async (tx) => {
      const advanced = await tx
        .update(recurringInvoices)
        .set({ nextIssueAt: nextIssueAt(recurring.nextIssueAt, recurring.interval, recurring.anchorDay) })
        .where(and(eq(recurringInvoices.id, recurring.id), eq(recurringInvoices.nextIssueAt, recurring.nextIssueAt)))
        .returning({ id: recurringInvoices.id });
      if (advanced.length === 0) return;
      if (await insertInstance(tx, recurring, recurring.nextIssueAt)) issued += 1;
    });
  }
  return issued;
}

export async function listInvoices(db: Db, userId: string, limit = 50): Promise<InvoiceRow[]> {
  return db.select().from(invoices).where(eq(invoices.userId, userId)).orderBy(desc(invoices.createdAt)).limit(limit);
}

export async function getOwnedInvoice(db: Db, userId: string, invoiceId: string): Promise<OwnedInvoice | null> {
  if (!UUID.test(invoiceId)) return null;
  const [row] = await db
    .select({ invoice: invoices, recurringSlug: recurringInvoices.slug, interval: recurringInvoices.interval })
    .from(invoices)
    .leftJoin(recurringInvoices, eq(recurringInvoices.id, invoices.recurringId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)));
  if (!row) return null;
  const paid = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(asc(payments.settledAt));
  return {
    invoice: row.invoice,
    recurring: row.recurringSlug && row.interval ? { slug: row.recurringSlug, interval: row.interval } : null,
    payments: paid,
  };
}

export async function findPublicInvoice(db: Db, slug: string): Promise<PublicInvoice | null> {
  const [row] = await db
    .select({
      invoice: invoices,
      freelancerName: users.displayName,
      walletStatus: treasuryWallets.status,
      walletAddress: treasuryWallets.address,
      recurringSlug: recurringInvoices.slug,
    })
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.userId))
    .leftJoin(treasuryWallets, eq(treasuryWallets.userId, invoices.userId))
    .leftJoin(recurringInvoices, eq(recurringInvoices.id, invoices.recurringId))
    .where(eq(invoices.slug, slug));
  if (!row) return null;
  const { invoice } = row;
  return {
    id: invoice.id,
    slug: invoice.slug,
    clientName: invoice.clientName,
    description: invoice.description,
    amount: invoice.amount,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    status: invoice.status,
    settlingUntil: invoice.settlingUntil,
    freelancerName: row.freelancerName,
    payTo: row.walletStatus === "ready" && row.walletAddress ? getAddress(row.walletAddress) : null,
    recurringSlug: row.recurringSlug,
  };
}

export async function resolveRecurringLink(db: Db, slug: string): Promise<RecurringLink | null> {
  const [template] = await db
    .select({ recurring: recurringInvoices, freelancerName: users.displayName })
    .from(recurringInvoices)
    .innerJoin(users, eq(users.id, recurringInvoices.userId))
    .where(eq(recurringInvoices.slug, slug));
  if (!template) return null;
  const instances = await db
    .select()
    .from(invoices)
    .where(eq(invoices.recurringId, template.recurring.id))
    .orderBy(asc(invoices.periodStart));
  const open = instances.find((i) => i.status === "open" || i.status === "settling");
  if (open) return { kind: "open", invoiceSlug: open.slug };
  return {
    kind: "all-paid",
    clientName: template.recurring.clientName,
    description: template.recurring.description,
    freelancerName: template.freelancerName,
    paid: instances
      .filter((i) => i.status === "paid")
      .reverse()
      .map((i) => ({ slug: i.slug, periodStart: i.periodStart, paidAt: i.paidAt, amount: i.amount, currency: i.currency })),
  };
}
```

- [ ] **Step 11: Run all invoice tests to see them pass**

Run: `npx vitest run src/lib/invoices`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/lib/invoices src/i18n/en.ts
git commit -m "feat(invoices): one-off and recurring invoices with idempotent period issuance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Invoice screens: home list, new invoice, invoice detail

**Files:**
- Create: `src/components/money.tsx`, `src/components/status-chip.tsx`, `src/components/copy-link.tsx`, `src/app/app/invoices/new/page.tsx`, `src/app/app/invoices/new/invoice-form.tsx`, `src/app/app/invoices/new/actions.ts`, `src/app/app/invoices/[id]/page.tsx`
- Modify: `src/app/app/page.tsx`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `requireUser`, `AppUser` (Task 5); `finishSetup`, `SubmitButton` (Task 6); `FormField`, `fieldA11y`, `formFields`, `FieldErrors` (Task 7); `parseInvoiceForm`, `InvoiceField`, `createInvoice`, `createRecurring`, `listInvoices`, `getOwnedInvoice`, `formatDate` (Task 8); `displayAmount`, `DisplayAmount` (Task 3); `getReferenceRatesOrNull` (Task 3); `formatTokenAmount` (Task 2); `readPublicEnv` (Plan 1); `getDb` (Task 1).
- Produces:
  - `<Money amount={DisplayAmount} size?: "md" | "lg">`, `<InvoiceStatusChip status>`, `<CopyLink url label>`.
  - `createInvoiceAction(prev: InvoiceFormState, formData): Promise<InvoiceFormState>` with `interface InvoiceFormState { errors: FieldErrors<InvoiceField>; values: Record<string, string>; notReady?: boolean }`; redirects to `/app/invoices/<id>?created=1`.
  - Pages `/app` (invoice list), `/app/invoices/new` (step 3 of 3 when `?first=1`), `/app/invoices/[id]`.

- [ ] **Step 1: Add the strings**

Add to `src/i18n/en.ts`:

```ts
  "status.open": "Open",
  "status.settling": "Confirming payment",
  "status.paid": "Paid",
  "status.cancelled": "Cancelled",
  "invoices.title": "Invoices",
  "invoices.new": "New invoice",
  "invoices.emptyTitle": "No invoices yet",
  "invoices.emptyBody": "Create your first invoice and send the link to your client. They can pay in dollars or pesos from their own wallet.",
  "invoices.emptyAction": "Create your first invoice",
  "invoices.repeats": "Repeats",
  "invoices.due": "Due {date}",
  "invoices.loadError": "We couldn't load your invoices.",
  "invoiceForm.title": "New invoice",
  "invoiceForm.firstStep": "Create your first invoice, or skip this for now.",
  "invoiceForm.skip": "Skip for now",
  "invoiceForm.client": "Who are you billing?",
  "invoiceForm.description": "What is it for?",
  "invoiceForm.amount": "Amount",
  "invoiceForm.amountHelp": "Digits and a dot for cents, for example 1500.50.",
  "invoiceForm.currency": "Currency",
  "invoiceForm.dueDate": "Due date (optional)",
  "invoiceForm.repeat": "Repeat",
  "invoiceForm.repeat.none": "Just once",
  "invoiceForm.repeat.weekly": "Every week",
  "invoiceForm.repeat.monthly": "Every month",
  "invoiceForm.repeatHelp": "Repeating invoices get one link your client can bookmark. Each new invoice is due 7 days after it is issued.",
  "invoiceForm.submit": "Create invoice",
  "invoiceForm.saving": "Creating…",
  "invoiceForm.notReady": "Your wallet is still being set up, so this invoice could not be paid yet. Finish setup on the home page, then try again.",
  "invoice.created": "Invoice created. Send this link to your client.",
  "invoice.shareLabel": "Payment link",
  "invoice.recurringShareLabel": "Payment link (always shows the current invoice)",
  "invoice.copy": "Copy link",
  "invoice.copied": "Link copied",
  "invoice.open": "Open payment page",
  "invoice.for": "For",
  "invoice.client": "Client",
  "invoice.repeatsWeekly": "Repeats every week",
  "invoice.repeatsMonthly": "Repeats every month",
  "invoice.payments": "Payments",
  "invoice.noPayments": "No payments yet.",
  "invoice.paidWith": "Paid {amount} on {date}",
  "invoice.payer": "Payer wallet",
  "invoice.tx": "Transaction",
  "invoice.viewTx": "View on Celoscan",
  "invoice.back": "Back to invoices",
```

- [ ] **Step 2: Add the shared display components**

`src/components/money.tsx`:

```tsx
import type { DisplayAmount } from "@/lib/money/display";

/** Local currency large, the second currency small and muted (MASTER.md "Money formatting"). */
export function Money({ amount, size = "md" }: { amount: DisplayAmount; size?: "md" | "lg" }) {
  return (
    <span className="flex flex-col tabular-nums">
      <span className={size === "lg" ? "text-3xl font-semibold tracking-tight" : "text-base font-semibold"}>
        {amount.primary}
      </span>
      {amount.secondary && <span className="text-sm text-muted-foreground">{amount.secondary}</span>}
    </span>
  );
}
```

`src/components/status-chip.tsx`:

```tsx
import { CircleAlert, CircleCheck, Clock, LoaderCircle } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import type { InvoiceStatus } from "@/lib/db/schema";

const CHIPS: Record<InvoiceStatus, { icon: typeof Clock; className: string; label: MessageKey }> = {
  open: { icon: Clock, className: "text-warning", label: "status.open" },
  settling: { icon: LoaderCircle, className: "text-warning", label: "status.settling" },
  paid: { icon: CircleCheck, className: "text-success", label: "status.paid" },
  cancelled: { icon: CircleAlert, className: "text-muted-foreground", label: "status.cancelled" },
};

/** Icon and text, never color alone (MASTER.md "Status chips"). */
export function InvoiceStatusChip({ status }: { status: InvoiceStatus }) {
  const chip = CHIPS[status];
  const Icon = chip.icon;
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium ${chip.className}`}>
      <Icon aria-hidden="true" className="size-4" />
      {t(chip.label)}
    </span>
  );
}
```

`src/components/copy-link.tsx`:

```tsx
"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

export function CopyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="share-link" className="text-sm font-medium">
        {label}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="share-link" readOnly value={url} className="h-11 text-base" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" size="lg" className="min-h-11 shrink-0" onClick={copy}>
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {copied ? t("invoice.copied") : t("invoice.copy")}
        </Button>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? t("invoice.copied") : ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Replace the home page with the invoice list**

`src/app/app/page.tsx` (whole file):

```tsx
import { CircleAlert, Clock, FileText, Plus, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Money } from "@/components/money";
import { InvoiceStatusChip } from "@/components/status-chip";
import { SubmitButton } from "@/components/submit-button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDate } from "@/lib/invoices/dates";
import { listInvoices } from "@/lib/invoices/repo";
import { displayAmount } from "@/lib/money/display";
import type { AppUser } from "@/lib/users/queries";
import { finishSetup } from "./actions";

export const metadata: Metadata = { title: `${t("nav.home")} · ${t("app.name")}` };

const primaryLink =
  "inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function AppHomePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Suspense fallback={<HomeSkeleton />}>
        <Home />
      </Suspense>
    </main>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("common.loading")}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

async function Home() {
  const user = await requireUser();
  const [invoices, rates] = await Promise.all([listInvoices(getDb(), user.id), getReferenceRatesOrNull()]);
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("app.greeting", { name: user.displayName ?? user.email ?? "" })}</h1>
      <SetupBanner status={user.treasuryStatus} />
      <section aria-labelledby="invoices-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="invoices-heading" className="text-lg font-semibold">
            {t("invoices.title")}
          </h2>
          {invoices.length > 0 && (
            <Link href="/app/invoices/new" className={primaryLink}>
              <Plus aria-hidden="true" className="size-4" />
              {t("invoices.new")}
            </Link>
          )}
        </div>
        {invoices.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-card p-6 shadow-sm ring-1 ring-foreground/10">
            <FileText aria-hidden="true" className="size-6 text-muted-foreground" />
            <p className="font-semibold">{t("invoices.emptyTitle")}</p>
            <p className="max-w-prose text-muted-foreground">{t("invoices.emptyBody")}</p>
            <Link href="/app/invoices/new" className={primaryLink}>
              <Plus aria-hidden="true" className="size-4" />
              {t("invoices.emptyAction")}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/app/invoices/${invoice.id}`}
                  className="flex cursor-pointer items-start justify-between gap-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 font-medium">
                      {invoice.clientName}
                      {invoice.recurringId && (
                        <>
                          <Repeat aria-hidden="true" className="size-4 text-muted-foreground" />
                          <span className="sr-only">{t("invoices.repeats")}</span>
                        </>
                      )}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{invoice.description}</span>
                    <InvoiceStatusChip status={invoice.status} />
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <Money amount={displayAmount(invoice.amount, invoice.currency, user.localCurrency, rates)} />
                    {invoice.dueDate && invoice.status === "open" && (
                      <span className="text-sm text-muted-foreground">{t("invoices.due", { date: formatDate(invoice.dueDate) })}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// Not exported: a page module may only export Next.js page fields.
function SetupBanner({ status }: { status: AppUser["treasuryStatus"] }) {
  if (status === "ready") return null;
  const failed = status === "failed" || status === "missing";
  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className={`flex items-start gap-2 ${failed ? "text-destructive" : "text-warning"}`}>
        {failed ? (
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        ) : (
          <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        )}
        {failed ? t("setup.failed") : t("setup.creating")}
      </p>
      <form action={finishSetup}>
        <SubmitButton pendingLabel={t("setup.working")}>{t("setup.retry")}</SubmitButton>
      </form>
    </section>
  );
}
```

On the home screen the primary action is "New invoice" once invoices exist; before that, the empty state's "Create your first invoice" is the only primary button.

- [ ] **Step 4: Build the new-invoice page**

`src/app/app/invoices/new/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { formFields, type FieldErrors } from "@/lib/forms";
import { isoDate } from "@/lib/invoices/dates";
import { parseInvoiceForm, type InvoiceField } from "@/lib/invoices/input";
import { createInvoice, createRecurring } from "@/lib/invoices/repo";

export interface InvoiceFormState {
  errors: FieldErrors<InvoiceField>;
  values: Record<string, string>;
  /** The treasury wallet is not ready, so no payment address exists yet. */
  notReady?: boolean;
}

export async function createInvoiceAction(_previous: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  const fields = formFields(formData);
  const parsed = parseInvoiceForm(fields, isoDate(new Date()));
  if (!parsed.ok) return { errors: parsed.errors, values: fields };
  if (user.treasuryStatus !== "ready") return { errors: {}, values: fields, notReady: true };

  const db = getDb();
  const invoice =
    parsed.data.repeat === "none"
      ? await createInvoice(db, user.id, parsed.data)
      : (await createRecurring(db, user.id, parsed.data, new Date())).first;
  redirect(`/app/invoices/${invoice.id}?created=1`);
}
```

`src/app/app/invoices/new/invoice-form.tsx`:

```tsx
"use client";

import { CircleAlert } from "lucide-react";
import { useActionState } from "react";
import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { FIAT_CURRENCIES, type FiatCurrency } from "@/lib/money/currencies";
import { createInvoiceAction, type InvoiceFormState } from "./actions";

const REPEATS = ["none", "weekly", "monthly"] as const;
const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive";

export function InvoiceForm({ defaultCurrency }: { defaultCurrency: FiatCurrency }) {
  const [state, action] = useActionState(createInvoiceAction, {
    errors: {},
    values: { currency: defaultCurrency, repeat: "none" },
  } satisfies InvoiceFormState);
  const { errors, values } = state;
  const amountHelp = t("invoiceForm.amountHelp");
  const repeatHelp = t("invoiceForm.repeatHelp");

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <div aria-live="polite">
        {state.notReady && (
          <p className="flex items-start gap-2 text-destructive" role="alert">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t("invoiceForm.notReady")}
          </p>
        )}
      </div>

      <FormField id="clientName" label={t("invoiceForm.client")} error={errors.clientName}>
        <Input {...fieldA11y("clientName", { error: errors.clientName })} autoComplete="organization" defaultValue={values.clientName} className="h-11 text-base" />
      </FormField>

      <FormField id="description" label={t("invoiceForm.description")} error={errors.description}>
        <Input {...fieldA11y("description", { error: errors.description })} autoComplete="off" defaultValue={values.description} className="h-11 text-base" />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <FormField id="amount" label={t("invoiceForm.amount")} help={amountHelp} error={errors.amount}>
          <Input
            {...fieldA11y("amount", { help: amountHelp, error: errors.amount })}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={values.amount}
            className="h-11 text-base tabular-nums"
          />
        </FormField>
        <FormField id="currency" label={t("invoiceForm.currency")} error={errors.currency}>
          <select {...fieldA11y("currency", { error: errors.currency })} defaultValue={values.currency} className={selectClass}>
            {FIAT_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {t(`currency.${code}` as const)}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="repeat" label={t("invoiceForm.repeat")} help={repeatHelp} error={errors.repeat}>
          <select {...fieldA11y("repeat", { help: repeatHelp, error: errors.repeat })} defaultValue={values.repeat} className={selectClass}>
            {REPEATS.map((repeat) => (
              <option key={repeat} value={repeat}>
                {t(`invoiceForm.repeat.${repeat}` as const)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="dueDate" label={t("invoiceForm.dueDate")} error={errors.dueDate}>
          <Input {...fieldA11y("dueDate", { error: errors.dueDate })} type="date" defaultValue={values.dueDate} className="h-11 text-base" />
        </FormField>
      </div>

      <SubmitButton pendingLabel={t("invoiceForm.saving")}>{t("invoiceForm.submit")}</SubmitButton>
    </form>
  );
}
```

`src/app/app/invoices/new/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { InvoiceForm } from "./invoice-form";

export const metadata: Metadata = { title: `${t("invoiceForm.title")} · ${t("app.name")}` };

export default function NewInvoicePage(props: PageProps<"/app/invoices/new">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
        <NewInvoice searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function NewInvoice({ searchParams }: { searchParams: PageProps<"/app/invoices/new">["searchParams"] }) {
  const [{ first }, user] = await Promise.all([searchParams, requireUser()]);
  const onboarding = first === "1";
  return (
    <>
      {onboarding && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">{t("onboarding.step", { step: 3, total: 3 })}</p>
          <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden="true">
            <div className="h-full w-full rounded-full bg-primary" />
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("invoiceForm.title")}</h1>
        {onboarding && (
          <Link href="/app" className="min-h-11 rounded-sm py-2 text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            {t("invoiceForm.skip")}
          </Link>
        )}
      </div>
      {onboarding && <p className="text-muted-foreground">{t("invoiceForm.firstStep")}</p>}
      <InvoiceForm defaultCurrency={user.localCurrency ?? "USD"} />
    </>
  );
}
```

- [ ] **Step 5: Build the invoice detail page**

`src/app/app/invoices/[id]/page.tsx`:

```tsx
import { ArrowLeft, CircleCheck, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CopyLink } from "@/components/copy-link";
import { Money } from "@/components/money";
import { InvoiceStatusChip } from "@/components/status-chip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { readPublicEnv } from "@/lib/config/public";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDate } from "@/lib/invoices/dates";
import { getOwnedInvoice } from "@/lib/invoices/repo";
import { isPayAsset } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import { formatTokenAmount } from "@/lib/money/format";

export const metadata: Metadata = { title: `${t("invoices.title")} · ${t("app.name")}` };

export default function InvoicePage(props: PageProps<"/app/invoices/[id]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Link href="/app" className="flex min-h-11 w-fit items-center gap-2 rounded-sm text-primary focus-visible:outline-2 focus-visible:outline-ring">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("invoice.back")}
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Invoice params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Invoice({
  params,
  searchParams,
}: {
  params: PageProps<"/app/invoices/[id]">["params"];
  searchParams: PageProps<"/app/invoices/[id]">["searchParams"];
}) {
  const [{ id }, { created }, user] = await Promise.all([params, searchParams, requireUser()]);
  const owned = await getOwnedInvoice(getDb(), user.id, id);
  if (!owned) notFound();
  const { invoice, recurring, payments } = owned;
  const rates = await getReferenceRatesOrNull();
  const appUrl = readPublicEnv().NEXT_PUBLIC_APP_URL;
  const shareUrl = recurring ? `${appUrl}/r/${recurring.slug}` : `${appUrl}/pay/${invoice.slug}`;

  return (
    <>
      {created === "1" && (
        <p role="status" className="flex items-start gap-2 font-medium text-success">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {t("invoice.created")}
        </p>
      )}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-xl font-semibold">{invoice.clientName}</h1>
            <InvoiceStatusChip status={invoice.status} />
          </div>
          <Money size="lg" amount={displayAmount(invoice.amount, invoice.currency, user.localCurrency, rates)} />
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("invoice.for")}</dt>
              <dd className="text-base">{invoice.description}</dd>
            </div>
            {invoice.dueDate && (
              <div>
                <dt className="sr-only">{t("invoiceForm.dueDate")}</dt>
                <dd>{t("invoices.due", { date: formatDate(invoice.dueDate) })}</dd>
              </div>
            )}
            {recurring && (
              <div>
                <dt className="sr-only">{t("invoiceForm.repeat")}</dt>
                <dd>{t(recurring.interval === "weekly" ? "invoice.repeatsWeekly" : "invoice.repeatsMonthly")}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {invoice.status !== "paid" && invoice.status !== "cancelled" && (
        <section className="flex flex-col gap-3">
          <CopyLink url={shareUrl} label={recurring ? t("invoice.recurringShareLabel") : t("invoice.shareLabel")} />
          <Link
            href={`/pay/${invoice.slug}`}
            target="_blank"
            className="flex min-h-11 w-fit items-center gap-2 rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t("invoice.open")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </Link>
        </section>
      )}

      <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
        <h2 id="payments-heading" className="text-lg font-semibold">
          {t("invoice.payments")}
        </h2>
        {payments.length === 0 ? (
          <p className="text-muted-foreground">{t("invoice.noPayments")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payments.map((payment) => (
              <li key={payment.id} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
                <p className="font-medium">
                  {t("invoice.paidWith", {
                    amount: isPayAsset(payment.asset) ? formatTokenAmount(BigInt(payment.amountAtomic), payment.asset) : payment.amountAtomic,
                    date: formatDate(payment.settledAt),
                  })}
                </p>
                <details className="mt-2 text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
                  <dl className="grid gap-2">
                    <div>
                      <dt className="text-muted-foreground">{t("invoice.payer")}</dt>
                      <dd className="break-all font-mono">{payment.payer}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("invoice.tx")}</dt>
                      <dd>
                        <a
                          href={`https://celoscan.io/tx/${payment.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 break-all font-mono text-primary underline underline-offset-4"
                        >
                          {payment.txHash}
                          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                          <span className="sr-only">{t("invoice.viewTx")}</span>
                        </a>
                      </dd>
                    </div>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass, no "outside of <Suspense>" errors.

By hand (`npm run dev`, 375px and 1440px):
1. New user: onboarding → step 3 "New invoice" with "Skip for now". Submit empty → errors under client, description and amount. Enter `Acme`, `Logo`, `300`, USD, Just once → detail page with "Invoice created", the `/pay/<slug>` link, Copy works and announces "Link copied".
2. Home lists the invoice with "Open" (clock icon + text) and `≈ ARS …` above `US$300.00`.
3. Create "Every week" → the link is `/r/<slug>`; the home row shows the repeat icon.
4. Open `/app/invoices/00000000-0000-4000-8000-000000000000` → 404 page.

- [ ] **Step 7: Commit**

```bash
git add src/components src/app/app src/i18n/en.ts
git commit -m "feat(invoices): invoice list, creation form and shareable detail page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: x402 payment endpoint with claim-before-settle

**Files:**
- Create: `src/lib/payments/network.ts`, `src/lib/payments/x402-server.ts`, `src/lib/payments/x402-server.test.ts`, `src/lib/payments/invoice-claim.ts`, `src/lib/payments/invoice-claim.test.ts`, `src/lib/payments/pay-flow.ts`, `src/lib/payments/pay-flow.test.ts`, `src/lib/payments/deps.ts`, `src/app/api/pay/[slug]/route.ts`, `src/app/api/pay/[slug]/quote/route.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TOKENS` (Plan 1); `parseServerEnv`, `requireValue`, `Db`, `getDb`, `invoices`, `payments`, test helpers (Task 1); `PayAsset`, `isPayAsset` (Task 2); `getReferenceRates`, `RatesUnavailableError` (Task 3); `quoteInvoice`, `needsRates`, `lockQuote`, `LockedQuote` (Task 4); `findPublicInvoice`, `PublicInvoice` (Task 8).
- Produces:
  - `CELO_NETWORK = "eip155:42220"` (in `network.ts`, safe to import from the browser).
  - `PAYMENT_TIMEOUT_SECONDS = 300`, `buildInvoiceRoute(input: { asset: PayAsset; amountAtomic: bigint; payTo: Address; description: string }): RouteConfig`, `celoFacilitator(opts: { url: string; apiKey: string }): FacilitatorClient`, `createResourceServer(facilitator: FacilitatorClient): x402ResourceServer`, `getResourceServer(): Promise<x402ResourceServer>`, `requestContext(request: Request): HTTPRequestContext`, `interface X402Exchange { result: HTTPProcessResult; settle(): Promise<ProcessSettleResultResponse> }`, `processX402(server, route, request): Promise<X402Exchange>`.
  - `SETTLING_HOLD_MS = 180_000`, `claimInvoice(db, invoiceId, now): Promise<boolean>`, `releaseInvoice(db, invoiceId): Promise<void>`, `recordPayment(db, p: { invoiceId: string; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string; now: Date }): Promise<void>`.
  - `interface PayResponse { status: number; headers: Record<string, string>; body: unknown }`, `interface PayFlowDeps`, `interface QuoteResponse { asset: PayAsset; amountAtomic: string; expiresAt: string; payTo: Address; tokenAddress: Address; decimals: number }`, `preparePayment(deps, input)`, `runPayFlow(deps, input): Promise<PayResponse>`, `invoicePaymentDeps(db): Omit<PayFlowDeps, "process">`.
  - `GET /api/pay/[slug]?asset=USAT|USDT|WARS|WBRL`: 402 with `PAYMENT-REQUIRED`; with a valid `PAYMENT-SIGNATURE`: 200 `{ status: "paid", txHash }` and `PAYMENT-RESPONSE`. Errors: 400 `bad_asset`, 404 `not_found`, 409 `closed` / `busy`, 503 `not_ready` / `rates_unavailable` / `facilitator_unavailable`, 502 `settlement_unknown`.
  - `GET /api/pay/[slug]/quote?asset=…`: 200 `QuoteResponse` (no-store), same error codes.

- [ ] **Step 1: Install the x402 server libraries**

```bash
npm install @x402/core@2.28.0 @x402/evm@2.28.0 @x402/extensions@2.28.0
```

- [ ] **Step 2: Write the failing x402 wiring tests**

`src/lib/payments/x402-server.test.ts`:

```ts
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { buildInvoiceRoute, createResourceServer, processX402, requestContext } from "./x402-server";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const payerOf = (payload: PaymentPayload) => (payload.payload.authorization as { from: string }).from;

function fakeFacilitator() {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" as const }],
      extensions: ["eip2612GasSponsoring"],
      signers: {},
    }),
    verify: vi.fn(async (payload: PaymentPayload) => ({ isValid: true, payer: payerOf(payload) })),
    settle: vi.fn(async (payload: PaymentPayload) => ({
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:42220" as const,
      payer: payerOf(payload),
    })),
  } satisfies FacilitatorClient;
}

async function signedHeader(required: PaymentRequired) {
  const account = privateKeyToAccount(generatePrivateKey());
  const signer = toClientEvmSigner({
    address: account.address,
    signTypedData: (message) => account.signTypedData(message as Parameters<typeof account.signTypedData>[0]),
  });
  const client = new x402Client().register("eip155:42220", new ExactEvmScheme(signer)).setSpendControls(false);
  return { payer: account.address, header: encodePaymentSignatureHeader(await client.createPaymentPayload(required)) };
}

const usdtRoute = () => buildInvoiceRoute({ asset: "USDT", amountAtomic: 300_000000n, payTo: PAY_TO, description: "Cobro invoice abc" });
const request = (headers: Record<string, string> = {}) =>
  new Request("https://cobro.test/api/pay/abc?asset=USDT", { headers });

describe("buildInvoiceRoute", () => {
  it("prices EIP-3009 dollars with the token's EIP-712 domain", () => {
    expect(usdtRoute()).toEqual({
      accepts: {
        scheme: "exact",
        network: "eip155:42220",
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        price: { asset: TOKENS.USDT.address, amount: "300000000", extra: { name: "Tether USD", version: "1" } },
      },
      description: "Cobro invoice abc",
      mimeType: "application/json",
    });
  });

  it("routes pesos through Permit2 with gas-sponsored approval", () => {
    const route = buildInvoiceRoute({ asset: "WARS", amountAtomic: 5n, payTo: PAY_TO, description: "x" });
    expect(route.accepts).toMatchObject({
      price: { asset: TOKENS.WARS.address, amount: "5", extra: { name: "Peso Argentino", version: "1", assetTransferMethod: "permit2" } },
    });
    expect(Object.keys(route.extensions ?? {})).toEqual(["eip2612GasSponsoring"]);
  });
});

describe("requestContext", () => {
  it("reads the payment header and always asks for JSON (no HTML paywall)", () => {
    const context = requestContext(request({ "payment-signature": "abc", accept: "text/html" }));
    expect(context).toMatchObject({ path: "/api/pay/abc", method: "GET", paymentHeader: "abc" });
    expect(context.adapter.getAcceptHeader()).toBe("application/json");
    expect(requestContext(request({ "x-payment": "v1" })).paymentHeader).toBe("v1");
  });
});

describe("processX402", () => {
  it("answers an unpaid request with 402 and the exact invoice price", async () => {
    const server = createResourceServer(fakeFacilitator());
    await server.initialize();
    const { result, settle } = await processX402(server, usdtRoute(), request());
    expect(result.type).toBe("payment-error");
    if (result.type !== "payment-error") return;
    expect(result.response.status).toBe(402);
    const required = decodePaymentRequiredHeader(result.response.headers["PAYMENT-REQUIRED"]);
    expect(required.accepts[0]).toMatchObject({ amount: "300000000", payTo: PAY_TO, asset: TOKENS.USDT.address });
    await expect(settle()).rejects.toThrow(/verified/);
  });

  it("verifies a signed payment and settles it through the facilitator", async () => {
    const facilitator = fakeFacilitator();
    const server = createResourceServer(facilitator);
    await server.initialize();
    const first = await processX402(server, usdtRoute(), request());
    if (first.result.type !== "payment-error") throw new Error("expected 402");
    const { payer, header } = await signedHeader(decodePaymentRequiredHeader(first.result.response.headers["PAYMENT-REQUIRED"]));

    const paid = await processX402(server, usdtRoute(), request({ "payment-signature": header }));
    expect(paid.result.type).toBe("payment-verified");
    const settled = await paid.settle();
    expect(settled).toMatchObject({ success: true, payer });
    expect(Object.keys(settled.headers)).toContain("PAYMENT-RESPONSE");
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it("does not accept a signature made for a different price", async () => {
    const server = createResourceServer(fakeFacilitator());
    await server.initialize();
    const first = await processX402(server, usdtRoute(), request());
    if (first.result.type !== "payment-error") throw new Error("expected 402");
    const { header } = await signedHeader(decodePaymentRequiredHeader(first.result.response.headers["PAYMENT-REQUIRED"]));
    const repriced = buildInvoiceRoute({ asset: "USDT", amountAtomic: 299_000000n, payTo: PAY_TO, description: "x" });
    const { result } = await processX402(server, repriced, request({ "payment-signature": header }));
    expect(result.type).toBe("payment-error");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/lib/payments/x402-server.test.ts`
Expected: FAIL, `Failed to resolve import "./x402-server"`.

- [ ] **Step 4: Implement `network.ts` and `x402-server.ts`**

`src/lib/payments/network.ts`:

```ts
/** CAIP-2 id of Celo mainnet, as x402 names networks. Safe to import from browser code. */
export const CELO_NETWORK = "eip155:42220" as const;
```

`src/lib/payments/x402-server.ts`:

```ts
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPProcessResult,
  type HTTPRequestContext,
  type ProcessSettleResultResponse,
  type RouteConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import type { Address } from "viem";
import { TOKENS } from "@/lib/chain/tokens";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import type { PayAsset } from "@/lib/money/currencies";
import { CELO_NETWORK } from "./network";

/** How long a signed authorization stays valid for settlement. */
export const PAYMENT_TIMEOUT_SECONDS = 300;

/** Spec §8.2: explicit asset/amount prices; Permit2 tokens also declare EIP-2612 gas sponsoring. */
export function buildInvoiceRoute(input: {
  asset: PayAsset;
  amountAtomic: bigint;
  payTo: Address;
  description: string;
}): RouteConfig {
  const token = TOKENS[input.asset];
  const permit2 = token.transferMethod === "permit2";
  return {
    accepts: {
      scheme: "exact",
      network: CELO_NETWORK,
      payTo: input.payTo,
      maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
      price: {
        asset: token.address,
        amount: input.amountAtomic.toString(),
        extra: {
          name: token.eip712.name,
          version: token.eip712.version,
          ...(permit2 ? { assetTransferMethod: "permit2" } : {}),
        },
      },
    },
    description: input.description,
    mimeType: "application/json",
    ...(permit2 ? { extensions: declareEip2612GasSponsoringExtension() } : {}),
  };
}

export function celoFacilitator(opts: { url: string; apiKey: string }): FacilitatorClient {
  const headers = { "X-API-Key": opts.apiKey };
  return new HTTPFacilitatorClient({
    url: opts.url,
    timeoutMs: 60_000,
    createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),
  });
}

export function createResourceServer(facilitator: FacilitatorClient): x402ResourceServer {
  return new x402ResourceServer(facilitator).register(CELO_NETWORK, new ExactEvmScheme());
}

let ready: Promise<x402ResourceServer> | undefined;

/** One initialised server per instance (it fetches the facilitator's /supported once); retried after a failure. */
export function getResourceServer(): Promise<x402ResourceServer> {
  if (!ready) {
    const env = parseServerEnv();
    const server = createResourceServer(
      celoFacilitator({ url: env.X402_FACILITATOR_URL, apiKey: requireValue(env.X402_API_KEY, "X402_API_KEY") }),
    );
    ready = server.initialize().then(
      () => server,
      (error: unknown) => {
        ready = undefined;
        throw error;
      },
    );
  }
  return ready;
}

export function requestContext(request: Request): HTTPRequestContext {
  const url = new URL(request.url);
  const adapter: HTTPAdapter = {
    getHeader: (name) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    // Always JSON: /pay/[slug] is our payment UI, so x402's HTML paywall is never served.
    getAcceptHeader: () => "application/json",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
  };
  return {
    adapter,
    path: url.pathname,
    method: request.method,
    paymentHeader: adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment"),
  };
}

export interface X402Exchange {
  result: HTTPProcessResult;
  settle(): Promise<ProcessSettleResultResponse>;
}

/** Verifies (through the facilitator) without settling; the caller claims the invoice, then settles. */
export async function processX402(server: x402ResourceServer, route: RouteConfig, request: Request): Promise<X402Exchange> {
  const http = new x402HTTPResourceServer(server, route);
  const context = requestContext(request);
  const result = await http.processHTTPRequest(context);
  return {
    result,
    settle: async () => {
      if (result.type !== "payment-verified") throw new Error("Only a verified payment can be settled");
      return http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, {
        request: context,
      });
    },
  };
}
```

- [ ] **Step 5: Run the wiring tests to see them pass**

Run: `npx vitest run src/lib/payments/x402-server.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing claim tests**

`src/lib/payments/invoice-claim.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import { claimInvoice, recordPayment, releaseInvoice } from "./invoice-claim";

let db: Db;
let invoiceId: string;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  const user = await seedFreelancer(db);
  invoiceId = (await seedInvoice(db, user.id)).id;
});

const at = (iso: string) => new Date(`2026-10-15T${iso}Z`);
const invoice = async () => (await db.select().from(invoices).where(eq(invoices.id, invoiceId)))[0];

describe("claimInvoice", () => {
  it("lets exactly one payment hold an open invoice", async () => {
    expect(await claimInvoice(db, invoiceId, at("12:00:00"))).toBe(true);
    expect(await invoice()).toMatchObject({ status: "settling", settlingUntil: at("12:03:00") });
    expect(await claimInvoice(db, invoiceId, at("12:01:00"))).toBe(false);
  });

  it("lets two simultaneous claims produce one winner", async () => {
    const results = await Promise.all([claimInvoice(db, invoiceId, at("12:00:00")), claimInvoice(db, invoiceId, at("12:00:00"))]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("frees a hold that has expired", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    expect(await claimInvoice(db, invoiceId, at("12:03:01"))).toBe(true);
  });

  it("never claims a paid invoice", async () => {
    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));
    expect(await claimInvoice(db, invoiceId, at("12:00:00"))).toBe(false);
  });
});

describe("releaseInvoice", () => {
  it("reopens a held invoice but leaves a paid one alone", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    await releaseInvoice(db, invoiceId);
    expect(await invoice()).toMatchObject({ status: "open", settlingUntil: null });

    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));
    await releaseInvoice(db, invoiceId);
    expect((await invoice()).status).toBe("paid");
  });
});

describe("recordPayment", () => {
  it("stores the payment and marks the invoice paid, once per transaction", async () => {
    await claimInvoice(db, invoiceId, at("12:00:00"));
    const payment = {
      invoiceId,
      payer: "0x9999999999999999999999999999999999999999",
      asset: "USDT" as const,
      amountAtomic: 300_000000n,
      txHash: `0x${"ab".repeat(32)}`,
      now: at("12:00:20"),
    };
    await recordPayment(db, payment);
    await recordPayment(db, payment);
    expect(await invoice()).toMatchObject({ status: "paid", paidAt: at("12:00:20"), settlingUntil: null });
    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ asset: "USDT", amountAtomic: "300000000" });
  });
});
```

- [ ] **Step 7: Implement `invoice-claim.ts`**

`src/lib/payments/invoice-claim.ts`:

```ts
import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";
import type { PayAsset } from "@/lib/money/currencies";

/** Longer than the facilitator timeout (60 s) plus settlement, so a live settlement is never overtaken. */
export const SETTLING_HOLD_MS = 3 * 60 * 1000;

/** Spec §12 "no double charge": only the request that moves the invoice to "settling" may settle. */
export async function claimInvoice(db: Db, invoiceId: string, now: Date): Promise<boolean> {
  const claimed = await db
    .update(invoices)
    .set({ status: "settling", settlingUntil: new Date(now.getTime() + SETTLING_HOLD_MS) })
    .where(
      and(
        eq(invoices.id, invoiceId),
        or(eq(invoices.status, "open"), and(eq(invoices.status, "settling"), lt(invoices.settlingUntil, now))),
      ),
    )
    .returning({ id: invoices.id });
  return claimed.length === 1;
}

/** After a settlement that definitely failed. */
export async function releaseInvoice(db: Db, invoiceId: string): Promise<void> {
  await db
    .update(invoices)
    .set({ status: "open", settlingUntil: null })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "settling")));
}

export async function recordPayment(
  db: Db,
  p: { invoiceId: string; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string; now: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(payments)
      .values({
        invoiceId: p.invoiceId,
        payer: p.payer,
        asset: p.asset,
        amountAtomic: p.amountAtomic.toString(),
        txHash: p.txHash,
        settledAt: p.now,
      })
      .onConflictDoNothing({ target: payments.txHash });
    await tx.update(invoices).set({ status: "paid", paidAt: p.now, settlingUntil: null }).where(eq(invoices.id, p.invoiceId));
  });
}
```

- [ ] **Step 8: Run the claim tests to see them pass**

Run: `npx vitest run src/lib/payments/invoice-claim.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing flow tests**

`src/lib/payments/pay-flow.test.ts`:

```ts
import type { HTTPProcessResult, ProcessSettleResultResponse, RouteConfig } from "@x402/core/server";
import { describe, expect, it, vi } from "vitest";
import { RatesUnavailableError } from "@/lib/fx/rates";
import type { PublicInvoice } from "@/lib/invoices/repo";
import { runPayFlow, type PayFlowDeps } from "./pay-flow";

const NOW = new Date("2026-10-15T12:00:00Z");
const TX = `0x${"ab".repeat(32)}`;
const invoice: PublicInvoice = {
  id: "inv-1",
  slug: "abc",
  clientName: "Acme",
  description: "Logo",
  amount: "300.00",
  currency: "USD",
  dueDate: null,
  status: "open",
  settlingUntil: null,
  freelancerName: "Ana",
  payTo: "0x1111111111111111111111111111111111111111",
  recurringSlug: null,
};
const verified = {
  type: "payment-verified",
  paymentPayload: {},
  paymentRequirements: { amount: "300000000" },
} as unknown as HTTPProcessResult;
const unpaid = {
  type: "payment-error",
  response: { status: 402, headers: { "PAYMENT-REQUIRED": "e30=" }, body: {} },
} as unknown as HTTPProcessResult;
const settledOk = { success: true, transaction: TX, payer: "0x9999", headers: { "PAYMENT-RESPONSE": "x" } } as unknown as ProcessSettleResultResponse;
const settledFail = {
  success: false,
  errorReason: "insufficient_funds",
  headers: {},
  response: { status: 402, headers: { "PAYMENT-REQUIRED": "e30=" }, body: {} },
} as unknown as ProcessSettleResultResponse;

function deps(overrides: Partial<PayFlowDeps> & { result?: HTTPProcessResult; settle?: () => Promise<ProcessSettleResultResponse> } = {}) {
  const { result = verified, settle = async () => settledOk, ...rest } = overrides;
  const base = {
    now: () => NOW,
    findInvoice: vi.fn(async () => invoice),
    quote: vi.fn(async () => ({ asset: "USDT" as const, amountAtomic: 300_000000n, rate: "1", expiresAt: new Date("2026-10-15T12:10:00Z") })),
    process: vi.fn(async (_route: RouteConfig) => ({ result, settle: vi.fn(settle) })),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
  };
  return { ...base, ...rest };
}

const run = (d: PayFlowDeps, asset: string | null = "USDT") => runPayFlow(d, { slug: "abc", asset });

describe("runPayFlow: before payment", () => {
  it("rejects unknown assets and invoices", async () => {
    expect(await run(deps(), "USDC")).toMatchObject({ status: 400, body: { error: "bad_asset" } });
    expect(await run(deps({ findInvoice: async () => null }))).toMatchObject({ status: 404 });
  });

  it("refuses paid, cancelled and currently-settling invoices", async () => {
    const paid = deps({ findInvoice: async () => ({ ...invoice, status: "paid" }) });
    expect(await run(paid)).toMatchObject({ status: 409, body: { error: "closed", status: "paid" } });
    const settling = deps({
      findInvoice: async () => ({ ...invoice, status: "settling", settlingUntil: new Date("2026-10-15T12:02:00Z") }),
    });
    expect(await run(settling)).toMatchObject({ status: 409, body: { error: "busy" } });
  });

  it("treats an expired settling hold as open", async () => {
    const stale = deps({
      findInvoice: async () => ({ ...invoice, status: "settling", settlingUntil: new Date("2026-10-15T11:59:00Z") }),
      result: unpaid,
    });
    expect((await run(stale)).status).toBe(402);
  });

  it("explains a missing wallet or missing rates", async () => {
    expect(await run(deps({ findInvoice: async () => ({ ...invoice, payTo: null }) }))).toMatchObject({
      status: 503,
      body: { error: "not_ready" },
    });
    const noRates = deps({
      quote: async () => {
        throw new RatesUnavailableError("down");
      },
    });
    expect(await run(noRates)).toMatchObject({ status: 503, body: { error: "rates_unavailable" } });
  });

  it("answers an unpaid request with the 402 and claims nothing", async () => {
    const d = deps({ result: unpaid });
    expect(await run(d)).toEqual({ status: 402, headers: { "PAYMENT-REQUIRED": "e30=" }, body: {} });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("prices the route from the locked quote and the owner's treasury wallet", async () => {
    const d = deps({ result: unpaid });
    await run(d);
    expect(d.process.mock.calls[0][0].accepts).toMatchObject({
      payTo: invoice.payTo,
      price: { amount: "300000000" },
    });
  });
});

describe("runPayFlow: with a verified payment", () => {
  it("claims, settles, records and returns the transaction", async () => {
    const d = deps();
    expect(await run(d)).toEqual({ status: 200, headers: { "PAYMENT-RESPONSE": "x" }, body: { status: "paid", txHash: TX } });
    expect(d.claim).toHaveBeenCalledWith("inv-1");
    expect(d.record).toHaveBeenCalledWith({ invoiceId: "inv-1", payer: "0x9999", asset: "USDT", amountAtomic: 300_000000n, txHash: TX });
  });

  it("never settles when another payment holds the invoice", async () => {
    const settle = vi.fn(async () => settledOk);
    const d = deps({ claim: async () => false, settle });
    expect(await run(d)).toMatchObject({ status: 409, body: { error: "busy" } });
    expect(settle).not.toHaveBeenCalled();
  });

  it("reopens the invoice when settlement fails", async () => {
    const d = deps({ settle: async () => settledFail });
    expect((await run(d)).status).toBe(402);
    expect(d.release).toHaveBeenCalledWith("inv-1");
    expect(d.record).not.toHaveBeenCalled();
  });

  it("keeps the hold when the settlement outcome is unknown", async () => {
    const d = deps({
      settle: async () => {
        throw new Error("timeout");
      },
    });
    expect(await run(d)).toMatchObject({ status: 502, body: { error: "settlement_unknown" } });
    expect(d.release).not.toHaveBeenCalled();
  });

  it("retries recording once and still reports the payment", async () => {
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValueOnce(undefined);
    const d = deps({ record });
    expect((await run(d)).status).toBe(200);
    expect(record).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 10: Implement `pay-flow.ts` and `deps.ts`**

`src/lib/payments/pay-flow.ts`:

```ts
import type { ProcessSettleResultResponse, RouteConfig } from "@x402/core/server";
import type { Address } from "viem";
import { RatesUnavailableError } from "@/lib/fx/rates";
import type { PublicInvoice } from "@/lib/invoices/repo";
import { isPayAsset, type PayAsset } from "@/lib/money/currencies";
import type { LockedQuote } from "./quotes-repo";
import { buildInvoiceRoute, type X402Exchange } from "./x402-server";

export interface PayResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** What the payment page needs before it asks the wallet to sign. */
export interface QuoteResponse {
  asset: PayAsset;
  amountAtomic: string;
  expiresAt: string;
  payTo: Address;
  tokenAddress: Address;
  decimals: number;
}

export interface PayFlowDeps {
  now(): Date;
  findInvoice(slug: string): Promise<PublicInvoice | null>;
  quote(invoice: PublicInvoice, asset: PayAsset): Promise<LockedQuote>;
  process(route: RouteConfig): Promise<X402Exchange>;
  claim(invoiceId: string): Promise<boolean>;
  release(invoiceId: string): Promise<void>;
  record(payment: { invoiceId: string; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string }): Promise<void>;
}

type Prepared =
  | { ok: true; invoice: PublicInvoice & { payTo: Address }; asset: PayAsset; quote: LockedQuote }
  | { ok: false; response: PayResponse };

const reply = (status: number, body: unknown): PayResponse => ({ status, headers: {}, body });
const fail = (status: number, body: unknown): Prepared => ({ ok: false, response: reply(status, body) });

/** Shared by the quote endpoint and the payment endpoint, so both refuse the same invoices. */
export async function preparePayment(
  deps: Pick<PayFlowDeps, "now" | "findInvoice" | "quote">,
  input: { slug: string; asset: string | null },
): Promise<Prepared> {
  const asset = input.asset;
  if (!isPayAsset(asset)) return fail(400, { error: "bad_asset" });
  const invoice = await deps.findInvoice(input.slug);
  if (!invoice) return fail(404, { error: "not_found" });
  if (invoice.status === "paid" || invoice.status === "cancelled") return fail(409, { error: "closed", status: invoice.status });
  if (invoice.status === "settling" && invoice.settlingUntil && invoice.settlingUntil > deps.now()) {
    return fail(409, { error: "busy" });
  }
  const payTo = invoice.payTo;
  if (!payTo) return fail(503, { error: "not_ready" });
  try {
    const quote = await deps.quote(invoice, asset);
    return { ok: true, invoice: { ...invoice, payTo }, asset, quote };
  } catch (error) {
    if (error instanceof RatesUnavailableError) return fail(503, { error: "rates_unavailable" });
    throw error;
  }
}

/**
 * Spec §7.3 and §12: 402 → (client signs) → verify → claim → settle → record.
 * An invoice that cannot be claimed is never settled; a failed settlement reopens it; an unknown
 * outcome keeps the hold until it expires, so nobody is invited to pay twice.
 */
export async function runPayFlow(deps: PayFlowDeps, input: { slug: string; asset: string | null }): Promise<PayResponse> {
  const prepared = await preparePayment(deps, input);
  if (!prepared.ok) return prepared.response;
  const { invoice, asset, quote } = prepared;

  const { result, settle } = await deps.process(
    buildInvoiceRoute({ asset, amountAtomic: quote.amountAtomic, payTo: invoice.payTo, description: `Cobro invoice ${invoice.slug}` }),
  );
  if (result.type === "payment-error") {
    return { status: result.response.status, headers: result.response.headers, body: result.response.body ?? {} };
  }
  if (result.type !== "payment-verified") return reply(500, { error: "unexpected_x402_state" });

  if (!(await deps.claim(invoice.id))) return reply(409, { error: "busy" });

  let settled: ProcessSettleResultResponse;
  try {
    settled = await settle();
  } catch (error) {
    console.error(`Settlement outcome unknown for invoice ${invoice.slug}:`, error instanceof Error ? error.message : error);
    return reply(502, { error: "settlement_unknown" });
  }
  if (!settled.success) {
    await deps.release(invoice.id);
    return {
      status: settled.response.status,
      headers: settled.response.headers,
      body: settled.response.body ?? { error: settled.errorReason },
    };
  }

  const payment = {
    invoiceId: invoice.id,
    payer: settled.payer ?? "",
    asset,
    amountAtomic: BigInt(result.paymentRequirements.amount),
    txHash: settled.transaction,
  };
  try {
    await deps.record(payment);
  } catch {
    try {
      await deps.record(payment);
    } catch (error) {
      // The money has moved; the payer must see success. Reconcile from this log line.
      console.error(`PAYMENT SETTLED BUT NOT RECORDED: invoice ${invoice.slug} tx ${settled.transaction}`, error);
    }
  }
  return { status: 200, headers: settled.headers, body: { status: "paid", txHash: settled.transaction } };
}
```

`src/lib/payments/deps.ts`:

```ts
import type { Db } from "@/lib/db/client";
import { getReferenceRates } from "@/lib/fx/rates";
import { findPublicInvoice } from "@/lib/invoices/repo";
import { claimInvoice, recordPayment, releaseInvoice } from "./invoice-claim";
import type { PayFlowDeps } from "./pay-flow";
import { needsRates, quoteInvoice } from "./quote";
import { lockQuote } from "./quotes-repo";

/** Real database and Textile wiring for preparePayment/runPayFlow; x402 processing is added per request. */
export function invoicePaymentDeps(db: Db): Omit<PayFlowDeps, "process"> {
  return {
    now: () => new Date(),
    findInvoice: (slug) => findPublicInvoice(db, slug),
    quote: (invoice, asset) =>
      lockQuote(db, {
        invoiceId: invoice.id,
        asset,
        now: new Date(),
        compute: async () =>
          quoteInvoice({
            amount: invoice.amount,
            currency: invoice.currency,
            asset,
            rates: needsRates(invoice.currency, asset) ? await getReferenceRates() : null,
          }),
      }),
    claim: (invoiceId) => claimInvoice(db, invoiceId, new Date()),
    release: (invoiceId) => releaseInvoice(db, invoiceId),
    record: (payment) => recordPayment(db, { ...payment, now: new Date() }),
  };
}
```

- [ ] **Step 11: Run all payment tests to see them pass**

Run: `npx vitest run src/lib/payments`
Expected: PASS.

- [ ] **Step 12: Add the two route handlers**

`src/app/api/pay/[slug]/route.ts`:

```ts
import { getDb } from "@/lib/db/client";
import { invoicePaymentDeps } from "@/lib/payments/deps";
import { runPayFlow } from "@/lib/payments/pay-flow";
import { getResourceServer, processX402 } from "@/lib/payments/x402-server";

export async function GET(request: Request, ctx: RouteContext<"/api/pay/[slug]">) {
  const { slug } = await ctx.params;
  let server: Awaited<ReturnType<typeof getResourceServer>>;
  try {
    server = await getResourceServer();
  } catch (error) {
    console.error("x402 facilitator unavailable:", error instanceof Error ? error.message : error);
    return Response.json({ error: "facilitator_unavailable" }, { status: 503 });
  }
  const response = await runPayFlow(
    { ...invoicePaymentDeps(getDb()), process: (route) => processX402(server, route, request) },
    { slug, asset: new URL(request.url).searchParams.get("asset") },
  );
  return Response.json(response.body, { status: response.status, headers: response.headers });
}
```

`src/app/api/pay/[slug]/quote/route.ts`:

```ts
import { TOKENS } from "@/lib/chain/tokens";
import { getDb } from "@/lib/db/client";
import { invoicePaymentDeps } from "@/lib/payments/deps";
import { preparePayment, type QuoteResponse } from "@/lib/payments/pay-flow";

export async function GET(request: Request, ctx: RouteContext<"/api/pay/[slug]/quote">) {
  const { slug } = await ctx.params;
  const prepared = await preparePayment(invoicePaymentDeps(getDb()), {
    slug,
    asset: new URL(request.url).searchParams.get("asset"),
  });
  if (!prepared.ok) return Response.json(prepared.response.body, { status: prepared.response.status });
  const { asset, quote, invoice } = prepared;
  const body: QuoteResponse = {
    asset,
    amountAtomic: quote.amountAtomic.toString(),
    expiresAt: quote.expiresAt.toISOString(),
    payTo: invoice.payTo,
    tokenAddress: TOKENS[asset].address,
    decimals: TOKENS[asset].decimals,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 13: Verify against the real facilitator, without paying**

Run: `npm test && npm run typecheck && npm run build`, then `npm run dev`. Create a 1.00 USD invoice in the app and copy its slug from the link. Then:

```bash
curl -s "http://localhost:3000/api/pay/<slug>/quote?asset=USDT"
curl -s -D - -o /dev/null "http://localhost:3000/api/pay/<slug>?asset=USDT" | grep -i -E "^HTTP|payment-required"
curl -s "http://localhost:3000/api/pay/<slug>?asset=USDC"
```

Expected: the quote JSON shows `"amountAtomic":"1000000"` and the treasury address as `payTo`; the second call prints `HTTP/1.1 402` and a `payment-required:` header; the third returns `{"error":"bad_asset"}`. The 402 call reaches `https://api.x402.celo.org/supported` only (no settlement, no credits used).

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json src/lib/payments src/app/api/pay
git commit -m "feat(payments): x402 endpoint that claims the invoice before settling through Celo's facilitator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Public payment page

**Files:**
- Create: `src/lib/payments/payer-client.ts`, `src/lib/payments/payer-client.test.ts`, `src/lib/payments/wallet-signer.ts`, `src/lib/payments/pay-state.ts`, `src/lib/payments/pay-state.test.ts`, `src/app/pay/[slug]/page.tsx`, `src/app/pay/[slug]/pay-invoice.tsx`
- Modify: `package.json`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `CELO_NETWORK` (Task 10 `network.ts`), `QuoteResponse` (Task 10, type only), `findPublicInvoice` (Task 8), `formatMoney`, `formatTokenAmount`, `PAY_ASSETS`, `PayAsset` (Task 2), `formatDate` (Task 8), `WalletProviders` (Plan 1), `Card*`, `Button`, `Skeleton` (Plan 1, Task 6).
- Produces:
  - `interface ExpectedPayment { asset: Address; amountAtomic: bigint; payTo: Address }`, `createInvoicePayerClient(signer: ClientEvmSigner, expected: ExpectedPayment): x402Client`, `createInvoicePayerFetch(signer, expected, opts?: { onSigned?: () => void }): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>`.
  - `toX402Signer(walletClient, publicClient): ClientEvmSigner`.
  - `type PayBlocker = "no-wallet" | "connect" | "switch-network" | "expired" | "insufficient" | null`, `payBlocker(input): PayBlocker`, `payErrorKey(status: number, body: unknown): MessageKey`, `payExceptionKind(error: unknown): "declined" | "changed" | "other"`, `secondsLeft(expiresAt: number, now: number): number`, `formatCountdown(seconds: number): string`.
  - Page `/pay/[slug]`.

- [ ] **Step 1: Install the browser x402 client**

```bash
npm install @x402/fetch@2.28.0
```

- [ ] **Step 2: Write the failing payer-client tests**

`src/lib/payments/payer-client.test.ts`:

```ts
import type { PaymentRequired } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { createInvoicePayerClient } from "./payer-client";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const account = privateKeyToAccount(generatePrivateKey());
const signer = toClientEvmSigner({
  address: account.address,
  signTypedData: (message) => account.signTypedData(message as Parameters<typeof account.signTypedData>[0]),
});

function required(overrides: { amount?: string; payTo?: string; asset?: string } = {}): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: "https://cobro.test/api/pay/abc?asset=USDT" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:42220",
        asset: overrides.asset ?? TOKENS.USDT.address,
        amount: overrides.amount ?? "300000000",
        payTo: overrides.payTo ?? PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { name: "Tether USD", version: "1" },
      },
    ],
  };
}

const client = () => createInvoicePayerClient(signer, { asset: TOKENS.USDT.address, amountAtomic: 300_000000n, payTo: PAY_TO });

describe("createInvoicePayerClient", () => {
  it("signs a real invoice amount that the stock client's $1 cap would refuse", async () => {
    const payload = await client().createPaymentPayload(required());
    expect(payload.accepted.amount).toBe("300000000");
    expect(Object.keys(payload.payload)).toEqual(expect.arrayContaining(["authorization", "signature"]));
  });

  it("refuses any other amount, recipient or token", async () => {
    await expect(client().createPaymentPayload(required({ amount: "300000001" }))).rejects.toThrow();
    await expect(client().createPaymentPayload(required({ payTo: "0x2222222222222222222222222222222222222222" }))).rejects.toThrow();
    await expect(client().createPaymentPayload(required({ asset: TOKENS.USAT.address }))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/lib/payments/payer-client.test.ts`
Expected: FAIL, `Failed to resolve import "./payer-client"`.

- [ ] **Step 4: Implement `payer-client.ts` and `wallet-signer.ts`**

`src/lib/payments/payer-client.ts`:

```ts
import { x402Client } from "@x402/core/client";
import type { ClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { Address } from "viem";
import { CELO_NETWORK } from "./network";

export interface ExpectedPayment {
  asset: Address;
  amountAtomic: bigint;
  payTo: Address;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * An x402 client that signs one payment only: this token, this amount, to this treasury wallet.
 * The stock client caps payments at $1 (spendControls); the cap is lifted for this asset and amount only.
 */
export function createInvoicePayerClient(signer: ClientEvmSigner, expected: ExpectedPayment): x402Client {
  const amount = expected.amountAtomic.toString();
  return new x402Client()
    .register(CELO_NETWORK, new ExactEvmScheme(signer))
    .setSpendControls({
      maxAmountPerPayment: false,
      allowedAssets: [{ network: CELO_NETWORK, asset: expected.asset, maxAmountPerPayment: amount }],
    })
    .registerPolicy((_version, requirements) =>
      requirements.filter(
        (r) => r.network === CELO_NETWORK && same(r.asset, expected.asset) && r.amount === amount && same(r.payTo, expected.payTo),
      ),
    );
}

export function createInvoicePayerFetch(
  signer: ClientEvmSigner,
  expected: ExpectedPayment,
  opts: { onSigned?: () => void } = {},
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const client = createInvoicePayerClient(signer, expected);
  if (opts.onSigned) {
    const onSigned = opts.onSigned;
    client.onAfterPaymentCreation(async () => onSigned());
  }
  return wrapFetchWithPayment(globalThis.fetch.bind(globalThis), client);
}
```

`src/lib/payments/wallet-signer.ts`:

```ts
import { toClientEvmSigner, type ClientEvmSigner } from "@x402/evm";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";

/** The connected browser wallet as an x402 signer. Reads are used for Permit2 allowance checks (wARS, wBRL). */
export function toX402Signer(
  walletClient: WalletClient<Transport, Chain, Account>,
  publicClient: Pick<PublicClient, "readContract">,
): ClientEvmSigner {
  return toClientEvmSigner(
    {
      address: walletClient.account.address,
      signTypedData: (message) =>
        walletClient.signTypedData({
          account: walletClient.account,
          ...(message as Omit<Parameters<typeof walletClient.signTypedData>[0], "account">),
        } as Parameters<typeof walletClient.signTypedData>[0]),
    },
    { readContract: (args) => publicClient.readContract(args as Parameters<PublicClient["readContract"]>[0]) },
  );
}
```

wagmi types its clients for the Celo chain. If `useWalletClient`/`usePublicClient` results do not assign to these parameter types in `pay-invoice.tsx`, cast them there with `as unknown as` to the parameter types; the runtime objects are the same viem clients.

If `onAfterPaymentCreation` has a different hook signature in 2.28.0, `npm run typecheck` will show it in `node_modules/@x402/core/dist/esm/x402Client-*.d.mts`; adapt the callback to that signature (it only needs to call `onSigned`).

- [ ] **Step 5: Run the payer-client tests to see them pass**

Run: `npx vitest run src/lib/payments/payer-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing pay-state tests**

`src/lib/payments/pay-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCountdown, payBlocker, payErrorKey, payExceptionKind, secondsLeft } from "./pay-state";

const ready = {
  hasInjectedWallet: true,
  address: "0xabc",
  chainId: 42220,
  balance: 300_000000n,
  amountAtomic: 300_000000n,
  expiresAt: 1_000_000,
  now: 999_000,
};

describe("payBlocker", () => {
  it("is null when everything is in place", () => {
    expect(payBlocker(ready)).toBeNull();
  });

  it("asks for the first missing thing, in order", () => {
    expect(payBlocker({ ...ready, hasInjectedWallet: false })).toBe("no-wallet");
    expect(payBlocker({ ...ready, address: undefined })).toBe("connect");
    expect(payBlocker({ ...ready, chainId: 1 })).toBe("switch-network");
    expect(payBlocker({ ...ready, now: 1_000_000 })).toBe("expired");
    expect(payBlocker({ ...ready, balance: 299_999999n })).toBe("insufficient");
  });

  it("does not block while the balance is still loading", () => {
    expect(payBlocker({ ...ready, balance: undefined })).toBeNull();
  });
});

describe("payErrorKey", () => {
  it("maps server answers to plain messages", () => {
    expect(payErrorKey(409, { error: "busy" })).toBe("pay.error.busy");
    expect(payErrorKey(409, { error: "closed", status: "paid" })).toBe("pay.error.closed");
    expect(payErrorKey(503, { error: "rates_unavailable" })).toBe("pay.error.rates");
    expect(payErrorKey(503, { error: "not_ready" })).toBe("pay.error.notReady");
    expect(payErrorKey(502, { error: "settlement_unknown" })).toBe("pay.error.unknown");
    expect(payErrorKey(402, {})).toBe("pay.error.rejected");
    expect(payErrorKey(500, null)).toBe("pay.error.generic");
  });
});

describe("payExceptionKind", () => {
  it("recognises a declined signature, even when wrapped", () => {
    expect(payExceptionKind({ name: "UserRejectedRequestError" })).toBe("declined");
    expect(payExceptionKind({ code: 4001 })).toBe("declined");
    expect(payExceptionKind(new Error("outer", { cause: { code: 4001 } }))).toBe("declined");
  });

  it("recognises a price that no longer matches the quote", () => {
    expect(payExceptionKind(new Error("All payment requirements were rejected by spendControls"))).toBe("changed");
    expect(payExceptionKind(new Error("network down"))).toBe("other");
  });
});

describe("countdown", () => {
  it("counts whole seconds down to zero", () => {
    expect(secondsLeft(1_000_000, 400_500)).toBe(599);
    expect(secondsLeft(1_000_000, 1_000_001)).toBe(0);
    expect(formatCountdown(599)).toBe("9:59");
    expect(formatCountdown(5)).toBe("0:05");
  });
});
```

- [ ] **Step 7: Implement `pay-state.ts`**

`src/lib/payments/pay-state.ts`:

```ts
import type { MessageKey } from "@/i18n";

export type PayBlocker = "no-wallet" | "connect" | "switch-network" | "expired" | "insufficient" | null;

const CELO_CHAIN_ID = 42220;

/** The first thing standing between the payer and the Pay button (spec §17.2 payment states). */
export function payBlocker(input: {
  hasInjectedWallet: boolean;
  address?: string;
  chainId?: number;
  balance?: bigint;
  amountAtomic?: bigint;
  expiresAt?: number;
  now: number;
}): PayBlocker {
  if (!input.hasInjectedWallet) return "no-wallet";
  if (!input.address) return "connect";
  if (input.chainId !== CELO_CHAIN_ID) return "switch-network";
  if (input.expiresAt !== undefined && input.now >= input.expiresAt) return "expired";
  if (input.balance !== undefined && input.amountAtomic !== undefined && input.balance < input.amountAtomic) {
    return "insufficient";
  }
  return null;
}

export function payErrorKey(status: number, body: unknown): MessageKey {
  const error = typeof body === "object" && body !== null && "error" in body ? String(body.error) : "";
  if (status === 409) return error === "busy" ? "pay.error.busy" : "pay.error.closed";
  if (status === 503) return error === "rates_unavailable" ? "pay.error.rates" : "pay.error.notReady";
  if (status === 502) return "pay.error.unknown";
  if (status === 402) return "pay.error.rejected";
  return "pay.error.generic";
}

/** Wallet libraries wrap errors; walk the cause chain looking for EIP-1193 code 4001. */
export function payExceptionKind(error: unknown): "declined" | "changed" | "other" {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const e = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (e.name === "UserRejectedRequestError" || e.code === 4001) return "declined";
    if (typeof e.message === "string" && /rejected by (spendControls|polic)|no payment requirements/i.test(e.message)) {
      return "changed";
    }
    current = e.cause;
  }
  return "other";
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 8: Run the pay-state tests to see them pass**

Run: `npx vitest run src/lib/payments/pay-state.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the strings**

Add to `src/i18n/en.ts`:

```ts
  "pay.title": "Pay invoice",
  "pay.from": "Invoice from {name}",
  "pay.billedTo": "Billed to",
  "pay.progress": "Payment progress",
  "pay.step.choose": "Choose how to pay",
  "pay.step.connect": "Connect wallet",
  "pay.step.confirm": "Confirm",
  "pay.step.paid": "Paid",
  "pay.choose": "Choose how to pay",
  "pay.recommendedUs": "Recommended for US clients",
  "pay.chooseHint": "Pick a currency to see the exact amount.",
  "pay.loadingQuote": "Getting today's rate…",
  "pay.youPay": "You pay",
  "pay.noFee": "No network fee. You only sign.",
  "pay.rateLocked": "Rate locked for {time}",
  "pay.connect": "Connect wallet",
  "pay.switch": "Switch to Celo",
  "pay.newRate": "Get a new rate",
  "pay.expired": "The rate expired. Get a new one to continue.",
  "pay.noWallet": "Open this page in a wallet app (MiniPay, MetaMask or Rabby), or install a browser wallet, to pay.",
  "pay.insufficient": "Your wallet has {balance}. Add funds or choose another currency.",
  "pay.pay": "Pay {amount}",
  "pay.signing": "Confirm in your wallet…",
  "pay.settling": "Confirming your payment…",
  "pay.paidTitle": "Payment complete",
  "pay.paidBody": "You paid {amount}. The freelancer has been notified.",
  "pay.receipt": "View receipt on Celoscan",
  "pay.alreadyPaid": "This invoice has been paid. Thank you!",
  "pay.cancelled": "This invoice was cancelled. Contact the sender if you think this is a mistake.",
  "pay.notReady": "This invoice can't be paid yet. Please try again in a few minutes.",
  "pay.error.busy": "Another payment for this invoice is being confirmed. Wait a minute, then refresh before paying.",
  "pay.error.closed": "This invoice is no longer open for payment.",
  "pay.error.rates": "We can't get a fair rate for this currency right now. Try US dollar (USA₮) or Dollar (USD₮), or try again later.",
  "pay.error.notReady": "This invoice can't be paid yet. Please try again in a few minutes.",
  "pay.error.unknown": "We couldn't confirm your payment yet. Don't pay again: refresh this page in a few minutes.",
  "pay.error.rejected": "The payment wasn't accepted. Check your balance and try again.",
  "pay.error.declined": "You declined the signature. Nothing was paid.",
  "pay.error.changed": "The amount changed while you were paying. Check the new amount and confirm again.",
  "pay.error.connect": "We couldn't connect to your wallet. Try again.",
  "pay.error.generic": "Something went wrong. Nothing was paid. Please try again.",
  "pay.retry": "Try again",
  "recurring.history": "See all payments for this invoice",
```

- [ ] **Step 10: Build the payment page**

`src/app/pay/[slug]/page.tsx`:

```tsx
import { CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/invoices/dates";
import { findPublicInvoice } from "@/lib/invoices/repo";
import { formatMoney } from "@/lib/money/format";
import { PayInvoice } from "./pay-invoice";

export const metadata: Metadata = { title: `${t("pay.title")} · ${t("app.name")}`, robots: { index: false, follow: false } };

export default function PayPage(props: PageProps<"/pay/[slug]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <p className="text-sm font-semibold text-primary">{t("app.name")}</p>
      <Suspense fallback={<Skeleton className="h-[28rem] w-full" />}>
        <Pay params={props.params} />
      </Suspense>
    </main>
  );
}

async function Pay({ params }: { params: PageProps<"/pay/[slug]">["params"] }) {
  const { slug } = await params;
  const invoice = await findPublicInvoice(getDb(), slug);
  if (!invoice) notFound();

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("pay.from", { name: invoice.freelancerName ?? t("app.name") })}</p>
          <h1 className="text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(invoice.amount, invoice.currency)}</h1>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("invoice.for")}</dt>
              <dd className="text-base">{invoice.description}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("pay.billedTo")}</dt>
              <dd className="text-base">{invoice.clientName}</dd>
            </div>
            {invoice.dueDate && (
              <div>
                <dt className="sr-only">{t("invoiceForm.dueDate")}</dt>
                <dd>{t("invoices.due", { date: formatDate(invoice.dueDate) })}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {invoice.status === "paid" ? (
        <p role="status" className="flex items-start gap-2 font-medium text-success">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {t("pay.alreadyPaid")}
          {invoice.recurringSlug && (
            <Link href={`/r/${invoice.recurringSlug}`} className="ml-1 text-primary underline underline-offset-4">
              {t("recurring.history")}
            </Link>
          )}
        </p>
      ) : invoice.status === "cancelled" || !invoice.payTo ? (
        <p role="alert" className="flex items-start gap-2 text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {invoice.status === "cancelled" ? t("pay.cancelled") : t("pay.notReady")}
        </p>
      ) : (
        <WalletProviders>
          <PayInvoice slug={invoice.slug} />
        </WalletProviders>
      )}
    </>
  );
}
```

`src/app/pay/[slug]/pay-invoice.tsx`:

```tsx
"use client";

import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { erc20Abi } from "viem";
import {
  useConnect,
  useConnection,
  useConnectors,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { celo } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { PAY_ASSETS, type PayAsset } from "@/lib/money/currencies";
import { formatTokenAmount } from "@/lib/money/format";
import type { QuoteResponse } from "@/lib/payments/pay-flow";
import { formatCountdown, payBlocker, payErrorKey, payExceptionKind, secondsLeft } from "@/lib/payments/pay-state";
import { createInvoicePayerFetch } from "@/lib/payments/payer-client";
import { toX402Signer } from "@/lib/payments/wallet-signer";

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "settling" }
  | { kind: "paid"; txHash: string; amount: string }
  | { kind: "error"; key: MessageKey };

const STEPS: MessageKey[] = ["pay.step.choose", "pay.step.connect", "pay.step.confirm", "pay.step.paid"];

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PayInvoice({ slug }: { slug: string }) {
  const connection = useConnection();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient({ chainId: celo.id });
  const publicClient = usePublicClient({ chainId: celo.id });
  const now = useNow(1000);
  const [asset, setAsset] = useState<PayAsset | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const amountAtomic = quote ? BigInt(quote.amountAtomic) : undefined;
  const balance = useReadContract({
    address: quote?.tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connection.address ? [connection.address] : undefined,
    chainId: celo.id,
    query: { enabled: Boolean(quote && connection.address) },
  });
  const expiresAt = quote ? Date.parse(quote.expiresAt) : undefined;
  const blocker = payBlocker({
    hasInjectedWallet: connectors.length > 0,
    address: connection.address,
    chainId: connection.chainId,
    balance: balance.data,
    amountAtomic,
    expiresAt,
    now,
  });
  const busy = phase.kind === "signing" || phase.kind === "settling";
  const amountLabel = quote && asset ? formatTokenAmount(BigInt(quote.amountAtomic), asset) : "";

  async function loadQuote(next: PayAsset) {
    setAsset(next);
    setQuote(null);
    setLoadingQuote(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(`/api/pay/${slug}/quote?asset=${next}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) setQuote(body as QuoteResponse);
      else setPhase({ kind: "error", key: payErrorKey(response.status, body) });
    } catch {
      setPhase({ kind: "error", key: "pay.error.generic" });
    } finally {
      setLoadingQuote(false);
    }
  }

  async function connect() {
    try {
      await connectAsync({ connector: connectors[0], chainId: celo.id });
    } catch (error) {
      setPhase({ kind: "error", key: payExceptionKind(error) === "declined" ? "pay.error.declined" : "pay.error.connect" });
    }
  }

  async function pay() {
    if (!quote || !asset || !walletClient || !publicClient || blocker !== null) return;
    setPhase({ kind: "signing" });
    try {
      const payFetch = createInvoicePayerFetch(
        toX402Signer(walletClient, publicClient),
        { asset: quote.tokenAddress, amountAtomic: BigInt(quote.amountAtomic), payTo: quote.payTo },
        { onSigned: () => setPhase({ kind: "settling" }) },
      );
      const response = await payFetch(`/api/pay/${slug}?asset=${asset}`);
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setPhase({ kind: "paid", txHash: (body as { txHash: string }).txHash, amount: amountLabel });
        return;
      }
      if (response.status === 402) await loadQuote(asset);
      setPhase({ kind: "error", key: payErrorKey(response.status, body) });
    } catch (error) {
      const kind = payExceptionKind(error);
      if (kind === "changed") await loadQuote(asset);
      setPhase({
        kind: "error",
        key: kind === "declined" ? "pay.error.declined" : kind === "changed" ? "pay.error.changed" : "pay.error.generic",
      });
    }
  }

  if (phase.kind === "paid") {
    return (
      <section role="status" className="flex flex-col gap-3">
        <Stepper current={4} />
        <p className="flex items-center gap-2 text-lg font-semibold text-success">
          <CircleCheck aria-hidden="true" className="size-6" />
          {t("pay.paidTitle")}
        </p>
        <p>{t("pay.paidBody", { amount: phase.amount })}</p>
        <a
          href={`https://celoscan.io/tx/${phase.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 w-fit items-center gap-2 rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("pay.receipt")}
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      </section>
    );
  }

  const step = !quote ? 1 : blocker === "no-wallet" || blocker === "connect" || blocker === "switch-network" ? 2 : 3;

  return (
    <div className="flex flex-col gap-6">
      <Stepper current={step} />

      <fieldset className="flex flex-col gap-3" disabled={busy}>
        <legend className="mb-1 text-lg font-semibold">{t("pay.choose")}</legend>
        {PAY_ASSETS.map((code) => (
          <label
            key={code}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-4 py-3 has-checked:border-primary has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name="asset"
              value={code}
              checked={asset === code}
              onChange={() => void loadQuote(code)}
              className="size-4 accent-primary"
            />
            <span className="flex flex-col">
              <span className="font-medium">{t(`asset.${code}.name` as const)}</span>
              {code === "USAT" && <span className="text-sm text-muted-foreground">{t("pay.recommendedUs")}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      <section aria-live="polite" className="flex flex-col gap-1">
        {!asset && <p className="text-muted-foreground">{t("pay.chooseHint")}</p>}
        {loadingQuote && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            {t("pay.loadingQuote")}
          </p>
        )}
        {quote && asset && (
          <>
            <p className="text-sm text-muted-foreground">{t("pay.youPay")}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{amountLabel}</p>
            <p className="text-sm text-muted-foreground">{t("pay.noFee")}</p>
            {blocker === "expired" ? (
              <p className="text-sm text-warning">{t("pay.expired")}</p>
            ) : (
              expiresAt !== undefined && (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {t("pay.rateLocked", { time: formatCountdown(secondsLeft(expiresAt, now)) })}
                </p>
              )
            )}
          </>
        )}
      </section>

      {quote && asset && (
        <div className="flex flex-col gap-3">
          {blocker === "no-wallet" && <p>{t("pay.noWallet")}</p>}
          {blocker === "connect" && (
            <Button size="lg" className="min-h-11" onClick={connect}>
              {t("pay.connect")}
            </Button>
          )}
          {blocker === "switch-network" && (
            <Button size="lg" className="min-h-11" onClick={() => void switchChainAsync({ chainId: celo.id }).catch(() => {})}>
              {t("pay.switch")}
            </Button>
          )}
          {blocker === "expired" && (
            <Button size="lg" className="min-h-11" onClick={() => void loadQuote(asset)}>
              {t("pay.newRate")}
            </Button>
          )}
          {blocker === "insufficient" && balance.data !== undefined && (
            <p className="text-warning">{t("pay.insufficient", { balance: formatTokenAmount(balance.data, asset) })}</p>
          )}
          {blocker === null && (
            <Button size="lg" className="min-h-11" onClick={pay} disabled={busy} aria-disabled={busy}>
              {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
              {phase.kind === "signing" ? t("pay.signing") : phase.kind === "settling" ? t("pay.settling") : t("pay.pay", { amount: amountLabel })}
            </Button>
          )}
        </div>
      )}

      <div aria-live="assertive">
        {phase.kind === "error" && (
          <p role="alert" className="flex items-start gap-2 text-destructive">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t(phase.key)}
          </p>
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label={t("pay.progress")} className="grid grid-cols-4 gap-2 text-xs">
      {STEPS.map((key, index) => {
        const n = index + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={key} aria-current={state === "current" ? "step" : undefined} className="flex flex-col gap-1">
            <span aria-hidden="true" className={`h-1.5 rounded-full ${state === "todo" ? "bg-muted" : "bg-primary"}`} />
            <span className={state === "current" ? "font-medium text-foreground" : "text-muted-foreground"}>{t(key)}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 11: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

By hand with `npm run dev` and a browser wallet on Celo holding no USD₮ (no money moves in this check):
1. Open a 1.00 USD invoice's `/pay/<slug>` at 375px: the summary shows `US$1.00`, the stepper is on "Choose how to pay".
2. Pick "US dollar (USA₮)": "1.00 USA₮", "No network fee. You only sign.", and the countdown ticks down from 9:59.
3. "Connect wallet" connects; with the wallet on another network, "Switch to Celo" appears and works.
4. With no USA₮ in the wallet, "Your wallet has 0.00 USA₮. Add funds or choose another currency." and no Pay button.
5. Wait out the countdown (or set the system clock forward): "The rate expired" and "Get a new rate".
6. Without a browser wallet (a private window without extensions), the no-wallet message shows.
7. An unknown slug shows the 404 page. A paid invoice shows "This invoice has been paid".
8. Keyboard only: Tab reaches each currency option, Connect and Pay, with a visible focus ring; arrow keys move between currencies.
9. Chrome DevTools → Lighthouse → Accessibility on `/pay/<slug>` and `/app` scores ≥ 95 (spec §17.3), and the MASTER.md pre-delivery checklist holds for both pages.

Real payments happen in Task 13.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json src/lib/payments src/app/pay src/i18n/en.ts
git commit -m "feat(pay): public payment page with a payer client limited to the quoted amount

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Recurring link and the scheduled cron route

**Files:**
- Create: `src/lib/cron/auth.ts`, `src/lib/cron/auth.test.ts`, `src/app/api/cron/treasury/route.ts`, `src/app/r/[slug]/page.tsx`, `.github/workflows/treasury-cron.yml`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: `issueDueRecurring`, `resolveRecurringLink`, `formatDate` (Task 8); `parseServerEnv` (Task 1); `getDb` (Task 1); `formatMoney` (Task 2); `InvoiceStatusChip` (Task 9).
- Produces:
  - `isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean`.
  - `POST /api/cron/treasury` with `Authorization: Bearer <CRON_SECRET>` → `200 { issued: number }`; otherwise 401. Plan 3 adds the treasury run to this route.
  - Page `/r/[slug]`: redirects to the oldest open period's `/pay/<slug>`, or lists the paid periods.
  - GitHub Actions workflow running every 10 minutes and on demand.

- [ ] **Step 1: Write the failing cron auth tests**

`src/lib/cron/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./auth";

const SECRET = "s".repeat(40);

describe("isAuthorizedCron", () => {
  it("accepts exactly the bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong, missing or differently formatted secret", () => {
    expect(isAuthorizedCron(`Bearer ${"t".repeat(40)}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("rejects everything while no secret is configured", () => {
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/cron`
Expected: FAIL, `Failed to resolve import "./auth"`.

- [ ] **Step 3: Implement `auth.ts` and the route**

`src/lib/cron/auth.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time check of `Authorization: Bearer <secret>`; hashing first makes the lengths equal. */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
```

`src/app/api/cron/treasury/route.ts`:

```ts
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
```

- [ ] **Step 4: Run the cron tests to see them pass**

Run: `npx vitest run src/lib/cron`
Expected: PASS.

- [ ] **Step 5: Add the strings and the recurring page**

Add to `src/i18n/en.ts` (`recurring.history` already exists from Task 11):

```ts
  "recurring.title": "Invoices from {name}",
  "recurring.allPaid": "Every invoice so far is paid. Thank you!",
  "recurring.period": "Period from {date}",
  "recurring.paidOn": "Paid on {date}",
  "recurring.none": "No invoices have been issued yet.",
```

`src/app/r/[slug]/page.tsx`:

```tsx
import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { InvoiceStatusChip } from "@/components/status-chip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/invoices/dates";
import { resolveRecurringLink } from "@/lib/invoices/repo";
import { formatMoney } from "@/lib/money/format";

export const metadata: Metadata = { title: `${t("pay.title")} · ${t("app.name")}`, robots: { index: false, follow: false } };

export default function RecurringPage(props: PageProps<"/r/[slug]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <p className="text-sm font-semibold text-primary">{t("app.name")}</p>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Recurring params={props.params} />
      </Suspense>
    </main>
  );
}

async function Recurring({ params }: { params: PageProps<"/r/[slug]">["params"] }) {
  const { slug } = await params;
  const link = await resolveRecurringLink(getDb(), slug);
  if (!link) notFound();
  // Spec §9.1: the stable link always opens the current period's invoice.
  if (link.kind === "open") redirect(`/pay/${link.invoiceSlug}`);

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("recurring.title", { name: link.freelancerName ?? t("app.name") })}</h1>
      <p className="text-muted-foreground">{link.description}</p>
      {link.paid.length === 0 ? (
        <p>{t("recurring.none")}</p>
      ) : (
        <>
          <p role="status" className="flex items-center gap-2 font-medium text-success">
            <CircleCheck aria-hidden="true" className="size-5" />
            {t("recurring.allPaid")}
          </p>
          <ul className="flex flex-col gap-3">
            {link.paid.map((period) => (
              <li key={period.slug}>
                <Card>
                  <CardContent className="flex items-start justify-between gap-4">
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">
                        {period.periodStart ? t("recurring.period", { date: formatDate(period.periodStart) }) : link.clientName}
                      </span>
                      {period.paidAt && (
                        <span className="text-sm text-muted-foreground">{t("recurring.paidOn", { date: formatDate(period.paidAt) })}</span>
                      )}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{formatMoney(period.amount, period.currency)}</span>
                      <InvoiceStatusChip status="paid" />
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 6: Add the GitHub Actions workflow**

`.github/workflows/treasury-cron.yml`:

```yaml
name: Treasury cron

# Vercel Hobby crons run once a day, so GitHub Actions calls the route every 10 minutes (spec §7.1).
# Scheduled workflows run only from the default branch (main).
on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch:

permissions: {}

jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Call the cron route
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          APP_URL: ${{ vars.APP_URL || 'https://cobro-agent.vercel.app' }}
        run: |
          curl --fail-with-body --silent --show-error --max-time 120 \
            -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
            "${APP_URL}/api/cron/treasury"
```

- [ ] **Step 7: Verify locally**

Run: `npm test && npm run typecheck && npm run lint && npm run build`, then `npm run dev` and:

```bash
curl -s -X POST http://localhost:3000/api/cron/treasury
curl -s -X POST -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" http://localhost:3000/api/cron/treasury
```

Expected: `{"error":"unauthorized"}`, then `{"issued":0}` (or a positive count if a weekly test invoice is due). In the browser, the `/r/<slug>` link of a weekly invoice from Task 9 lands on its `/pay/<slug>`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/cron src/app/api/cron src/app/r .github/workflows/treasury-cron.yml src/i18n/en.ts
git commit -m "feat(recurring): stable recurring link and a 10-minute cron that issues due periods

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Deploy and pay real invoices on mainnet (user-assisted)

**Files:**
- Create: `docs/superpowers/smoke/2026-10-payments.md`
- Modify: `docs/superpowers/specs/2026-10-08-cobro-design.md` (§8.2, §11, §14)

**Interfaces:**
- Consumes: everything above, deployed.
- Produces: the week-2 proof from spec §14: real invoices paid on mainnet (one in USA₮, one in wARS), recorded with their settlement transactions.

- [ ] **Step 1: Para environment and portal (user decision)**

Ask the user, and wait for the answer:

> Treasury wallets live in one Para environment and cannot move to another. BETA is where the spike ran. Should Cobro's real users get their treasury wallets in Para **PROD** (needs a PROD API key pair from developer.getpara.com) or stay on **BETA** for the hackathon?

Recommend PROD if the user's Para plan offers it without cost, because client money will sit in these wallets; otherwise BETA with small balances, recorded as a risk in the spec §15. Then, in the Para Developer Portal for the chosen environment, the user:
1. Adds `https://cobro-agent.vercel.app` and `http://localhost:3000` as allowed origins.
2. Enables email sign-in only, and sets the app name "Cobro" and the logo `public/cobro-mark.svg`.
3. Copies the secret key (`PARA_API_KEY`) and the public key (`NEXT_PUBLIC_PARA_API_KEY`). For PROD also set `PARA_REST_BASE_URL=https://api.getpara.com`, `PARA_JWKS_URL=https://api.getpara.com/.well-known/jwks.json` and `NEXT_PUBLIC_PARA_ENVIRONMENT=PROD`.

- [ ] **Step 2: Production environment variables (user-assisted)**

The user opens Vercel → `cobro-agent` → Settings → Environment Variables and sets, for Production and Preview: `SESSION_SECRET`, `X402_API_KEY`, `CRON_SECRET`, `PARA_API_KEY`, `PARA_REST_BASE_URL`, `PARA_JWKS_URL`, `NEXT_PUBLIC_PARA_API_KEY`, `NEXT_PUBLIC_PARA_ENVIRONMENT`. `DATABASE_URL` is already there from the Neon integration (Task 1). Values come from `.env.local` (the same secrets) or Step 1. Then:

```bash
gh secret set CRON_SECRET   # paste the same CRON_SECRET value when prompted
```

- [ ] **Step 3: Finish the branch and deploy**

Run the full suite first:

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all pass. Then use superpowers:finishing-a-development-branch. The smoke tests below need the code on production (Para's allowed origin and `NEXT_PUBLIC_APP_URL` are the production domain), so the expected choice is to merge into `main` and push; the user confirms that choice. After the push, wait for the Vercel production deployment to finish (Vercel dashboard → Deployments → Ready), then run `npm run db:migrate` once more (it is a no-op unless new migrations exist).

- [ ] **Step 4: Check the cron in production**

Run: `gh workflow run treasury-cron.yml && sleep 30 && gh run list --workflow treasury-cron.yml --limit 1`
Expected: the latest run's conclusion is `success`. In its log the response is `{"issued":0}`.

- [ ] **Step 5: Smoke A, USA₮ (user-assisted, about $1)**

The user needs a browser wallet (MetaMask or Rabby) on Celo with at least 1.10 USA₮ and no CELO requirement. Ask how they want to fund it. If no USA₮ is available, run this smoke with USD₮ and repeat it with USA₮ once Plan 3 can swap.

1. On `https://cobro-agent.vercel.app`, sign in with a fresh email, finish onboarding (ARS, reserve 0), create **1.00 USD**, "Just once".
2. Open the payment link in the browser with the wallet. Choose "US dollar (USA₮)", connect, check "1.00 USA₮" and "No network fee", press Pay, sign once.
3. Expected: "Payment complete" with a Celoscan link. On Celoscan the transaction moves 1 USA₮ from the payer to the freelancer's treasury address and is sent by the facilitator (`0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48`). The freelancer's invoice page shows "Paid" and the payment under "Details".
4. Re-open the payment link: "This invoice has been paid". Calling `curl -s "https://cobro-agent.vercel.app/api/pay/<slug>?asset=USAT"` returns `{"error":"closed","status":"paid"}`.

- [ ] **Step 6: Smoke B, wARS through Permit2 (user-assisted, about $0.65)**

The payer wallet needs at least 1,050 wARS. Create **1000 ARS**, "Just once". Pay with "Argentine peso (wARS)". On the first wARS payment from a wallet the wallet asks for two signatures (an EIP-2612 permit for Permit2, then the payment); neither costs gas.

Expected: "Payment complete"; Celoscan shows 1,000 wARS to the treasury address. If the facilitator answers `412 permit2_allowance_required`, the `eip2612GasSponsoring` declaration did not reach it: capture the 402 body from the browser's network tab, stop, and report it.

- [ ] **Step 7: Smoke C, recurring and double payment**

1. Create **1.00 USD** "Every week". Open its `/r/<slug>` link: it lands on the first period's payment page.
2. Open that payment page in two tabs, choose USD₮ or USA₮ in both, and press Pay in both within a few seconds. Expected: one shows "Payment complete"; the other shows "Another payment for this invoice is being confirmed…" or "This invoice is no longer open", and the wallet's balance dropped once. (Only the first signature is settled; the second authorization is never used.)
3. Open `/r/<slug>` again: "Every invoice so far is paid" with that period listed.

- [ ] **Step 8: Record the results**

`docs/superpowers/smoke/2026-10-payments.md`:

```markdown
# Mainnet payment smoke tests

Date: <date> · App: https://cobro-agent.vercel.app · Para environment: <BETA|PROD> · Facilitator signer: 0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48

| Smoke | Invoice | Paid with | Amount | Settlement tx | Result |
|---|---|---|---|---|---|
| A | 1.00 USD | USA₮ | 1.00 USA₮ | <celoscan link> | <PASS/FAIL + note> |
| B | 1,000 ARS | wARS (Permit2 + EIP-2612) | 1,000 wARS | <celoscan link> | <PASS/FAIL + note> |
| C | 1.00 USD weekly | <token> | <amount> | <celoscan link> | <PASS/FAIL; second tab's message> |

Notes:
- Settlement transactions are sent by Celo's facilitator and carry no attribution tag (spec §15 question 1).
- <anything that needed a fix, with the commit>
```

- [ ] **Step 9: Update the spec**

In `docs/superpowers/specs/2026-10-08-cobro-design.md`:
- §8.2: add "Facilitator `/supported` (checked 2026-10-08) lists `exact` on `eip155:42220` for USDC, USDT, USAT, wARS, wBRL, wCOP and only the `eip2612GasSponsoring` extension. `@x402/extensions` 2.28 has a `builder-code` (ERC-8021) extension for settlement calldata; Celo's facilitator does not list it yet, which is what question 1 in §15 is about."
- §11: add `users.display_name`, `treasury_wallets.status`, `recurring_invoices.anchor_day`, invoice status `settling` with `settling_until`, and one sentence each on why (from this plan's introduction).
- §14: mark week 2 done, linking `docs/superpowers/smoke/2026-10-payments.md`.

- [ ] **Step 10: Commit and push**

```bash
git add docs/superpowers/smoke docs/superpowers/specs/2026-10-08-cobro-design.md
git commit -m "docs: record mainnet payment smoke tests and Plan 2 spec updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Report to the user: the three settlement transaction links, the Para environment in use, and anything that failed.
