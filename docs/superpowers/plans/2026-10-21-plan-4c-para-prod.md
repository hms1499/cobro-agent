# Plan 4c: Para PROD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production (Vercel + Neon main) runs on Para PROD so real users can sign up; localhost and Neon dev stay on Para BETA; the old BETA users on Neon main are retired without losing their history.

**Architecture:** The Para environment (`NEXT_PUBLIC_PARA_ENVIRONMENT`) becomes the single switch: the REST base URL and JWKS URL are derived from it, and config parsing refuses keys whose prefix belongs to the other environment. A new `retired` treasury wallet status plus a one-off, dry-run-by-default script takes the BETA rows on Neon main out of every money path (cron, pay links, withdrawals) while keeping their rows, trades and transactions. The cutover itself is a runbook of approved operator steps.

**Tech Stack:** Next.js 16.4, zod, Drizzle + Neon Postgres (PGlite in tests), `@getpara/react-sdk`, Vercel CLI, viem.

**Spec:** `docs/superpowers/specs/2026-10-20-plan-4-real-mvp-design.md` §6 (binding); main spec `docs/superpowers/specs/2026-10-08-cobro-design.md` §8.4, §15.

**Step 1 of spec §6 is done (2026-10-21):** a live probe (`.superpowers/para-prod-probe.mts`, git-ignored) with the PROD secret key on the Free plan created a CUSTOM_ID wallet, found it by custom id, and signed EIP-712 typed data and an EIP-1559 transaction; both signers recovered to the wallet address. No card was asked for. One empty probe wallet `0x9cd0…616a` exists in PROD. PROD JWKS: `https://api.getpara.com/.well-known/jwks.json` (different key from BETA).

## Global Constraints

- PROD only while it is free **(user)**. If the Portal asks for billing or a paid plan, stop and ask the user.
- Para Free plan: 1,200 MAU, REST 30 requests/min per key. Do not add REST calls to hot paths.
- Key prefixes (checked 2026-10-21): BETA secret `sk_beta_`, BETA public `beta_`; PROD secret `sk_prod_`, PROD public `prod_`.
- Endpoints: BETA `https://api.beta.getpara.com`, PROD `https://api.getpara.com`; JWKS at `<base>/.well-known/jwks.json`.
- PROD keys sit locally in `.env.para-prod.local` (`PARA_PROD_API_KEY`, `NEXT_PUBLIC_PARA_PROD_API_KEY`) until they are on Vercel. Never print a value; print names, lengths, prefixes up to 5 characters or booleans.
- Secrets go to Vercel through stdin only (`vercel env add NAME production`).
- Every mainnet transaction and every write to Neon main needs the user's explicit yes first. Deletes are out of scope: nothing is deleted from Neon main.
- Para IP Allowlist stays off (Vercel egress IPs change).
- Everything in CLAUDE.md: Suspense rules, money as bigint, `t()` for every string, MASTER.md, one branch per plan (`plan-4c-para-prod`), full gate `npm test && npm run typecheck && npm run lint && npm run build` before claiming done.

## Review Focus

- A PROD public key with a BETA secret key (or any cross-environment mix) on Vercel → the app refuses to start that request with an error naming the variable, never a silent 401 at wallet creation. Pinned in Task 1.
- An old invoice link of a retired BETA user is opened after the switch → the page cannot take a payment (no `payTo`), so no client sends money to a wallet nobody can sign for. Pinned in Task 3.
- The retire script is run again after real PROD users exist → it only touches rows created before the cutoff it is given. Pinned in Task 3.
- Retiring while an invoice is `settling` or a treasury transaction is `pending` → the script refuses to write and names the blocker. Pinned in Task 3.
- A browser that still holds an old BETA session cookie after the switch → it lands on `/signin` (rotated `SESSION_SECRET`, existing `/api/session/reset`), not an old dashboard and not a redirect loop. Checked by hand in Task 5 Step 7.

---

### Task 0: Read-only inventory of production (operator, no commit)

