# USD Home Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a freelancer choose US dollars as their home currency at onboarding (pre-selected) and switch it in Settings; for them the agent only converts wARS/wBRL into USD₮.

**Architecture:** A `HomeCurrency` type (`USD | ARS | BRL`) replaces `LocalCurrency` wherever "what the freelancer lives in" is meant; `LocalCurrency` keeps meaning "has a spending token". The engine, approvals, treasury view and display each get a small USD branch. Migration 0007 adds `USD` to the `local_currency` enum. Settings gains a currency switch that cancels proposals and logs an event.

**Tech Stack:** Next.js 16.4 App Router (`cacheComponents`), Drizzle + Neon/PGlite, Vitest (node), viem.

**Spec:** `docs/superpowers/specs/2026-10-22-usd-home-currency-design.md`

## Global Constraints

- USD is listed first and pre-selected at onboarding; with USD the reserve field is hidden and `reserveAmount` is stored as `"0"`.
- For home USD the engine only converts wARS → USD₮ or wBRL → USD₮ (reason `save_other`); USA₮/USD₮ untouched; never buys a local currency.
- For home USD conversions never need approval, whatever `approvalMode` is stored (the mode is kept).
- Switching home currency: cancels open proposals, logs event `home_currency_changed` with `{ from, to }`; switching to USD stores reserve `"0"`; switching to ARS/BRL requires a reserve.
- USD figures for a USD freelancer show alone (no "≈"); ARS/BRL invoices show billed amount first, "≈ US$…" second.
- Existing ARS/BRL behaviour unchanged (all existing tests stay green unmodified except type-only fixture edits).
- Migration 0007 on Neon dev, then Neon **main before the deploy** (user provides `.env.main`; delete afterwards).
- CLAUDE.md: `t()` for every string, `formatMoney`/`displayAmount`, `TOKENS` only, Suspense around request data, one primary button, ask before mainnet transactions and production DB writes.
- Gate: `npm test && npm run typecheck && npm run lint && npm run build`.

## Review Focus

- USD freelancer holding both wARS and wBRL ≥ $1: one conversion per run, wARS first, wBRL next run → test in Task 2.
- USD freelancer with wARS worth under $1: no RFQ, idle with a USD-specific explanation → tests in Task 2 and Task 4.
- USD freelancer whose stored approval mode is `all`: conversion still runs without a proposal → test in Task 2.
- Switch to USD while the form posts a reserve value: reserve stored as `"0"` → test in Task 5.
- Switch with an open proposal waiting: proposal cancelled, event logged → test in Task 5.

---

### Task 1: Home currency type, migration 0007, USD display

**Files:**
- Modify: `src/lib/money/currencies.ts`, `src/lib/db/schema.ts` (enum `local_currency` gains `USD`), `src/lib/money/display.ts`, `src/lib/users/queries.ts` (`AppUser.localCurrency: HomeCurrency | null`)
- Create: `drizzle/0007_*.sql` via `npm run db:generate`
- Test: `src/lib/money/display.test.ts`

**Interfaces:**
- Produces: `export const HOME_CURRENCIES = ["USD", "ARS", "BRL"] as const; export type HomeCurrency = (typeof HOME_CURRENCIES)[number]; export function isHomeCurrency(v: unknown): v is HomeCurrency`.
- `displayAmount(amount, currency, local: HomeCurrency | null, rates, lead?)` — same signature, wider `local`.
- `rules.localCurrency` column type becomes `HomeCurrency`.

