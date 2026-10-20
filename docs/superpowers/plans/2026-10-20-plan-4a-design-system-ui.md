# Plan 4a: Design System and UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cobro easy to understand at a glance on desktop and mobile: the new palette and Notion-like motion in one tightened design system, a short dashboard (layout A, desktop A2), four tabs, an invoice list, and plain copy.

**Architecture:** Tokens change in `globals.css` only; components read tokens. Display rules live in `displayAmount` (one function, unit-tested). The dashboard's "Recent" list comes from a pure merge function (unit-tested); pages are Server Components inside `<Suspense>` as today. No schema change, no migration, no money-path change.

**Tech Stack:** Next.js 16.4 App Router (`cacheComponents: true`), React 19.3, Tailwind 4 + shadcn/ui tokens, Lucide, Vitest 5, Playwright MCP for screenshot review.

**Spec:** `docs/superpowers/specs/2026-10-20-plan-4-real-mvp-design.md` §4 (this plan covers §4 only; §5–§8 get their own plans: 4b address book, 4c Para PROD, 4d landing, 4e submission). Mockups: `docs/superpowers/specs/2026-10-20-plan-4-mockups/`.

## Global Constraints

- Use the `frontend-design` skill for every UI task; `design-system/cobro/MASTER.md` is the source of truth and is updated in Task 1.
- Palette (spec §4.5): primary `#086288` = `oklch(0.468 0.096 234.6)`; secondary `#4D8DBA` = `oklch(0.620 0.095 241.2)` (icons/borders/charts only, never body text); light tint `#97D7FF` = `oklch(0.850 0.086 236.6)` (backgrounds only; behind primary text use ≤ 35% opacity); warm accent `#FFEFC4` = `oklch(0.954 0.058 90.0)` (sparingly, never page background). Page background stays `#F8FAFC`, cards white. Success/warning/destructive unchanged.
- No raw hex in components; colours only through tokens.
- Motion (spec §4.5): hover tint `primary / 6%` ~20 ms ease-in on rows, nav items, icon buttons; active `primary / 12%`; buttons change background in 100 ms ease-in-out, darker on active; no scale or translate on press; popovers 120 ms ease-out (opacity, 4 px slide, 0.98 → 1); hover styles only under `@media (hover: hover)`; all instant under `prefers-reduced-motion: reduce`.
- Desktop and mobile alike: check at 375 / 768 / 1024 / 1440 px; sidebar ≥ 1024 px, bottom bar below.
- One primary button per screen; a setup or proposal banner takes the primary role from "New invoice" (existing rule in `src/app/app/page.tsx`).
- Every string through `t()` with keys in `src/i18n/en.ts`; every amount through `formatMoney` / `displayAmount`.
- CLAUDE.md rules: `cacheComponents` and Suspense, Para CSS import order in `layout.tsx`, `min-h-11` touch targets, `aria-hidden` on decorative icons, `role="alert"`/`aria-live` for status.
- Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md).
- Branch `plan-4a-ui`; full gate `npm test && npm run typecheck && npm run lint && npm run build` before claiming any task done.

## Review Focus

1. **A brand-new freelancer** (no invoices, no agent events): Home must show the money card, an empty "Recent" with a way to create the first invoice, and New invoice still primary. → `buildRecent` empty-input test (Task 3) and the new-account screenshot (Task 9).
2. **Reference rates unavailable** (`getReferenceRatesOrNull()` → null): every amount falls back to its own currency, no "≈", no crash. → `displayAmount` null-rates tests (Task 2) and the money card's existing null branch kept (Task 5).
3. **Treasury not ready or a proposal waiting**: the setup banner or proposal banner stays above the money card and New invoice drops to outline. → screenshot states in Task 9.
4. **Long text and large numbers at 375 px** (a 40-character client name, ARS 12,345,678): rows truncate or wrap, no horizontal scroll, amounts stay on one line. → `recent.test.ts` carries no layout, so Task 9 checks it with a seeded long name in the screenshot pass.
5. **Keyboard and reduced motion**: every row and tab shows a visible focus ring over the new hover tint; with reduced motion no transition runs. → Task 1 CSS check and Task 9 keyboard pass.