Tells the user which BETA wallets hold money and what the retire step will touch. Nothing is written.

**Files:**
- Create (git-ignored): `.env.main`, `.superpowers/prod-inventory.mts`

- [ ] **Step 1: Pull production env into `.env.main`**

Run: `vercel env pull .env.main --environment=production --yes`
Expected: file written; `git check-ignore .env.main` prints the path. Print only variable names: `cut -d= -f1 .env.main`.

- [ ] **Step 2: Write `.superpowers/prod-inventory.mts`**

Read-only SELECTs on the `DATABASE_URL` from `.env.main` (pattern: `.superpowers/personal-wallets.mts`) and on-chain balances (pattern: `.superpowers/balances.mts`, all `TOKENS` plus CELO). Print, with emails masked as `a…@domain`:
- per user: created date, `personal_wallet`, treasury `status`, treasury address, `rules.enabled`;
- balances of every treasury address and every personal wallet;
- counts: invoices by status, active `recurring_invoices`, `fx_intents` in `proposed|waiting|executing`, `treasury_txs` with status `pending`, saved `withdrawal_addresses` not removed.

- [ ] **Step 3: Run it and report to the user**

Run: `npx tsx --env-file=.env.main .superpowers/prod-inventory.mts`
Expected: the table above. Give the user the list of funded addresses; Task 5 Step 2 moves those funds.

---

### Task 1: The Para environment drives endpoints and key checks

**Files:**
- Modify: `src/lib/config/server.ts` (schema lines 29–34), `src/lib/config/public.ts`, `.env.example`
- Test: `src/lib/config/config.test.ts`

**Interfaces:**
- Produces: `parseServerEnv()` still returns `PARA_REST_BASE_URL` and `PARA_JWKS_URL` (callers in `src/lib/users/para.ts` and `src/lib/auth/warm.ts` do not change), now derived from `NEXT_PUBLIC_PARA_ENVIRONMENT`, which the server schema also reads (`"BETA" | "PROD"`, default `"BETA"`). The input variables `PARA_REST_BASE_URL` and `PARA_JWKS_URL` are no longer read.
- Produces: `export const PARA_ENDPOINTS: Record<"BETA" | "PROD", { restBaseUrl: string; jwksUrl: string }>` in `src/lib/config/server.ts`.

- [ ] **Step 1: Write the failing tests** in `config.test.ts` (update the two existing default assertions at lines 47–48 to stay BETA):

```ts
it("derives PROD endpoints from the Para environment", () => {
  const env = parseServerEnv({ NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD" });
  expect(env.PARA_REST_BASE_URL).toBe("https://api.getpara.com");
  expect(env.PARA_JWKS_URL).toBe("https://api.getpara.com/.well-known/jwks.json");
});
it("ignores a stale endpoint variable", () => {
  const env = parseServerEnv({ NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", PARA_REST_BASE_URL: "https://api.beta.getpara.com" });
  expect(env.PARA_REST_BASE_URL).toBe("https://api.getpara.com");
});
it("refuses a secret key from the other Para environment", () => {
  expect(() => parseServerEnv({ NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", PARA_API_KEY: "sk_beta_abc" })).toThrow(/PARA_API_KEY.*PROD/);
  expect(() => parseServerEnv({ PARA_API_KEY: "sk_prod_abc" })).toThrow(/PARA_API_KEY.*BETA/);
  expect(parseServerEnv({ NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", PARA_API_KEY: "sk_prod_abc" }).PARA_API_KEY).toBe("sk_prod_abc");
});
it("refuses a public key from the other Para environment", () => {
  expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", NEXT_PUBLIC_PARA_API_KEY: "beta_abc" })).toThrow(/NEXT_PUBLIC_PARA_API_KEY.*PROD/);
  expect(parsePublicEnv({ ...validPublic, NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", NEXT_PUBLIC_PARA_API_KEY: "prod_abc" }).NEXT_PUBLIC_PARA_API_KEY).toBe("prod_abc");
});
```