- [ ] **Step 1: Failing tests** in `display.test.ts` (`describe("USD home")`), rates `{ perUsd: { ARS: 1600n * 10n ** 18n, BRL: 5n * 10n ** 18n }, fetchedAt: 0 }`:
  - `displayAmount("12.50", "USD", "USD", rates)` → `{ primary: "US$12.50" }` (no secondary); same with lead `"billed"`.
  - `displayAmount("1600.00", "ARS", "USD", rates, "billed")` → primary `"ARS 1,600"`, secondary `"≈ US$1.00"` (match the existing ARS formatting in this file's other tests).
  - `displayAmount("1600.00", "ARS", "USD", rates)` (lead local) → primary `"US$1.00"`, secondary `"ARS 1,600"`.
- [ ] **Step 2: Run** `npx vitest run src/lib/money` — Expected: the USD+USD cases FAIL (duplicate "≈ US$" secondary).
- [ ] **Step 3: Implement** the types; in `displayAmount` return `{ primary: formatMoney(amount, "USD") }` when `local === "USD" && currency === "USD"`; widen `local`. Add `USD` to the enum in `schema.ts`, run `npm run db:generate`, check the SQL is a single `ALTER TYPE "public"."local_currency" ADD VALUE 'USD'` (order inside the enum does not matter). Widen `AppUser.localCurrency`; fix type errors by widening parameters to `HomeCurrency` where the value is only displayed (`explain.ts` `ExplainContext.local`, `withdraw/options.ts`, `summary-cards.tsx`), and by narrowing with `isLocalCurrency` where a spending token is needed (`proposalTarget` in `explain.ts`: hub_route target only for a local currency).
- [ ] **Step 4: Run** `npx vitest run src/lib/money && npm run typecheck` — Expected: PASS, no type errors (engine/view errors are expected only if those files are touched; if `typecheck` reports them, apply Task 2/4 signatures first — they are listed there).
- [ ] **Step 5: Apply** migration to Neon dev: `npm run db:migrate` — Expected: "Migrations applied".
- [ ] **Step 6: Commit** `feat(currency): USD home currency type, enum value and display`.

### Task 2: Engine and approvals for home USD

**Files:**
- Modify: `src/lib/treasury/engine.ts` (`EngineRules.localCurrency: HomeCurrency`), `src/lib/treasury/executor.ts` (`approvalFor`)
- Test: `src/lib/treasury/engine.test.ts`, `src/lib/treasury/executor.test.ts` (or the file that already tests `approvalFor`/needs-approval paths)

**Interfaces:**
- Consumes: `HomeCurrency` (Task 1).
- Produces: `decide(input)` USD branch; `approvalFor` grants without approval when `ctx.rules.localCurrency === "USD"`.

- [ ] **Step 1: Failing tests** (`describe("home USD")` in `engine.test.ts`, using the file's existing input builder with `localCurrency: "USD"`, `reserveAmount: "0"`):
  - wARS worth $3 → `{ kind: "convert", from: "WARS", to: "USDT", reason: "save_other" }`.
  - wBRL worth $3, no wARS → from `"WBRL"`, to `"USDT"`, `save_other`.
  - both wARS and wBRL ≥ $1 → from `"WARS"` (one per run).
  - wARS worth $0.99 → `{ kind: "none", reason: "below_minimum" }`.
  - only USD₮ $50 and USA₮ $50 → `{ kind: "none", reason: "within_band" }`.
  - wARS worth $80 with `perTradeMaxUsd: 50` → `usdWad` ≈ $50 (capped, as the existing cap test asserts).
  - In the executor test file: a home-USD user with `approvalMode: "all"` and wARS ≥ $1 → the run creates no proposal and proceeds to an RFQ (assert the same observable the existing "auto mode" test asserts).
- [ ] **Step 2: Run** `npx vitest run src/lib/treasury` — Expected: new tests FAIL.
- [ ] **Step 3: Implement**: at the top of `decide`, when `rules.localCurrency === "USD"`, return `sized("WARS","USDT",balances.WARS,"save_other")` if wARS ≥ $1, else the same for wBRL, else `none("within_band")` — reuse `sized` so caps and the $1 minimum apply (wARS under $1 with nothing else → `below_minimum` from `sized`). In `approvalFor`, before reading `mode`, return `{ kind: "granted", cap: null, save: {}, approved: false }` for home USD.
- [ ] **Step 4: Run** `npx vitest run src/lib/treasury` — Expected: PASS (all existing treasury tests unchanged).
- [ ] **Step 5: Commit** `feat(treasury): home USD agent converts wARS/wBRL to USD₮ without asking`.

### Task 3: Onboarding with USD

**Files:**
- Modify: `src/lib/users/onboarding.ts`, `src/app/app/onboarding/onboarding-form.tsx`, `src/i18n/en.ts`
- Test: `src/lib/users/onboarding.test.ts`

**Interfaces:**
- Produces: `OnboardingInput.localCurrency: HomeCurrency`; `parseOnboardingForm` accepts `"USD"` and returns `reserveAmount: "0"` for USD whatever was posted.

- [ ] **Step 1: Failing tests**: `parseOnboardingForm({ displayName: "Ana", localCurrency: "USD", reserveAmount: "5000" })` → `{ ok: true, data: { displayName: "Ana", localCurrency: "USD", reserveAmount: "0" } }`; `localCurrency: "EUR"` → error `onboarding.error.currency`; `saveOnboarding` with USD stores `rules.localCurrency = "USD"`, `reserveAmount = "0"` (PGlite).
- [ ] **Step 2: Run** `npx vitest run src/lib/users` — Expected: FAIL.
- [ ] **Step 3: Implement** parse/save with `isHomeCurrency`. Form: three radio cards in the order USD, ARS, BRL, `useState<HomeCurrency>` defaulting to `"USD"` (or the posted value after an error); the reserve `FormField` and the "asks you before using dollars" line render only for ARS/BRL. New key `onboarding.currency.USD` "US dollars (USD)" (match the existing ARS/BRL label keys) and `onboarding.usdHelp` "Your agent keeps everything in dollars. If a client pays in pesos or reais, it converts them to dollars for you."
- [ ] **Step 4: Run** `npx vitest run src/lib/users && npm run typecheck && npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(onboarding): US dollars as the pre-selected home currency`.

### Task 4: Treasury view, Home money card, Agent page for USD

**Files:**
- Modify: `src/lib/treasury/view.ts`, `src/app/app/treasury-summary.tsx`, `src/app/app/rules/page.tsx`, `src/lib/treasury/explain.ts`, `src/i18n/en.ts`
- Test: `src/lib/treasury/view.test.ts`, `src/lib/treasury/explain.test.ts`

**Interfaces:**
- Consumes: `HomeCurrency`, engine USD branch (Task 2).
- Produces: `TreasuryView.local: HomeCurrency`; new field `waitingUsd: string` (wARS+wBRL valued in USD for home USD, `"0"` otherwise). For home USD: `spending: "0"`, `reserve: "0"`, `reservePercent: null`, `protectedUsd: "0"`, `protectedNegative: false`, `savingsUsd` = USD₮+USA₮.

- [ ] **Step 1: Failing tests**: `buildTreasuryView` with `rules: { localCurrency: "USD", reserveAmount: "0" }`, balances USDT 10, USAT 5, wARS 1600 (rate 1600) → `savingsUsd: "15.00"` (match existing string format), `waitingUsd: "1.00"`, `reservePercent: null`, `protectedUsd: "0"`; `describeDecision({ kind: "none", reason: "within_band" }, { local: "USD", rates })` → `t("preview.usd_idle")`.
- [ ] **Step 2: Run** `npx vitest run src/lib/treasury` — Expected: FAIL.
- [ ] **Step 3: Implement**: USD branch in `buildTreasuryView` (skip `LOCAL_ASSET`, P&L); `describeDecision` uses `preview.usd_idle` ("Nothing to convert: everything you hold is in dollars.") for home USD idle `within_band`. Money card for USD: total figure, one pocket row "Dollars" (`CurrencyBadge` USD, `savingsUsd`), and a "Waiting to convert" row (`treasury.waiting`) only when `waitingUsd` > 0. `ProtectedCard` returns null for USD. Rules page for USD: keep status and the Preview, replace the rules form card with a card holding `rules.usdExplain` ("Your agent converts any pesos or reais you receive into dollars. To keep a spending reserve in pesos or reais, change your currency in Settings.") and a link to `/app/settings`.
- [ ] **Step 4: Run** `npx vitest run src/lib/treasury && npm run typecheck && npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(treasury): dollars-only view, money card and Agent page for home USD`.

### Task 5: Change home currency in Settings

**Files:**
- Create: `src/lib/users/home-currency.ts`, `src/lib/users/home-currency.test.ts`, `src/app/app/settings/currency-form.tsx`, `src/app/app/settings/currency-actions.ts`
- Modify: `src/app/app/settings/page.tsx`, `src/lib/db/schema.ts` (`AGENT_EVENT_TYPES` gains `"home_currency_changed"`), `src/lib/dashboard/recent.ts` (`HIDE_WHY_EVENTS` includes it), `src/lib/treasury/explain.ts`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `HomeCurrency`, `cancelProposals(db, userId, now)`, `logEvent(db, userId, type, data, now)`, `parseFiatInput`.
- Produces:
  - `parseHomeCurrencyForm(fields): FormResult<{ home: HomeCurrency; reserveAmount: string }, "home" | "reserveAmount">` — USD → reserve `"0"`; ARS/BRL → reserve required (empty → `money.error.required`).
  - `changeHomeCurrency(db, userId, input, now): Promise<{ changed: boolean }>` — in one transaction: update `rules.localCurrency`, `reserveAmount`, `updatedAt`; if the currency differs: `cancelProposals`, `logEvent(…, "home_currency_changed", { from, to })`; same currency → only the reserve changes, `changed: false`.
  - `switchConsequences(to: HomeCurrency, balances: TreasuryBalances, rates: ReferenceRates | null): { converts: { asset: "WARS" | "WBRL"; amount: string; currency: FiatCurrency }[] }` — the wARS/wBRL balances (≥ $1) that are not `to`'s spending token.

- [ ] **Step 1: Failing tests** (PGlite for the DB ones):
  - parse: `{ home: "USD", reserveAmount: "9000" }` → reserve `"0"`; `{ home: "BRL", reserveAmount: "" }` → error on `reserveAmount`; `{ home: "XYZ" }` → error on `home`.
  - `changeHomeCurrency` ARS → USD with an open proposal seeded (use the helper the approvals tests use) → rules USD/"0", proposal status `cancelled`, one `home_currency_changed` event `{ from: "ARS", to: "USD" }`, `changed: true`.
  - ARS → ARS with a new reserve → reserve updated, no event, `changed: false`.
  - `switchConsequences("USD", { WARS: 3200 ARS, WBRL: 0.5 BRL … })` with rates ARS 1600, BRL 5 → one entry WARS (wBRL $0.10 is under $1); `switchConsequences("ARS", { WARS: 3200, WBRL: 20 BRL })` → one entry WBRL.
- [ ] **Step 2: Run** `npx vitest run src/lib/users` — Expected: FAIL.
- [ ] **Step 3: Implement** the lib functions; server action `changeHomeCurrencyAction(prev, formData)` (requireUser with onboarding done, parse, change, `refresh()`); `CurrencyForm` (client): three radio cards, reserve field for ARS/BRL, a "Change currency" secondary button that first shows an inline confirmation (same pattern as `invoice-controls.tsx`) listing `switchConsequences` lines ("{amount} will be converted to dollars by your agent within 20 minutes. Withdraw it first to keep it.") and, for ARS/BRL, "Your agent will buy {currency} up to your reserve, asking first if you chose that." The page computes `switchConsequences` server-side for each choice (live balances, as the money card does) and passes them in. Explain: `event.home_currency_changed.title` "You changed your currency to {to}".
- [ ] **Step 4: Run** `npx vitest run src/lib/users src/lib/treasury && npm run typecheck && npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): change home currency with a confirmed warning`.

### Task 6: Verification and release

- [ ] **Step 1:** Localhost (Neon dev, dev sample user): onboarding with USD for a new dev user (or switch the sample user in Settings), screenshots at 390/1440 of Home, Agent, Settings switch confirmation, an ARS invoice row ("ARS 1,200 ≈ US$…"). Switch back to ARS and confirm the reserve field and form return.
- [ ] **Step 2:** Full gate — Expected: all pass.
- [ ] **Step 3:** Ask the user for `.env.main`, apply migration 0007 to Neon main (`NODE_OPTIONS=--dns-result-order=ipv4first npx tsx --env-file=.env.main scripts/db-migrate.ts`), verify the enum has `USD` (count query), delete `.env.main`.
- [ ] **Step 4:** Merge `--no-ff` into `main`, gate on the merge, push, wait for Vercel Ready, smoke landing and `/app` redirect.
