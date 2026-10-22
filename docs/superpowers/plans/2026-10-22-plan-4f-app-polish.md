# Plan 4f: App Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the signed-in app and the client pay page look like a careful finance product (Mercury / Stripe), and add scroll and page motion, without touching money movement.

**Architecture:** Pure view helpers in `src/lib/invoices/view.ts` (numbers, overdue, filters, summary, timeline) feed new shared components (`InvoiceDocument`, `SummaryCards`, `InitialAvatar`, `CurrencyBadge`, illustrations, `Reveal`, `CountUp`). Pages are rebuilt from those components; the app frame gets a logo mark, account block and a React `<ViewTransition>` fade. No schema change: invoice numbers are a `row_number()` window at read time.

**Tech Stack:** Next.js 16.4 App Router (`cacheComponents`), React 19.3 (`ViewTransition`), Tailwind 4 + `tw-animate-css`, Drizzle on Neon/PGlite, Vitest (node env, `.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-10-22-plan-4f-app-polish-design.md`

## Global Constraints

- No change to money movement, agent, x402, Para, cron, withdrawals; `pay-invoice.tsx` keeps its state machine and calls (markup only).
- No schema migration. No new runtime dependency.
- Palette, fonts and tokens unchanged; tokens only, no raw hex in components (SVG illustrations use `currentColor` / token classes).
- Every string through `t()` with keys in `src/i18n/en.ts`; every fiat figure through `formatMoney` / `displayAmount`.
- `cacheComponents`: anything reading cookies/params/searchParams/DB sits in `<Suspense>`.
- Lucide icons `aria-hidden`; touch targets `min-h-11`; one primary button per screen; status never by colour alone.
- Motion: opacity/transform only, landing reveal 8–12px rise, 400–500ms ease-out, 60–80ms stagger; app route fade ≤200ms; count-up ≤600ms once; all off under `prefers-reduced-motion: reduce`.
- Invoice number format `INV-0001` (4 digits minimum, grows past 9999).
- Overdue = status `open` and `due_date` < today (UTC `YYYY-MM-DD`).
- Check 390px and 1440px for every changed screen.
- Gate: `npm test && npm run typecheck && npm run lint && npm run build`.

## Review Focus

- Rates unavailable (Textile down) with mixed-currency invoices: summary must show counts without amounts, never throw → test in Task 1.
- Invoice due today is not overdue; due yesterday is → test in Task 1.
- A user with zero invoices: summary zeros, each filter tab has its own empty state, no NaN → test in Task 1 (summary of `[]`).
- Settling invoice: counts as open in the summary, shows "Payment in progress" in the timeline → test in Task 1.
- Numbering is per user, stable with invoices of another user interleaved → test in Task 2.

---

### Task 1: Invoice view helpers

**Files:**
- Create: `src/lib/invoices/view.ts`
- Test: `src/lib/invoices/view.test.ts`

**Interfaces:**
- Consumes: `InvoiceRow` (`@/lib/db/schema`), `convertFiat` (`@/lib/fx/convert`), `ReferenceRates`, `parseDecimal`/`formatDecimal` (`@/lib/money/decimal`), `RatesUnavailableError`.
- Produces:
  - `formatInvoiceNumber(n: number): string`
  - `type DisplayStatus = "open" | "overdue" | "settling" | "paid" | "cancelled"`
  - `displayStatus(inv: Pick<InvoiceRow, "status" | "dueDate">, today: string): DisplayStatus`
  - `type InvoiceFilter = "all" | "open" | "overdue" | "paid"`; `parseInvoiceFilter(v: unknown): InvoiceFilter` (unknown → `"all"`)
  - `filterInvoices<T extends Pick<InvoiceRow,"status"|"dueDate">>(rows: T[], f: InvoiceFilter, today: string): T[]` (`open` includes settling and excludes overdue)
  - `interface SummaryFigure { count: number; usd: string | null }`; `interface InvoiceSummary { open: SummaryFigure; overdue: SummaryFigure; receivedThisMonth: SummaryFigure }`
  - `summarizeInvoices(rows: InvoiceRow[], rates: ReferenceRates | null, now: Date): InvoiceSummary` — `open` = open (not overdue) + settling; `overdue`; `receivedThisMonth` = `paidAt` in `now`'s UTC calendar month. `usd` is the USD sum as a 2-decimal string, or `null` for a figure when a conversion it needs throws `RatesUnavailableError`.
  - `type TimelineStep = { key: "created" | "due" | "settling" | "paid" | "cancelled"; at: Date | string | null; done: boolean }`; `invoiceTimeline(inv: InvoiceRow, today: string): TimelineStep[]` — `created` (done), `due` (only if `dueDate`; done when paid or date passed), then `settling` while settling, `paid` (done when paid; else pending, `at` null) or `cancelled` instead of `paid`.

- [ ] **Step 1: Write failing tests** in `view.test.ts` with a `row(overrides)` factory building an `InvoiceRow` (USD 100.00, open, createdAt 2026-10-01):
  - `formatInvoiceNumber(1) === "INV-0001"`, `(42) === "INV-0042"`, `(12345) === "INV-12345"`.
  - `displayStatus({status:"open",dueDate:"2026-10-22"},"2026-10-22") === "open"`; dueDate `"2026-10-21"` → `"overdue"`; `dueDate:null` → `"open"`; `status:"paid"` with past due → `"paid"`.
  - `parseInvoiceFilter("overdue") === "overdue"`, `parseInvoiceFilter("x") === "all"`, `parseInvoiceFilter(undefined) === "all"`.
  - `filterInvoices` over [open, overdue, settling, paid, cancelled]: `open` → open + settling; `overdue` → 1; `paid` → 1; `all` → 5.
  - `summarizeInvoices([], null, NOW)` → all `{count:0, usd:"0.00"}`.
  - USD-only rows with `rates=null`: open 2×100 → `{count:2, usd:"200.00"}`; overdue 1×50 → `"50.00"`; paid with `paidAt` 2026-10-05 → received `{1,"100.00"}`; paid 2026-09-30 → not counted.
  - Settling row counts in `open`.
  - Mixed ARS + USD open rows with `rates=null` → `open: {count:2, usd:null}`.
  - ARS row with rates `{perUsd:{ARS: 1500n*10n**18n, BRL: 5n*10n**18n}, fetchedAt: 0}`: ARS 1500.00 open → `usd:"1.00"`.
  - `invoiceTimeline` for open with due in future → keys `["created","due","paid"]`, `due.done=false`, `paid.done=false`; paid → all done; cancelled → last key `"cancelled"`; settling → `["created","settling","paid"]` (no due).

- [ ] **Step 2: Run** `npx vitest run src/lib/invoices/view.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/invoices/view.ts` with the signatures above. Sum cents with `parseDecimal(convertFiat(amount, currency, "USD", rates), 2)` as bigint and print `${cents / 100n}.${pad2(cents % 100n)}` (not `formatDecimal`, which drops trailing zeros); catch only `RatesUnavailableError`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(invoices): view helpers for numbers, overdue, filters, summary and timeline`.

### Task 2: Numbered invoice reads

**Files:**
- Modify: `src/lib/invoices/repo.ts` (`listInvoices`, `getOwnedInvoice`, `findPublicInvoice`, `OwnedInvoice`, `PublicInvoice`)
- Test: `src/lib/invoices/repo.test.ts`

**Interfaces:**
- Produces:
  - `type NumberedInvoice = InvoiceRow & { number: number }`
  - `listInvoices(db, userId, limit = 50): Promise<NumberedInvoice[]>` (newest first, number = 1-based position among the user's invoices ordered by `created_at, id` ascending — window over all the user's rows, not only the page)
  - `OwnedInvoice.invoice: NumberedInvoice`
  - `PublicInvoice.number: number`
- Callers of `listInvoices` keep working (superset type).

- [ ] **Step 1: Write failing tests** in `repo.test.ts`:
  - `"numbers a user's invoices in creation order"`: create 3 invoices for user A (insert with explicit increasing `createdAt` via `db.update` after create) interleaved with 2 for user B; `listInvoices(db, A.id)` → numbers `[3,2,1]` newest first; B's → `[2,1]`.
  - `"numbers stay when the list is limited"`: `listInvoices(db, A.id, 1)[0].number === 3`.
  - `getOwnedInvoice(...).invoice.number === 2` for A's second invoice; `findPublicInvoice(db, slug).number === 2`.
- [ ] **Step 2: Run** `npx vitest run src/lib/invoices/repo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** with a subquery selecting `invoices.*` plus `row_number() over (partition by user_id order by created_at, id)` as `number` (cast to int), filtered by user, then order/limit outside.
- [ ] **Step 4: Run** the same command — Expected: PASS. Run `npm run typecheck` — Expected: no errors.
- [ ] **Step 5: Commit** `feat(invoices): per-user invoice numbers at read time`.

### Task 3: Shared visual components

**Files:**
- Create: `src/components/initial-avatar.tsx`, `src/components/currency-badge.tsx`, `src/components/logo-mark.tsx`, `src/components/illustrations.tsx`, `src/components/count-up.tsx`, `src/components/summary-cards.tsx`, `src/lib/ui/initials.ts`, `src/lib/ui/initials.test.ts`
- Modify: `src/components/status-chip.tsx`, `src/components/empty-state.tsx`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `DisplayStatus`, `InvoiceSummary` (Task 1), `displayAmount`, `LocalCurrency`.
- Produces:
  - `initials(name: string): string` — up to 2 letters, first of first two words, uppercase; `""` → `"?"`; handles accents (`"Lucía Fernández"` → `"LF"`).
  - `<InitialAvatar name: string size?: "sm" | "md" />` — circle, `bg-tint text-primary`, `aria-hidden`.
  - `<CurrencyBadge code: FiatCurrency | PayAsset />` — round badge with short code text ("US$", "AR$", "R$"; tokens show their denomination badge plus a small corner dot for "token"), drawn with CSS/SVG, `aria-hidden`.
  - `<LogoMark className? />` — inline SVG mark in `currentColor`.
  - `illustrations.tsx` exports `InvoicesIllustration`, `ActivityIllustration`, `AddressesIllustration` — inline SVG, ~96px, `aria-hidden`, token colours via `fill-primary`/`fill-tint`/`fill-muted` classes.
  - `<CountUp value: string />` (client) — animates the displayed number from 0 once on mount over ≤600ms with `requestAnimationFrame`, renders the final formatted string immediately when `matchMedia("(prefers-reduced-motion: reduce)")` matches; the accessible text is always the final value (`aria-hidden` animated span + `sr-only` final).
  - `<SummaryCards summary: InvoiceSummary local: LocalCurrency | null rates: ReferenceRates | null />` — three cards (Open, Overdue, Received this month): amount via `displayAmount(usd, "USD", local, rates)` wrapped in `CountUp` for the primary figure; when `usd` is null show the count only; subtitle "{count} invoices". Overdue amount in `text-destructive` with `CircleAlert` when count > 0.
  - `InvoiceStatusChip` takes `status: DisplayStatus`; new `overdue` entry (`CircleAlert`, `text-destructive`, `status.overdue`).
  - `EmptyState` gains optional `illustration?: ReactNode` rendered above the title, and centres its content when present.
- i18n keys to add: `status.overdue` "Overdue", `summary.open` "Open", `summary.overdue` "Overdue", `summary.received` "Received this month", `summary.count` "{count} invoices", `summary.countOne` "1 invoice".

- [ ] **Step 1: Write failing test** `src/lib/ui/initials.test.ts`: `"Lucía Fernández Studio"`→`"LF"`, `"acme"`→`"A"`, `"  "`→`"?"`, `"Pixel  Guild"`→`"PG"`.
- [ ] **Step 2: Run** `npx vitest run src/lib/ui` — Expected: FAIL.
- [ ] **Step 3: Implement** `initials` and the components above (use the `frontend-design` skill for the SVGs and card styling within MASTER.md).
- [ ] **Step 4: Run** `npx vitest run src/lib/ui && npm run typecheck && npm run lint` — Expected: PASS, no errors.
- [ ] **Step 5: Commit** `feat(ui): avatar, currency badge, logo mark, illustrations, count-up and summary cards`.

### Task 4: App frame and page transition

**Files:**
- Modify: `src/app/app/layout.tsx`, `src/app/app/app-nav.tsx`, `src/app/globals.css`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `LogoMark`, `InitialAvatar` (Task 3), `getCurrentUser`.
- Produces: `AppNav({ hasProposal, account }: { hasProposal: boolean; account: { name: string; email: string | null } | null })`; `AppNavLinks` gains the same optional `account`.

- [ ] **Step 1:** Read `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` (route transitions section).
- [ ] **Step 2: Implement** desktop sidebar: `LogoMark` + wordmark at top, nav, and an account block pinned to the bottom (`InitialAvatar`, name, email truncated, link to `/app/settings`, `min-h-11`, `hover-tint`). Mobile: a compact sticky top bar with `LogoMark` + wordmark (`lg:hidden`), bottom bar unchanged. `NavWithProposal` passes `account` from the user it already loads (`displayName ?? email`).
- [ ] **Step 3: Implement** the route fade: wrap `{children}` in the layout with React `<ViewTransition>`; in `globals.css` define `::view-transition-old(root)`/`new(root)` (or the named transition used) as opacity 150–200ms ease-out, disabled under `prefers-reduced-motion`.
- [ ] **Step 4: Verify** `npm run typecheck && npm run lint && npm run build` — Expected: exit 0. Screenshot `/app` at 390 and 1440 (scratchpad script from the brainstorm, or Playwright) — account block visible at 1440, top bar visible at 390, bottom bar not covering content.
- [ ] **Step 5: Commit** `feat(app): sidebar logo and account block, mobile top bar, route fade`.

### Task 5: Home

**Files:**
- Modify: `src/app/app/page.tsx`, `src/app/app/treasury-summary.tsx`, `src/app/app/recent.tsx`, `src/components/list-row.tsx`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `summarizeInvoices`, `listInvoices` (500 rows for the summary), `SummaryCards`, `CurrencyBadge`, `InitialAvatar`, `InvoiceStatusChip(DisplayStatus)`, `displayStatus`.
- Produces: `ListRow` gains optional `leading?: ReactNode` (replaces nothing; `icon` stays for agent rows) and `meta?: string` (a muted right-side line, e.g. a date).

- [ ] **Step 1: Implement** Home: greeting + today's date line (`formatDate(new Date())`); a `SummaryCards` row in its own `<Suspense>` with a three-card skeleton; left column `MoneyCard` with pockets: total as `Money xl` (wrapped in `CountUp` for the primary), then two rows "Spending" (`CurrencyBadge` local, amount, reserve bar beneath) and "Savings in dollars" (`CurrencyBadge` USD, amount); right column Recent with `InitialAvatar` leading on invoice rows, invoice number + due/paid date as subtitle, and the display status chip.
- [ ] **Step 2: Implement** skeletons matching the final layout (summary row, money card, 5 rows).
- [ ] **Step 3: Verify** `npm test && npm run typecheck && npm run lint` — Expected: PASS. Screenshot `/app` at 1440×900: no empty lower half (summary row + two columns fill the first screen); at 390 the order is summary, money, agent line, recent.
- [ ] **Step 4: Commit** `feat(home): summary figures, money pockets and richer recent rows`.

### Task 6: Invoices list with filters and table

**Files:**
- Modify: `src/app/app/invoices/page.tsx`, `src/i18n/en.ts`
- Create: `src/app/app/invoices/invoice-table.tsx`, `src/app/app/invoices/filter-tabs.tsx`

**Interfaces:**
- Consumes: `listInvoices` (`NumberedInvoice`), `parseInvoiceFilter`, `filterInvoices`, `summarizeInvoices`, `displayStatus`, `formatInvoiceNumber`, `SummaryCards`, `InitialAvatar`, `InvoicesIllustration`.
- Produces: `FilterTabs({ current: InvoiceFilter; counts: Record<InvoiceFilter, number> })` — links to `/app/invoices` and `?status=open|overdue|paid`, `aria-current="page"` on the active one, count badges, horizontally scrollable at 390; `InvoiceTable({ rows, local, rates, today })`.

- [ ] **Step 1: Implement** the page: `main` widened to `max-w-6xl`; `PageHeader` (one primary "New invoice"); `SummaryCards`; `FilterTabs`; at `md+` a `<table>` with columns Number, Client (avatar + name + description muted), Issued, Due, Amount (right-aligned, `tabular-nums`, `displayAmount(...,"billed")`), Status — each row a link to the detail (row-wide link via a stretched anchor in the first cell, keyboard-focusable); below `md` the `ListRow` list with number and due date. Empty state per filter with `InvoicesIllustration` (`invoices.empty.<filter>` keys). Reads `searchParams.status` inside Suspense.
- [ ] **Step 2: Verify** `npm run typecheck && npm run lint && npm run build` — Expected: exit 0. Screenshots of `/app/invoices`, `?status=overdue` (empty), at 390/1440.
- [ ] **Step 3: Commit** `feat(invoices): filter tabs, summary and desktop table`.

### Task 7: Invoice document and detail page

**Files:**
- Create: `src/components/invoice-document.tsx`, `src/app/app/invoices/[id]/timeline.tsx`
- Modify: `src/app/app/invoices/[id]/page.tsx`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: `invoiceTimeline`, `formatInvoiceNumber`, `displayStatus`, `formatMoney`, `formatDate`.
- Produces: `InvoiceDocument(props: { number: number | null; from: { name: string; email?: string | null }; to: string; issued: Date | string; due: string | null; description: string; amount: string; currency: FiatCurrency; compact?: boolean })` — paper-like card: header with `LogoMark` + "Invoice" + number (or "Draft" when null), From / Billed to blocks, Issued / Due, a one-row items table (Description, Amount), Total row; `formatMoney` for amounts. Used by the detail page, the new-invoice preview (Task 8) and the pay page (Task 9).

- [ ] **Step 1: Implement** `InvoiceDocument` and `Timeline` (vertical list, icon per step, done steps `text-success`/filled dot, pending muted, `formatDate` per step, labels `timeline.created|due|settling|paid|cancelled`).
- [ ] **Step 2: Implement** the detail page: `max-w-5xl`, `lg:grid-cols-[minmax(0,1fr)_320px]`; left `InvoiceDocument` (from = user display name/email), right panel card: status chip (display status), timeline, share link + "Open payment page" (only open/settling), payments list with "Details" unchanged. Keep the `?created=1` status line.
- [ ] **Step 3: Verify** `npm run typecheck && npm run lint && npm run build` — Expected: exit 0; screenshots at 390/1440.
- [ ] **Step 4: Commit** `feat(invoices): invoice document and status timeline on the detail page`.

### Task 8: New invoice live preview

**Files:**
- Modify: `src/app/app/invoices/new/invoice-form.tsx`, `src/app/app/invoices/new/page.tsx`

**Interfaces:**
- Consumes: `InvoiceDocument` (Task 7) with `number: null`.
- Produces: `InvoiceForm({ defaultCurrency, from }: { defaultCurrency: FiatCurrency; from: { name: string; email: string | null } })`.

- [ ] **Step 1: Implement** controlled mirrors of client, description, amount, currency, due date via the form's `onChange` (no change to the server action or field names); the preview shows `amount` through `formatMoney` only when `parseFiatInput` accepts it, else a muted placeholder. Page: `max-w-5xl`, `lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`, preview `hidden lg:block` and sticky.
- [ ] **Step 2: Verify** `npm test && npm run typecheck && npm run lint && npm run build`; Playwright: type into the form at 1440, the preview updates; submit still creates an invoice (dev DB) and redirects to the detail page.
- [ ] **Step 3: Commit** `feat(invoices): live invoice preview while creating`.

### Task 9: Client pay page (Stripe pattern)

**Files:**
- Modify: `src/app/pay/[slug]/page.tsx`, `src/app/pay/[slug]/pay-invoice.tsx` (markup of the asset choices only), `src/i18n/en.ts`

**Interfaces:**
- Consumes: `PublicInvoice.number` (Task 2), `InvoiceDocument` (`compact`), `CurrencyBadge`, `LogoMark`.

- [ ] **Step 1: Implement** a full-width brand band (`bg-primary text-primary-foreground`, `LogoMark`, freelancer name) behind the top of a centred `max-w-xl` column; card 1 = amount large + "Due {date}" + number + `InvoiceDocument compact` details (From / Billed to / line item); card 2 = the existing pay flow (or paid / cancelled / not-ready messages); asset radios get `CurrencyBadge` for their asset; footer trust line `pay.trust` "Secured on Celo · Powered by Cobro" with `ShieldCheck`. One primary button remains.
- [ ] **Step 2: Verify** `npm test && npm run typecheck && npm run lint && npm run build`; screenshot `/pay/<dev slug>` at 390/1440; choose an asset in Playwright and confirm the quote area still renders (no wallet, no payment).
- [ ] **Step 3: Commit** `feat(pay): branded invoice summary and payment card`.

### Task 10: Remaining app pages

**Files:**
- Modify: `src/app/app/rules/page.tsx`, `src/app/app/settings/page.tsx`, `src/app/app/settings/addresses/page.tsx`, `src/app/app/withdraw/page.tsx`, `src/app/app/onboarding/page.tsx`, `src/app/app/activity-feed.tsx` (empty state), `src/app/app/recent.tsx` (empty state)

- [ ] **Step 1: Implement** consistent page headers (`PageHeader`), sections grouped in cards with a heading and short intro, two columns at `lg` where a page has independent sections (Agent: status + protected on the right, rules form left), illustrated empty states (`ActivityIllustration`, `AddressesIllustration`, `InvoicesIllustration`). No copy or behaviour changes.
- [ ] **Step 2: Verify** `npm run typecheck && npm run lint && npm run build`; screenshots of each page at 390/1440.
- [ ] **Step 3: Commit** `feat(app): card sections and illustrated empty states on remaining pages`.

### Task 11: Landing scroll reveal and MASTER.md motion

**Files:**
- Create: `src/components/reveal.tsx`
- Modify: `src/app/globals.css`, `src/components/landing/how-it-works.tsx`, `client-preview.tsx`, `agent-panel.tsx`, `onchain-proof.tsx`, `faq.tsx`, `final-cta.tsx`, `design-system/cobro/MASTER.md`

**Interfaces:**
- Produces: `<Reveal as?: "div" | "section" | "li"; delay?: number; className?; children />` (client) — adds `data-reveal` and toggles `data-shown` once when ≥15% visible (`IntersectionObserver`, `threshold: 0.15`, unobserve after). CSS: `[data-reveal]` starts `opacity:0; transform: translateY(12px)` only inside `@media (prefers-reduced-motion: no-preference)` and only when JS has run (`html.js` class set by an inline script or the component setting the initial state on mount, so content is visible without JS); `[data-shown]` → `opacity:1; transform:none` with `transition: opacity 450ms ease-out, transform 450ms ease-out; transition-delay: var(--reveal-delay)`.

- [ ] **Step 1: Implement** `Reveal` and CSS; wrap each landing section heading/body and stagger card groups with `delay` 0/70/140/210ms. Hero untouched.
- [ ] **Step 2: Update** MASTER.md "Motion": replace "nothing moves" / "At most one or two animated elements per view" with the rules in the spec §4.3; keep hover/press rules and the reduced-motion rule.
- [ ] **Step 3: Verify** `npm run typecheck && npm run lint && npm run build`; Playwright at 1440: scroll the landing, sections appear; with `reducedMotion: "reduce"` all sections are visible immediately; with JS disabled all content is visible.
- [ ] **Step 4: Commit** `feat(landing): reveal sections on scroll; MASTER.md motion rules`.

### Task 12: Final verification

- [ ] **Step 1: Run** `npm test && npm run typecheck && npm run lint && npm run build` — Expected: all pass, exit 0.
- [ ] **Step 2:** Screenshot every changed screen at 390 and 1440 and push a before/after page to the brainstorm companion for the user.
- [ ] **Step 3:** Hand back to the user for review before merging (`--no-ff` into `main`, gate on the merge, push).