Search the repo for other tests that pass a `PARA_API_KEY` or `NEXT_PUBLIC_PARA_API_KEY` to the parsers (`grep -rn "PARA_API_KEY" src scripts --include=*.test.ts`) and give them a `sk_beta_`/`beta_` value.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/config`
Expected: the four new tests FAIL.

- [ ] **Step 3: Implement**

Server schema: add `NEXT_PUBLIC_PARA_ENVIRONMENT` (same enum and default as `public.ts`), drop the two URL fields from the input schema, then `.superRefine` the key prefix (`sk_beta_` / `sk_prod_`; error message names the variable and the expected environment, never the value) and `.transform` to add `PARA_REST_BASE_URL` / `PARA_JWKS_URL` from `PARA_ENDPOINTS`. Public schema: the same prefix check for `NEXT_PUBLIC_PARA_API_KEY` (`beta_` / `prod_`). An unset key stays allowed (local scripts and tests). Check that `parseOrThrow` still reports refinement issues by variable name. `.env.example`: remove `PARA_REST_BASE_URL` and `PARA_JWKS_URL`, add a comment that `NEXT_PUBLIC_PARA_ENVIRONMENT` picks the endpoints and that both keys must come from that environment.

- [ ] **Step 4: Run to verify they pass, then the full suite**

Run: `npx vitest run src/lib/config && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config .env.example
git commit -m "feat(config): derive Para endpoints from the environment and refuse cross-environment keys"
```

---

### Task 2: Upgrade the Para SDK to the latest release

The PROD checklist requires the latest SDK. Installed 3.21.0; latest 3.23.0 (published 2026-10-16).

**Files:**
- Modify: `package.json`, `package-lock.json`; `src/components/providers/para-provider.tsx` only if 3.22/3.23 deprecate something it uses.

- [ ] **Step 1: Read the release notes for 3.22.0 and 3.23.0** (`npm view @getpara/react-sdk@3.23.0`, the package's CHANGELOG in `node_modules` after install, or GitHub releases). Note any deprecation that touches `ParaProvider`, `paraClientConfig`, `Environment`, the modal, or `styles.css`.

- [ ] **Step 2: Install**

Run: `npm install @getpara/react-sdk@3.23.0`
Expected: `postinstall` (`npx setup-para`) succeeds; `package.json` shows `^3.23.0`.

- [ ] **Step 3: Full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all exit 0, no new deprecation warnings from Para in the build log.

- [ ] **Step 4: Sign-in smoke on localhost (BETA) with the user**

Run `npm run dev`; the user signs in on `http://localhost:3000/signin` with an existing BETA test email. Expected: OTP modal opens, dashboard loads, "My wallet" in Settings opens the Para modal, fonts and border colours unchanged (CSS import order in `layout.tsx`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/providers/para-provider.tsx
git commit -m "chore: upgrade @getpara/react-sdk to 3.23.0"
```

---

### Task 3: Retired treasury wallets and the retire script

**Files:**
- Modify: `src/lib/db/schema.ts:25` (add `"retired"` to `walletStatus`), `src/lib/users/queries.ts` (map `retired` to `"failed"` in `loadAppUser`; old users cannot sign in after the switch, this only keeps the type closed)
- Create: `drizzle/0005_*.sql` (generated), `scripts/lib/retire-para-beta.ts`, `scripts/retire-para-beta.ts`
- Test: `scripts/lib/retire-para-beta.test.ts`

**Interfaces:**
- Consumes: `createTestDb()` from `src/lib/db/testing.ts`; `findPublicInvoice` (`src/lib/invoices/repo.ts`), `listTreasuryUsers` (`src/lib/treasury/repo.ts`).
- Produces:

```ts
export interface RetireSummary {
  wallets: number;            // treasury_wallets set to "retired"
  rulesDisabled: number;      // rules.enabled true → false
  recurringStopped: number;   // recurring_invoices.active true → false
  invoicesCancelled: number;  // invoices "open" → "cancelled"
  blockers: string[];         // non-empty → nothing was written
}
export async function retireParaBetaData(
  db: Db,
  opts: { createdBefore: Date; apply: boolean },
): Promise<RetireSummary>;
```

Scope is every user whose `users.created_at < createdBefore`. Blockers (any one stops `apply`): an invoice of those users in `settling`; a `treasury_txs` row of their wallets in `pending`; an `fx_intents` row in `executing`. Writes run in one `db.transaction`. With `apply: false` it counts what it would change and writes nothing. Paid and cancelled invoices, trades, payments and transactions are never touched.

- [ ] **Step 1: Write the failing tests** (seed with the same helpers other DB tests use; user A created 2026-10-10, user B created 2026-10-22, cutoff 2026-10-21):

- `dry run counts and writes nothing`: A has a ready wallet, enabled rules, an active recurring template, one open and one paid invoice → summary `{ wallets: 1, rulesDisabled: 1, recurringStopped: 1, invoicesCancelled: 1, blockers: [] }`; A's wallet is still `ready`.
- `apply retires only users created before the cutoff`: after apply, A's wallet is `retired`, rules disabled, template inactive, open invoice `cancelled`, paid invoice still `paid`; every B row unchanged.
- `a retired user's pay link takes no payment`: after apply, `findPublicInvoice(db, aOpenSlug)` has `payTo === null`, and `listTreasuryUsers(db)` does not include A.
- `refuses while money is in flight`: A has a `settling` invoice → `apply` returns a blocker naming the invoice slug and A's wallet stays `ready`; same for a `pending` treasury tx.
- `apply is idempotent`: a second apply returns all zeros.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run scripts/lib/retire-para-beta.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Add the enum value and generate the migration**