---

### Task 1: Tokens, motion and MASTER.md

**Files:**
- Modify: `src/app/globals.css` (`:root` palette block; `@layer base`; reduced-motion block)
- Modify: `src/components/ui/button.tsx` (variants)
- Modify: `design-system/cobro/MASTER.md` (Color Palette, Money formatting, Layout, Buttons, Motion, Pre-Delivery Checklist)

**Interfaces:**
- Produces: CSS tokens `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring`, `--chart-1` = primary; `--chart-2` = light tint; new `--secondary-accent` (#4D8DBA), `--tint` (#97D7FF), `--highlight` (#FFEFC4) exposed in `@theme inline` as `--color-secondary-accent`, `--color-tint`, `--color-highlight`; utility classes `.hover-tint` (rows/nav/icon buttons: transparent → primary/6% hover, primary/12% active, 20 ms ease-in, hover only under `(hover: hover)`).

- [ ] **Step 1:** Replace the teal values in `:root` with the Global Constraints OKLCH values (keep the `/* #hex */` comments). Leave `.dark` alone (MVP ships light only).
- [ ] **Step 2:** Add the three new tokens and `.hover-tint` in `globals.css` per Interfaces.
- [ ] **Step 3:** In `button.tsx`: remove `active:not-aria-[haspopup]:translate-y-px` and `transition-all`; use `transition-colors duration-100 ease-in-out`; `default` hover `bg-primary/90`, active `bg-primary/80`; `outline` border `border-secondary-accent`, text `text-primary`, hover `bg-primary/6`, active `bg-primary/12`; `ghost` the same tints.
- [ ] **Step 4:** Update MASTER.md: new palette table with the contrast figures from spec §4.5 (6.75:1, 3.60:1, 4.33:1, 15.6:1); "Money formatting" rules from spec §4.4; Layout: two columns on Home at ≥ 1024 px, "one main job per screen"; Motion section replaced with the Global Constraints motion rules (cite the notion.site measurement); add "Shared components" list (Task 4 names).
- [ ] **Step 5:** Verify no teal remains: `grep -rn "0F766E\|186.4" src design-system` → only the changelog line in MASTER.md, if any.
- [ ] **Step 6:** Run the full gate. Expected: all pass (no behaviour change).
- [ ] **Step 7:** Commit `feat(ui): new palette and Notion-like motion tokens; MASTER.md tightened`.

### Task 2: Money display rules

**Files:**
- Modify: `src/lib/money/format.ts`, `src/lib/money/display.ts`, `src/lib/treasury/explain.ts:31-40`
- Test: `src/lib/money/display.test.ts`, `src/lib/treasury/explain.test.ts`

**Interfaces:**
- Produces: `formatMoney(amount: string, currency: FiatCurrency, locale = "en-US", options?: { whole?: boolean }): string` (`whole` → no fraction digits).
- Produces: `displayAmount(amount: string, currency: FiatCurrency, local: LocalCurrency | null, rates: ReferenceRates | null, lead: "local" | "billed" = "local"): DisplayAmount`. Rules: the primary never carries "≈"; "≈" marks only a converted secondary; `lead: "billed"` puts the exact amount in its own currency first (keeps cents); otherwise ARS/BRL values ≥ 1,000 are shown whole; a converted value that is > 0 but rounds to 0.00 shows `< US$0.01` (or `< ARS 0.01`).
- Produces: `moneyText` uses `lead: "billed"` (a token amount in its own currency: "US$2.00", "ARS 3,200").

- [ ] **Step 1: Write failing tests** in `display.test.ts` (reuse the file's `rates` and `NBSP`):

```ts
it("leads balances with the local currency, whole above 1,000, no ≈ on the headline", () => {
  expect(displayAmount("300.00", "USD", "ARS", rates)).toEqual({ primary: `ARS${NBSP}481,649`, secondary: "US$300.00" });
  expect(displayAmount("1718.48", "ARS", "ARS", rates)).toEqual({ primary: `ARS${NBSP}1,718`, secondary: "≈ US$1.07" });
  expect(displayAmount("0.50", "USD", "ARS", rates)).toEqual({ primary: `ARS${NBSP}802.75`, secondary: "US$0.50" });
});
it("leads invoices with the billed currency, exact", () => {
  expect(displayAmount("300.00", "USD", "ARS", rates, "billed")).toEqual({ primary: "US$300.00", secondary: `≈ ARS${NBSP}481,649` });
  expect(displayAmount("1500.50", "ARS", "ARS", rates, "billed")).toEqual({ primary: `ARS${NBSP}1,500.50`, secondary: "≈ US$0.93" });
});
it("never shows a converted value as zero", () => {
  expect(displayAmount("1.10", "ARS", "ARS", rates, "billed")).toEqual({ primary: `ARS${NBSP}1.10`, secondary: "< US$0.01" });
});
```

Update the existing "converts a dollar invoice…" test to the new local-lead output above; keep both null-rates tests unchanged (Review Focus 2).
- [ ] **Step 2:** In `explain.test.ts` change expectations: `moneyText("USDT", "2000000", ctx)` → `"US$2.00"`; proposal titles → `Your agent asks to convert US$2.00 to pesos`, `You approved converting US$2.00 to pesos`. Keep the WARS and `local: null` cases.
- [ ] **Step 3:** Run `npx vitest run src/lib/money src/lib/treasury/explain.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 4:** Implement the Interfaces in `format.ts`, `display.ts`, `explain.ts`.
- [ ] **Step 5:** Pass `"billed"` at the invoice call sites: `src/app/app/page.tsx` (invoice list, until Task 5 replaces it) and `src/app/app/invoices/[id]/page.tsx`. Treasury and withdraw keep the default.
- [ ] **Step 6:** Run the full gate. Expected: PASS. Fix any other test that asserted the old "≈" headline.
- [ ] **Step 7:** Commit `feat(money): invoices lead with the billed currency; no ≈ on headlines; whole pesos above 1,000`.

### Task 3: Copy and the "Recent" merge

**Files:**
- Modify: `src/i18n/en.ts`
- Create: `src/lib/dashboard/recent.ts`, `src/lib/cron/schedule.ts`
- Test: `src/lib/dashboard/recent.test.ts`, `src/i18n/index.test.ts`

**Interfaces:**
- Produces: `CHECK_INTERVAL_MINUTES = 20` exported from `src/lib/cron/schedule.ts`, with a comment that the value mirrors the external cron-job.org schedule (Plan 3b) and must change with it. Strings that mention the interval take `{minutes}`.
- Produces: `type RecentItem = { kind: "invoice"; at: Date; invoice: InvoiceRow } | { kind: "event"; at: Date; event: AgentEventRow }` and `buildRecent(invoices: InvoiceRow[], events: AgentEventRow[], limit = 5): RecentItem[]`. An invoice's `at` is `paidAt ?? createdAt`; newest first; ties: events before invoices, then by id; events of type `paused`, `resumed`, `gas_dripped`, `payment_reconciled` are left out of Recent (they stay in Agent history).
- Produces: `HIDE_WHY_EVENTS: readonly AgentEventType[] = ["paused", "resumed"]` (from `recent.ts`), used by the Agent history in Task 7.

- [ ] **Step 1: Write failing tests** in `recent.test.ts` with in-file row fixtures:
  - `buildRecent([], [])` → `[]` (Review Focus 1).
  - three invoices and four events interleaved by time → 5 items, newest first, a paid invoice placed by `paidAt`.
  - a `paused` event and a `gas_dripped` event never appear.
  - equal timestamps → event first.
- [ ] **Step 2: Write a failing test** in `src/i18n/index.test.ts`: no value in `en` contains `"every 10 minutes"`, `"requests filled"`, `"Behind holding"` or `"Held by your agent"`; `t("agent.help.active", { minutes: 20 })` contains `"20 minutes"`.
- [ ] **Step 3:** Run `npx vitest run src/lib/dashboard src/i18n`. Expected: FAIL.
- [ ] **Step 4:** Implement `buildRecent` and `schedule.ts`.
- [ ] **Step 5:** Rewrite copy in `en.ts` (wording is the implementer's call within MASTER.md's "no jargon"): the four interval strings (`event.waiting.why`, `event.resumed.why`, `activity.empty`, `agent.help.active`) use `{minutes}`; `treasury.total` → "Your money"; `treasury.behind`/`treasury.protected`/`treasury.protectedHelp` reworded for the Agent tab; `conversions.volume` reworded or removed; `invoice.back` → "All invoices"; new keys for: Recent (`home.recent.title`, `home.recent.empty`, `home.recent.allInvoices`, `home.recent.agentHistory`), agent line (`home.agentLine.{active,paused,awaiting,dry_run,off}` with `{minutes}`), Invoices page (`invoices.pageTitle`, `invoices.pageIntro`), nav (`nav.invoices`), split bar legend (`treasury.legend.spending`, `treasury.legend.savings`), amount helper (`form.amount.help` → "For example 1500.50"). Pass `{ minutes: CHECK_INTERVAL_MINUTES }` at every call site of the four interval strings.
- [ ] **Step 6:** Run the full gate. Expected: PASS.
- [ ] **Step 7:** Commit `feat(copy): plain wording, the real 20-minute interval, and the Recent merge`.

### Task 4: Shared components

**Files:**
- Create: `src/components/page-header.tsx`, `src/components/list-row.tsx`, `src/components/empty-state.tsx`, `src/components/loading-rows.tsx`
- Modify: `src/components/money.tsx` (sizes), `src/components/ui/card.tsx` only if radius/padding disagree with MASTER.md (12 px, 24/16 px)

**Interfaces:**
- Produces: `PageHeader({ title, intro?, action? }: { title: string; intro?: string; action?: ReactNode })` — `h1` + muted intro + optional right-aligned action (stacks below 640 px).
- Produces: `ListRow({ href, title, subtitle?, amount?, status?, icon? }: { href?: string; title: string; subtitle?: string; amount?: DisplayAmount; status?: ReactNode; icon?: ReactNode })` — a `Link` with `.hover-tint`, focus ring and `min-h-11` when `href` is set, a plain row otherwise; title truncates, amount never wraps (Review Focus 4).
- Produces: `EmptyState({ icon, title, body, action? })`.
- Produces: `LoadingRows({ count = 3 })` — skeleton rows with `aria-busy`.
- Produces: `Money` gains `size?: "md" | "lg" | "xl"` (`xl` = the money card headline, 32–34 px semibold).

- [ ] **Step 1:** Build the four components with the `frontend-design` skill, tokens only, Lucide icons `aria-hidden`.
- [ ] **Step 2:** Run the full gate. Expected: PASS (components unused yet; lint must not flag them).
- [ ] **Step 3:** Commit `feat(ui): page header, list row, empty state and loading rows`.

### Task 5: Home (layout A, desktop A2)

**Files:**
- Modify: `src/app/app/page.tsx`, `src/app/app/treasury-summary.tsx` (becomes the money card)
- Create: `src/app/app/agent-line.tsx`, `src/app/app/recent.tsx`
- Delete: `src/app/app/repeat-clients.tsx`, `src/app/app/conversions.tsx` (and their imports); move `agent-status.tsx` and `activity-feed.tsx` usage to Task 7 (do not delete them)

**Interfaces:**
- Consumes: `buildRecent`, `CHECK_INTERVAL_MINUTES` (Task 3); `ListRow`, `EmptyState`, `Money size="xl"` (Task 4); `displayAmount(..., "billed")` (Task 2); `describeEvent` (existing).
- Produces: `MoneyCard({ user, primaryAction })` exported from `treasury-summary.tsx`; `AgentLine({ user })`; `Recent({ user })`.

- [ ] **Step 1:** Layout per mockups A/A2: `h1` greeting; setup banner and proposal slot unchanged and first; then on ≥ 1024 px a two-column grid (`lg:grid-cols-[330px_1fr]`), left = MoneyCard + AgentLine, right = Recent; below 1024 px one column in that order. Page container widens from `max-w-3xl` to `max-w-6xl` (MASTER.md content width).
- [ ] **Step 2:** MoneyCard: label "Your money", `Money size="xl"` of `totalUsd` (default lead), a split bar (spending = `bg-primary`, savings = `bg-tint`, widths from spending vs savings in USD, direct labels below via `treasury.legend.*`), buttons New invoice (primary unless setup/proposal, same rule as today) and Withdraw (outline). Keep the existing load-error `role="alert"` branch and the `null` return.
- [ ] **Step 3:** AgentLine: one line on `bg-highlight` with a status dot and `home.agentLine.<state>` (state from the existing `agentState`), linking to `/app/rules`.
- [ ] **Step 4:** Recent: `buildRecent(listInvoices(db, user.id, 10), listEvents(db, user.id, 10))`; invoice rows via `ListRow` (client · description, due or paid date, `displayAmount(..., "billed")`, `InvoiceStatusChip`); event rows via `describeEvent(...).title` and date; footer links "All invoices" → `/app/invoices`, "Agent history" → `/app/rules#history`. Empty → `EmptyState` with the "Create your first invoice" link.
- [ ] **Step 5:** Run the full gate. Expected: PASS.
- [ ] **Step 6:** Screenshot `/app` at 390×844 and 1280×800 on `npm run dev` (Playwright MCP, files under `.playwright-mcp/ux-4a/`); compare with the mockups; fix differences.
- [ ] **Step 7:** Commit `feat(home): money first, agent line and Recent; two columns on desktop`.

### Task 6: Four tabs and the Invoices page

**Files:**
- Modify: `src/app/app/app-nav.tsx:8-11` (ITEMS), `src/app/app/invoices/[id]/page.tsx` (back link)
- Create: `src/app/app/invoices/page.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `ListRow`, `EmptyState`, `LoadingRows` (Task 4).
- Produces: route `/app/invoices` (all invoices, newest first, `listInvoices(db, user.id, 50)`), header action New invoice (primary).

- [ ] **Step 1:** ITEMS = Home `/app` (House), Invoices `/app/invoices` (FileText), Agent `/app/rules` (Bot), Settings `/app/settings` (Settings). Active rule: `/app/invoices` matches `/app/invoices/*`. Nav items get `.hover-tint`; the active item text `text-primary`, background `bg-tint/35`.
- [ ] **Step 2:** Invoices page inside `<Suspense fallback={<LoadingRows />}>`, awaiting `requireUser()` before the DB read (CLAUDE.md); rows as in Task 5 Step 4.
- [ ] **Step 3:** Invoice detail back link → `/app/invoices` with `t("invoice.back")`.
- [ ] **Step 4:** Run the full gate, then `npm run build` output must list `/app/invoices`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(nav): Invoices tab and invoice list page`.

### Task 7: Agent tab

**Files:**
- Modify: `src/app/app/rules/page.tsx`, `src/app/app/agent-status.tsx`, `src/app/app/activity-feed.tsx`

**Interfaces:**
- Consumes: `HIDE_WHY_EVENTS` (Task 3), `PageHeader` (Task 4), `volumeStats` and the value-protected figures (existing `loadTreasuryView`).
- Produces: `/app/rules` sections in order: proposal notice (existing) → AgentStatus card (state, limits, last action, pause) → value-protected card (moved from Home, new copy; volume stat under "Details") → preview and rules form (existing) → `<section id="history">` ActivityFeed (40 events).

- [ ] **Step 1:** Recompose the page per Produces; widen to `max-w-3xl`; ActivityFeed rows use `ListRow`-like styling and omit "Why?" for `HIDE_WHY_EVENTS`.
- [ ] **Step 2:** Check the rules form at 390×844: "Advanced settings" and "Save rules" are reachable and not covered by the bottom bar (layout already pads `pb-20`; if the sticky bar still covers the last control, add bottom padding on the form, not a second bar).
- [ ] **Step 3:** Run the full gate. Expected: PASS.
- [ ] **Step 4:** Commit `feat(agent): status, value protected and full history on the Agent tab`.

### Task 8: Remaining screens

**Files:**
- Modify: `src/app/app/invoices/new/*` (form copy and layout), `src/app/app/settings/page.tsx` (fallback for the Para buttons), `src/app/app/withdraw/page.tsx` and `withdraw-form.tsx` (styling only), `src/app/app/invoices/[id]/page.tsx` (styling), `src/app/pay/[slug]/*` and `src/app/signin/*` (palette and motion only — they are the model; do not restructure)

**Interfaces:**
- Consumes: Task 1 tokens, Task 4 components.

- [ ] **Step 1:** New invoice: `PageHeader`; amount helper `form.amount.help`; at 390×844 the submit button is visible after filling the last field without being covered by the bar.
- [ ] **Step 2:** Settings: render `<LoadingRows count={2} />` (or two button-sized skeletons) until Para is ready — show the skeleton as the client fallback inside `ParaProviders` (use Para's ready state from `@getpara/react-sdk`; check its hooks in `node_modules/@getpara/react-sdk` before choosing).
- [ ] **Step 3:** Withdraw, invoice detail, pay page, sign-in: apply tokens, `.hover-tint` on selectable options, button variants; no layout change beyond MASTER.md fixes.
- [ ] **Step 4:** Ask the user to set the brand colour in the Para Developer Portal (BETA) to `#086288` so the sign-in modal matches (portal settings are theirs; the SDK no longer takes theme config).
- [ ] **Step 5:** Run the full gate. Expected: PASS.
- [ ] **Step 6:** Commit `feat(ui): new invoice, settings, withdraw and pay page follow the design system`.

### Task 9: Page specs, screenshot review and ship

**Files:**
- Create: `design-system/cobro/pages/home.md`, `invoices.md`, `agent.md`
- Modify: `docs/superpowers/specs/2026-10-08-cobro-design.md` §17.2 (pointer to the new layout and MASTER.md)

- [ ] **Step 1:** Write the three page specs (sections, order, which component, the primary action, empty/loading/error states) from what Tasks 5–7 built.
- [ ] **Step 2:** Screenshot review on `npm run dev` at 375, 768, 1024, 1440 px for: `/`, `/signin`, `/app`, `/app/invoices`, `/app/invoices/new`, an invoice detail, `/pay/<slug>`, `/app/rules`, `/app/settings`, `/app/withdraw`. States: the user's real account; a fresh account with nothing (Review Focus 1); a long client name (Review Focus 4: create one invoice on the dev DB named "Asociación Cooperativa de Trabajo Limitada" for ARS 12,345,678 — ask the user before creating it, then delete it with their yes); keyboard Tab through Home and nav with focus visible (Review Focus 5); `prefers-reduced-motion` emulated. Rates-off and proposal states are covered by tests and existing code; check them only if a dev toggle exists.
- [ ] **Step 3:** Run MASTER.md's pre-delivery checklist; fix findings.
- [ ] **Step 4:** Run the full gate. Expected: PASS.
- [ ] **Step 5:** Commit `docs: page specs for Home, Invoices and Agent`.
- [ ] **Step 6:** Show the user desktop and mobile screenshots of Home, Invoices and Agent; wait for their OK.
- [ ] **Step 7:** Merge `--no-ff` into `main`, run the full gate on the merge, push (deploys to Vercel production). Then screenshot production `/app` on both widths.
