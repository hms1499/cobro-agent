# Plan 4f: app polish (design)

- **Date:** 2026-10-22. **Branch:** `plan-4f-app-polish`. Runs before Plan 4e (submission) **(user)**.
- **Comparison screens:** `.superpowers/brainstorm/98677-1792637323/content/compare.html` (Cobro
  next to Mercury, Mercury Invoicing, Stripe hosted invoice, Wise; local only).
- Marks: **(user)** = decided by the user; **(builder's call)** = chosen by the builder, may change
  with a reason.

## 1. Intent

The user finds the signed-in app plain ("sơ sài") and not professional; the landing is fine but has
no motion on scroll **(user)**. What they want is the care and balance of finance apps **(user)**,
with Mercury (dashboard, invoicing) and Stripe (hosted invoice) as the main references. Diagnosis
from the side-by-side review: the problem is not colour, it is missing finance-app detail: no
summary figures, no dates or invoice numbers, no table, no invoice that looks like a document, a
pay page without trust cues, a bare app frame, half-empty screens.

## 2. Scope (all chosen by the user in the comparison screen)

| Id | Item |
|----|------|
| A | Summary figures: Open (awaiting), Overdue, Received this month, at the top of Home and Invoices |
| B | Invoice table with filter tabs (All / Open / Overdue / Paid) on desktop; a list on mobile |
| C | Invoice detail that looks like a real invoice: number, dates, From/To, line item, status timeline; a live preview while creating |
| D | Balance split into "pockets": Spending (local currency) and Savings (USD), each with a currency icon |
| E | Client pay page in the Stripe pattern: brand header, invoice summary card, payment card with token logos, due date, trust line |
| F | A fuller app frame: top bar, account block in the sidebar, logo mark, illustrated empty states |
| G | Motion: landing reveals on scroll; in the app page transitions, count-up figures, skeletons while loading |

## 3. Non-goals and anti-goals

- No change to money movement, the agent, x402, Para, the cron or withdrawals **(builder's call)**.
  Pay-page work is layout only: `pay-invoice.tsx` keeps its state machine and calls.
- No new brand: palette #086288 / #4D8DBA / #97D7FF / #FFEFC4, fonts and tokens stay. No dark mode.
- No multi-line invoices: the existing `description` is shown as the single line item
  **(builder's call, raised with the user)**. No "Viewed" step in the timeline (nothing records views).
- No new runtime dependency for motion **(builder's call)**: CSS, `tw-animate-css` (already
  installed), `IntersectionObserver` and the View Transitions API where Next.js 16.4 supports it.
- Anti-goals: crypto jargon in default views; status shown by colour alone; motion that shifts
  layout or ignores `prefers-reduced-motion`; breaking the 390px layout; a second primary button.

## 4. Decisions

### 4.1 Data (no migration)

- **Invoice number** **(builder's call)**: `INV-0001` style, the invoice's 1-based position among the
  user's invoices ordered by `created_at, id`, computed at read time (`row_number()`), not stored.
  Invoices are never deleted (cancelled is a status), so numbers stay stable. The pay page shows it
  too.
- **Overdue** = status `open` and `due_date` before today (UTC date). A display state only; the
  `invoice_status` enum does not change. The status chip gets an "Overdue" variant (destructive,
  `CircleAlert`).
- **Summary figures (A)**: amounts are summed after converting each invoice to USD with the
  reference rates already used by `displayAmount`, then shown as a `DisplayAmount` (local currency
  first, USD second, per MASTER.md). "Received this month" counts invoices with `paid_at` in the
  current calendar month (UTC). If rates are unavailable the figures show counts only.
- **Pockets (D)**: from `TreasuryView.spending` (local) and `savingsUsd`. The total stays as the
  large figure; the two pockets sit under it as rows with a currency badge, amount, and the reserve
  bar under Spending. Currency badges are drawn in CSS/SVG (no flag emoji, no image download).
- **Timeline (C)**: Created (`created_at`) → Due (`due_date`, if any) → Paid (`paid_at`) or
  Cancelled. Settling shows as "Payment in progress".

### 4.2 Screens

- **Frame (F)**: desktop sidebar gets a logo mark + wordmark at top and an account block at the
  bottom (initial avatar, display name, email, link to Settings). A slim top bar on desktop holds
  the page title area and the primary action of the page; on mobile the bottom bar stays and a
  compact top bar shows the logo mark. Main content widens to use the space (Home and Invoices up
  to `max-w-6xl`); forms stay narrow.
- **Home**: greeting + date line; row of three summary cards (A); left column money card with
  pockets (D) and agent line; right column Recent with dates and client initials; no half-empty
  screen at 1440×900.
- **Invoices (B)**: summary cards, filter tabs as links (`?status=open|overdue|paid`, server-
  rendered, no client state), desktop table (Number, Client with initial avatar, Issued, Due,
  Amount, Status), mobile list rows with the number and due date. Each tab has its own empty state.
- **Invoice detail (C)**: two columns on desktop: left the invoice document (From: freelancer
  name/email, To: client, number, issued, due, line item table, total), right a side panel with the
  status chip, timeline, share link + "Open payment page", payments with "Details". Mobile stacks
  them, document first.
- **New invoice (C)**: form on the left, live preview of the invoice document on the right
  (desktop only, updates as the user types; same document component as the detail page).
- **Pay page (E)**: brand band at the top (logo, freelancer name), invoice summary card (amount,
  "Due …", number, From/To, line item) and a payment card holding the existing pay flow with token
  logos on the choices; footer trust line ("Secured on Celo · Powered by Cobro") and a link to the
  on-chain receipt once paid. One primary button remains (the pay button inside the flow).
- **Empty states (F)**: a small inline SVG illustration in the brand colours per empty state
  (invoices, recent, agent history, addresses); no external images.
- **Other app pages** (Agent, Settings, Withdraw, addresses, onboarding) get the new frame and the
  shared components, and their sections are grouped in cards with headers; no content changes
  **(builder's call)**.

### 4.3 Motion (G) — amends MASTER.md "Motion" (user)

- Landing: sections and cards fade + rise 8–12px into place once, when 15–20% visible
  (`IntersectionObserver`), staggered 60–80ms within a group, 400–500ms ease-out. The hero is not
  delayed.
- App: route content fades in (≤200ms) on navigation; summary figures count up once on first
  paint (≤600ms); skeletons for every Suspense boundary matching the final layout.
- Hover and press stay as today (no layout-moving hover).
- `prefers-reduced-motion: reduce` turns all of it off (content visible at once, numbers final).
- MASTER.md "Motion" is rewritten to say this, replacing "nothing moves / at most one or two
  animated elements per view".

## 5. Constraints

Everything in CLAUDE.md and MASTER.md otherwise: `cacheComponents` + Suspense rules, `t()` for
every string (keys in `en.ts`), `formatMoney`/`displayAmount` for every fiat figure, tokens only, Lucide
icons with `aria-hidden`, `min-h-11` targets, one primary button per screen, 390px and 1440px both
checked. Use the `frontend-design` skill while building the screens. Read the Next.js 16.4 docs in
`node_modules/next/dist/docs/` before using View Transitions or new routing APIs. Full gate before
done; screenshots of every changed screen at 390 and 1440 compared with the references.

## 6. Left to the builder

Component names and file layout; exact copy within the rules; exact spacing; whether the top bar is
part of the layout or of each page; the SVG illustrations; how count-up is implemented; plan task
breakdown.