Run: `npm run db:generate`
Expected: `drizzle/0005_*.sql` containing `ALTER TYPE "public"."wallet_status" ADD VALUE 'retired';`. Fix the `queries.ts` type error the new value causes.

- [ ] **Step 4: Implement `retireParaBetaData`** in `scripts/lib/retire-para-beta.ts`, and the CLI `scripts/retire-para-beta.ts`: arguments `--created-before=<ISO 8601>` (required) and `--apply` (optional; default is a dry run); prints the summary as JSON and the masked emails in scope; exits 1 on blockers. Connect like `scripts/db-migrate.ts`.

- [ ] **Step 5: Run to verify they pass, then the full gate**

Run: `npx vitest run scripts/lib && npm test && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Apply the migration to Neon dev**

Run: `npm run db:migrate`
Expected: `Migrations applied`. (Neon main gets it in Task 5 Step 3.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/users/queries.ts drizzle scripts/lib/retire-para-beta.ts scripts/lib/retire-para-beta.test.ts scripts/retire-para-beta.ts
git commit -m "feat(ops): retired treasury wallets and a dry-run-first script to retire Para BETA users"
```

---

### Task 4: Docs for the two-environment setup (on the branch)

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-10-08-cobro-design.md` §8.4 and §15, `docs/superpowers/specs/2026-10-20-plan-4-real-mvp-design.md` §6

- [ ] **Step 1: Edit**

- CLAUDE.md: replace the "Para runs in BETA for the hackathon (one key pair for localhost and production)" line with: production (Vercel + Neon main) uses Para PROD; localhost and Neon dev use Para BETA; `NEXT_PUBLIC_PARA_ENVIRONMENT` picks the endpoints and both keys must carry that environment's prefix; treasury wallets cannot move between Para environments.
- Main spec §8.4: add an "Environments" bullet with the same facts, the Free plan limits (1,200 MAU, 30 REST req/min) and the 2026-10-21 probe result. §15: mark the BETA risk resolved by Plan 4c and say how BETA rows were retired (`retired` status, nothing deleted).
- Plan 4 spec §6: mark step 1 done with the probe result.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs
git commit -m "docs: production on Para PROD, localhost on BETA"
```

---

### Task 5: Cutover runbook (operator + user, each write approved)

