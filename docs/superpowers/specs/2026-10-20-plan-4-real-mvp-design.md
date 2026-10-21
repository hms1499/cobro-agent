# Plan 4: Cobro as a real MVP — Design

- **Date:** 2026-10-20
- **Status:** Brainstormed with the user; awaiting their review of this document
- **Builds on:** `2026-10-08-cobro-design.md` (main spec), `2026-10-14-trade-approvals-design.md`
- **Deadline:** hackathon submission Mon 2026-11-09 09:00 GMT; internal target 2026-11-08
- **Mockups:** `2026-10-20-plan-4-mockups/` (HTML fragments from the brainstorm; open in a browser.
  They lack the companion's frame CSS, so headings look plain, but the mockup blocks are styled inline)

Marks used below: **(user)** = decided by the user in the brainstorm; **(builder's call)** = a
default chosen during the brainstorm that the builder may change with a reason; unmarked text is
context or a fact.

## 1. Intent

Until now Cobro was built to win hackathon tracks. The user wants Plan 4 to turn it into **a real
MVP that solves a real use case, is easy to understand and use, and is then submitted to the
hackathon (user)**. Order of priority: real use case → easy to use → submission.

Research on real products (Takenos, Bitwage, Request Finance, Payoneer/Deel, Ripio ramps, MiniPay)
showed three gaps between Cobro and products people actually use:

1. Real clients mostly pay by bank transfer, not from crypto wallets. Virtual bank accounts need a
   licensed partner and KYC, which a two-person team cannot add in 20 days.
2. Real freelancers must be able to cash out. Cobro only withdraws to the freelancer's Para wallet.
3. Real users cannot live on Para BETA.

Decision **(user)**: Cobro serves **clients who already hold stablecoins** (crypto companies, DAOs,
web3 teams) paying **LatAm freelancers**. So no bank rails on the client side. The freelancer
already receives USD₮; Cobro's value is (a) professional and recurring invoices with a clear
history, (b) an agent that keeps a local-currency spending reserve, saves the rest in dollars and
asks before selling dollars, (c) withdrawal to wherever the freelancer already cashes out (an
exchange or wallet that accepts Celo tokens).

The user confirmed this summary as matching their expectations.

## 2. Goals

1. The app is **easy to understand at a glance**, on **desktop and mobile alike (user: "not
   mobile-only")**. The user's own review found the UI cluttered ("rối mắt"); the screen review
   (§4.1) located that almost entirely on the dashboard.
2. One **tightened design system** drives every screen so colour, type, spacing, components and
   motion stay consistent **(user)**.
3. A freelancer can **withdraw to an address of their choice** safely (§5).
4. Real users sign up on **Para PROD** (§6).
5. A **landing page** that explains Cobro to freelancers and clients (§7).
6. A complete **hackathon submission** (§8).

## 3. Non-goals and anti-goals

**Out of Plan 4 (user):**
- Spanish UI (English first; Spanish later). Strings keep going through `t()` so `es.ts` can be added
  without component changes. Portuguese also out.
- Chat that drafts invoices (LLM). The form stays.
- Wallet sign-in (Para external wallets). Later, if time remains after §8.
- Virtual bank accounts, cards, fiat on/off-ramp integrations (Ripio ramps API etc.).

**Anti-goals (builder's call, derived from the conversation):**
- Never let a hijacked session send funds to a fresh address immediately (§5 exists for this).
- Never lose a user's funds or treasury access during the PROD switch.
- No crypto jargon in default views (already a MASTER.md rule; it is currently broken in places).
- No change that breaks the hackathon rules: Celo mainnet only, attribution tag on every tx we send
  (`createOperatorClient` / `signTreasuryTx`), ERC-8004 identity untouched.
- No new brand identity: the existing design system is kept and tightened, only the palette changes
  **(user)**.

## 4. Workstream 1: design system and UI redesign (first)

Use the **`frontend-design` skill** for this work **(user)**, building from
`design-system/cobro/MASTER.md`.

### 4.1 What the screen review found (production, 2026-10-20)

Screens reviewed at 390px: landing, sign-in, dashboard, invoice detail, new invoice, client pay
page, agent rules, settings, withdraw. Screenshots are in `.playwright-mcp/ux/` (gitignored, local
only).

Dashboard (main problem):
- 7 sections, about 3.5 phone screens long; "New invoice" sits about a third of the way down.
- About 8 amounts on the first screen, each with two currencies and "≈".
- Unclear or wrong copy: "Converted ≈ ARS 1,719.52 to pesos" (it was dollars to pesos), "Behind
  holding pesos", "1 of 1 requests filled", "Held by your agent"; "checks your money every 10
  minutes" is wrong (the external cron runs every 20 minutes; the string appears in several
  `en.ts` keys).
- Invoices billed in US$ show ARS first ("≈ ARS 1,622.19" large, "US$1.00" small); one shows
  "ARS 1.10 ≈ US$0.00".
- "Conversions" duplicates "What your agent did"; "Repeat clients" adds little; every activity
  item has "Why?", even "Agent paused".

Other screens:
- New invoice: the submit button sits under the fixed bottom nav until you scroll; helper text is
  technical ("Digits only, with a dot or comma before the cents").
- Settings: "Open my wallet" and "Sign out" appear only after Para loads (5–10 s) with no
  placeholder, so they look missing.
- Navigation has 3 tabs (Home, Agent, Settings) although MASTER.md specifies 4; there is no invoice
  list page, and "Back to invoices" goes to Home.

Good screens to use as the model: the client pay page (one big amount, numbered steps, one choice
per step), landing, sign-in and invoice detail.

### 4.2 Dashboard (user chose layout A; desktop A2)

Mockups: `dashboard-layout.html` (option A), `dashboard-desktop.html` (option A2), `palette.html`
(final colours on A2, option P1).

- **Top card "Your money" (user):** one large total in the local currency, the USD value small
  below, a split bar (spending reserve / savings) with direct labels, and two buttons:
  **New invoice** (the screen's only primary button) and **Withdraw** (outline).
- **One-line agent status (user saw it in the mockup):** "Agent is on · checks about every 20 min",
  with the cream accent background. The limits text, pause button and settings link move to the
  Agent tab **(builder's call)**. The interval text must not be hard-coded in several places;
  one i18n value or config **(builder's call)**. A waiting proposal still shows its banner above
  the cards (trade approvals feature; keep it).
- **"Recent" list (user):** invoices and agent actions merged, newest first, about 5 rows
  **(builder's call on the count)**. Footer links "All invoices" (→ Invoices tab) and "Agent
  history" (→ Agent tab) **(builder's call)**.
- **Desktop ≥ 1024px (user: A2):** sidebar nav on the left (as today); main area in two columns:
  left column ~330px with the money card and agent line; right column the Recent list. Below
  1024px the columns stack into option A; the bottom nav returns.
- Removed from Home: "Repeat clients", the separate "Conversions" block, per-row "Why?" on events
  that need no explanation (pause/resume) **(builder's call on which events keep "Why?")**.

### 4.3 Navigation and other screens

- **Four tabs (MASTER.md already says so):** Home, Invoices, Agent, Settings, same order on bottom
  bar and sidebar. **Invoices** is a new list page (`/app/invoices`) with all invoices.
  **Agent** = today's rules page plus the full agent history (activity feed and conversions merged)
  and the pause control and limits explanation.
- Every screen follows "one main job per screen" with the client pay page as the model
  **(builder's call)**:
  - New invoice: submit button never hidden by the fixed nav (MASTER.md already requires fixed bars
    to reserve padding); plain helper copy ("For example 1500.50").
  - Settings: skeleton placeholder where the wallet and sign-out buttons will appear.
  - Agent rules: keep content, tighten length; "Advanced settings" not hidden under the nav.
- Copy rewrite of every string named in §4.1. New wording is the builder's call within MASTER.md's
  "no jargon" rule.

### 4.4 Money display rules (update MASTER.md "Money formatting")

- An **invoice shows the currency it was billed in first** (US$1.00), the converted value second
  and small (≈ ARS 1,622) **(user agreed via mockup notes)**. This replaces the current blanket
  "local currency first" rule for invoices.
- Balances (Your money, spending, savings) keep local currency first, USD second.
- "≈" only on the secondary, converted figure, not on the headline **(user saw it in the mockup)**.
- Large local-currency headlines (ARS, BRL) drop cents **(builder's call: from 1,000 up)**; USD keeps
  cents. All formatting stays in `formatMoney` / `displayAmount`.
- Never show a converted value that rounds to zero ("≈ US$0.00"); show "< US$0.01" or omit
  **(builder's call)**.

### 4.5 Design system tightening

Keep the system, tighten it **(user)**. MASTER.md stays the source of truth and is updated in the
same branch.

**Palette (user chose these four colours and option P1):**

| Role | Value | Notes (WCAG, computed) |
|---|---|---|
| Primary (buttons, links, focus ring, active nav text) | `#086288` | 6.75:1 with white text; 6.45:1 on `#F8FAFC` |
| Secondary (outline button borders, icons, chart strokes) | `#4D8DBA` | 3.60:1 on white: icons and borders only, never body text |
| Light tint (selected nav item background, savings segment of the split bar, selected states) | `#97D7FF` | not for text; `#086288` on it is only 4.33:1, so use the tint at reduced opacity behind primary text (mockup: 35%) or bold ≥ 18px text |
| Warm accent (the few things that need attention: agent line, proposal banner, summaries) | `#FFEFC4` | dark text on it 15.6:1; used sparingly, never as page background |

- Page background stays light (`#F8FAFC`), cards white (option P1). The teal palette is replaced
  everywhere, including the chart tokens: spending = primary, savings = light tint (labelled
  directly; MASTER.md already requires direct labels).
- Money-state colours stay: success green `#15803D`, warning amber `#B45309`, destructive red
  `#DC2626` **(builder's call, shown to the user in the mockup note)**.
- Colours live only as tokens in `globals.css` (OKLCH), as today; no raw hex in components.
- Typography, spacing scale, radii and shadows unchanged.

**Motion: "like Notion" (user).** Measured on notion.site (2026-10-20): ghost items with a
transparent background; hover shows a faint tint almost instantly (`background` 20 ms ease-in, some
items 100 ms ease-in-out); press shows a slightly stronger tint; radius 4–6 px; no scale or
translate. Rules for Cobro:
- Rows, nav items, icon buttons: hover tint `rgba(primary, .06)` in ~20 ms; active `rgba(primary, .12)`.
- Buttons: background colour change in 100 ms ease-in-out; darker shade on active. No scale.
- Popovers/menus: opacity plus 4 px slide and 0.98 → 1 scale in 120 ms ease-out from the trigger's
  corner **(builder's call; not measured on Notion)**.
- Hover effects only under `@media (hover: hover)`; everything instant under
  `prefers-reduced-motion: reduce`.
- This replaces MASTER.md's current 150–250 ms hover guidance.

**Shared components (builder's call on the exact set):** today only `button`, `card`, `input`,
`label`, `skeleton` exist (plus `money`, `status-chip`, `form-field`, `copy-link`, `submit-button`).
Add at least: balance hero card, list row (invoice or agent event), page header, empty state,
loading placeholder. Screens are built from these so they stay in sync.

**Page specs:** add `design-system/cobro/pages/home.md`, `invoices.md`, `agent.md` (the folder is
empty today), per MASTER.md's own override convention.

**Verification:** MASTER.md's pre-delivery checklist, at 375 / 768 / 1024 / 1440 px, plus a
screenshot review of every app screen on desktop and mobile before merging.

## 5. Workstream 2: withdraw to an address of your choice

> **Status (2026-10-21):** built in Plan 4b (`docs/superpowers/plans/2026-10-21-plan-4b-address-book.md`).
> Email goes through Resend from `no-reply@mail.huyne.me` (free tier, 10 codes per user per day, at most
> 20 wrong code attempts per user per day). Checked end to end on localhost: emailed code, notice
> email, 24-hour wait, and a mainnet withdrawal to a saved address (tx `0x915c96bd…96dfe`, tagged). No
> exchange is named in the help text: none of Ripio, Lemon or Binance was confirmed to accept these
> tokens on Celo.

Today `encodeTreasuryCall` (`src/lib/chain/treasury-tx.ts`) only allows an ERC-20 `transfer` to the
user's `personalWallet`. That stays as the default destination.

**Address book (user approved this protection level):**
- The freelancer can save withdrawal addresses (a label and an EVM address).
- **Adding an address requires an emailed code.** Builder's call: Cobro sends its own 6-digit code
  to the account email (Para re-authentication was not investigated).
- **A new address can be used only 24 hours after it was added.**
- **Cobro emails the account address whenever a withdrawal address is added.**
- Saved addresses (past the 24 h wait) and the personal wallet withdraw immediately.
- Removing an address takes effect immediately **(builder's call)**.
- The server enforces the rule in the treasury policy (allowed recipients = personal wallet plus this
  user's saved addresses older than 24 h), not only in the UI. The agent never sends to saved
  addresses on its own; only freelancer-initiated withdrawals may **(builder's call; matches today,
  where the agent never withdraws by itself)**.
- Address validation: checksum/format; reject the zero address, the user's own treasury and known
  token contracts **(builder's call)**.
- The withdraw form shows the destination by label, the address behind "Details" (MASTER.md), and a
  plain warning that the destination must accept that token **on Celo**, or the funds can be lost.
  Which exchanges accept USD₮/wARS deposits on Celo is unverified; the builder checks the major
  LatAm options (Ripio, Lemon, Binance) and words the warning and help text accordingly.
- Every withdrawal tx keeps the attribution tag (it goes through `signTreasuryTx` as today).

**New dependency: an email service.** Cobro sends no email today. Pick a provider with a free tier
(e.g. Resend via the Vercel Marketplace); secrets follow CLAUDE.md (stdin only, never printed).
The same service sends both the code and the notification. Sending to real users needs a verified
domain: the user owns **`huyne.me` (user)**. Send from a subdomain of it (e.g. `mail.huyne.me`) so
the main domain's reputation is not affected **(builder's call)**; the user adds the DNS records the
provider asks for. The app itself stays on `cobro-agent.vercel.app` **(builder's call)**. The user
does not want unnecessary costs **(user)**: stay on free tiers and ask before anything paid.

Data: a new table for saved addresses (user, label, address, created_at, removed_at or similar)
and something to hold pending email codes; a Drizzle migration applied to the Neon dev branch and,
before deploy, to Neon main (CLAUDE.md).

## 6. Workstream 3: move real users to Para PROD

Facts (Para docs, v3 "production deployment", 2026-10-20): PROD is a separate environment; BETA
users and wallets are not accessible from PROD; 1,200 MAU free without a card; needs a PROD API key
from the Developer Portal, the production domain in Allowed Origins, HTTPS, the latest SDK. An older
v1 checklist said PROD needs a paid plan and BETA allows 50 users per project.

The user chose PROD **on the condition that it is free (user)**. If the Portal asks for billing or a
paid plan for anything Cobro needs, stop and ask the user before going on.

1. **Check first, before any code:** that PROD supports what Cobro's treasury needs: server-side
   wallet creation through the REST API with Cobro's custom id, and server signing (transactions and
   typed data). The docs page did not cover it. If PROD cannot do this, stop and bring it back to
   the user; do not work around it silently.
2. **Environments (builder's call):** production (Vercel + Neon main) moves to Para PROD;
   localhost + Neon dev branch stay on Para BETA. CLAUDE.md's "one key pair for localhost and
   production" note changes accordingly.
3. **Before switching:** move the funds out of BETA treasury wallets that hold money (the user's
   test accounts; a few USD). These are mainnet transactions, so ask the user before each one
   (CLAUDE.md).
4. **Existing production data:** user rows and treasury wallets on Neon main belong to BETA Para
   ids and become unreachable after the switch. The builder proposes how to retire them; any
   delete or truncate needs the user's explicit yes (CLAUDE.md).
5. **Portal settings in PROD:** email-only sign-in (also closes the open "turn off phone login"
   item), Cobro branding, allowed origin `https://cobro-agent.vercel.app`.
6. Production secrets go to Vercel through stdin (CLAUDE.md). Update main spec §8.4 and §15.
7. After the switch: a full sign-up on production with a new email, an invoice paid on mainnet, the
   agent's tick and a withdrawal, checked with `/celo-tx-check`.

Operator wallet, agent wallet and ERC-8004 registration are not Para wallets and are unaffected.

## 7. Workstream 4: landing page

- **Message (user):** in five seconds a freelancer understands: *send invoices to clients who pay in
  stablecoins, and your agent keeps pesos ready to spend and saves the rest in dollars.*
- **Sections (user agreed):** hero with that message and "Start with email" (primary); three steps;
  what the agent can and cannot do (limits, only your own addresses, asks before selling dollars);
  a short section for clients (pay from your own wallet in USA₮, USD₮, wARS or wBRL, no gas, no
  account). Footer: ERC-8004 agent card, GitHub repo **(builder's call)**.
- Follows MASTER.md's landing pattern and the new palette and motion; desktop and mobile.
- Signed-in visitors are already redirected from `/` to `/app`; keep that.

## 8. Workstream 5: submission

Per main spec §14 "Finish":
- README: what Cobro is, who it serves (§1), how it works, track mapping, architecture, how to
  run, where users and volume came from.
- Screenshots on desktop and mobile of the redesigned screens; demo video (the builder writes the
  script and shot list; the user records unless they say otherwise).
- `loops project create`/`update` drafted and shown to the user; never `--confirm` without their
  yes; `loops evaluate` per targeted sponsor and fixes.

## 9. Alongside the code (user's side)

Find 2–3 real freelancers and their stablecoin-paying clients to try Cobro once it runs on Para
PROD. They are also the "independent payers" the hackathon rewards. Nothing in the app depends on
this.

## 10. Constraints

- Order of work **(user):** §4 UI → §5 address book → §6 Para PROD → §7 landing → §8 submission.
  Rough calendar **(builder's call):** UI Oct 20–26, address book Oct 27–30, PROD Oct 31–Nov 2,
  landing Nov 3–4, submission Nov 5–8.
- Everything in CLAUDE.md: `cacheComponents` and Suspense rules, money as bigint, tokens only from
  `TOKENS`, Celo mainnet only, attribution tag, `t()` for every string, MASTER.md UI rules, Para CSS
  import order, secrets handling, ask before destructive DB operations and mainnet transactions,
  one branch per plan, full gate before claiming done.
- Neon Free: do not shorten the 20-minute cron.
- Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md).

## 11. Left to the builder

Component APIs and file layout; exact copy wording within the rules above; the email provider and
code storage design; the saved-address table shape; how to retire BETA production rows (proposal
to the user); the exact Recent row count; whether Plan 4 is one plan with five parts or several
smaller plans run in the order above.