Run in this order on one sitting. Stop and ask on any surprise.

- [ ] **Step 1: Portal settings in PROD (user, in developer.getpara.com, PROD project)**

Email-only sign-in (phone off); app name Cobro, brand colour `#086288`, logo; Allowed Origins `https://cobro-agent.vercel.app`; IP Allowlist off. Stop if the Portal asks for billing.

- [ ] **Step 2: Move funds out of BETA wallets (user does each, asked before each)**

From the Task 0 list. Production still runs BETA here, so the user signs in on production and withdraws each funded treasury wallet to its personal wallet (no 24-hour wait for the own wallet), then sends from the personal BETA wallet (Settings → My wallet → Send) to a wallet the user keeps outside Para BETA. Check every transaction with `/celo-tx-check` (treasury withdrawals carry the tag `celo_bc3965e128ba`). Re-run the inventory: funded addresses show zero (gas dust is fine).

- [ ] **Step 3: Merge, migrate Neon main, deploy (still BETA)**

Merge `plan-4c-para-prod` into `main` with `--no-ff`; full gate on the merge. Apply 0005 to Neon main: `npx tsx --env-file=.env.main scripts/db-migrate.ts` (ask first). Push; wait for the Vercel deployment to be Ready; smoke `/`, `/signin` and the cron endpoint answer as before (endpoints derive to the same BETA URLs).

- [ ] **Step 4: Retire BETA data on Neon main (explicit yes required)**

Dry run: `npx tsx --env-file=.env.main scripts/retire-para-beta.ts --created-before=<now, ISO>`. Show the user the summary and the masked emails. Only after "yes": rerun with `--apply`. Keep the cutoff value in the progress ledger.

- [ ] **Step 5: Switch Vercel production env (stdin only), then redeploy**

For each of `PARA_API_KEY` (from `PARA_PROD_API_KEY`), `NEXT_PUBLIC_PARA_API_KEY` (from `NEXT_PUBLIC_PARA_PROD_API_KEY`), `NEXT_PUBLIC_PARA_ENVIRONMENT` (`PROD`), and `SESSION_SECRET` (new: `openssl rand -base64 48`): `vercel env rm NAME production --yes`, then pipe the value into `vercel env add NAME production` without echoing it, e.g. `grep '^PARA_PROD_API_KEY=' .env.para-prod.local | cut -d= -f2- | tr -d '\n' | vercel env add PARA_API_KEY production`. Remove `PARA_REST_BASE_URL` and `PARA_JWKS_URL` (no longer read). Verify with `vercel env ls production` (names only). Redeploy production with a fresh build (NEXT_PUBLIC values are inlined at build). Rotating `SESSION_SECRET` also voids unused emailed address codes; only retired users have any.

- [ ] **Step 6: Live checks (spec §6 step 7)**

1. The user signs up on `https://cobro-agent.vercel.app` with a new `+alias` email: the modal offers email only and shows Cobro branding; onboarding completes; the dashboard shows a ready treasury wallet. Confirm through REST (PROD key, `GET /v1/wallets?userIdentifier=para:<id>&userIdentifierType=CUSTOM_ID`) that the wallet lives in PROD.
2. Ask, then pay a small invoice (about US$1.10 in USD₮) from the user's payer wallet; `/celo-tx-check` the settlement.
3. The agent's next tick (cron-job.org, ≤ 20 min, or the GitHub workflow by hand after asking) handles the deposit; `/celo-tx-check` any approve/swap.
4. Ask, then withdraw to the new personal wallet; `/celo-tx-check` it (tag present).
5. Open production in a browser that still has an old session cookie: it ends on `/signin` without a loop.

- [ ] **Step 7: Clean up and record**

Ask the user, then delete `.env.main`, `.env.para-prod.local` (PROD secrets then live only in Vercel) and `.superpowers/para-prod-probe.mts`. Update the memory file for Plan 4 and the progress ledger with the cutoff, the transaction hashes and anything deferred. Next: Plan 4e (submission).
