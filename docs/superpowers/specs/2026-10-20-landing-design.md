# Cobro landing page — Design

- **Date:** 2026-10-20
- **Status:** Brainstormed with the user; awaiting their review
- **Replaces:** Plan 4 spec (`2026-10-20-plan-4-real-mvp-design.md`) §7 "Workstream 4: landing page".
  Everything there still holds unless this document says otherwise.
- **Order (user):** the landing page now comes **before** the address book (§5) and Para PROD (§6).
- **Mockups:** `2026-10-20-landing-mockups/` — `landing.html` (whole page, hero board animated),
  `hero-left-options.html` (option L3 chosen), `hero-motion-options.html` (option C chosen). Open them
  in a browser; they are static HTML with inline CSS and JS.

Marks: **(user)** = decided by the user; **(builder's call)** = a default the builder may change with a
reason; unmarked = context or fact.

## 1. Intent

The user wants a landing page as professional as https://www.qash.finance/ **(user)**, liked all of its
sections, and asked for a senior frontend recommendation on what Cobro can honestly build. Qash is a
direct competitor (a stablecoin business account for Web3 teams in LatAm, SEA and Africa), so the page
learns from its layout and restraint but **keeps Cobro's own identity** (palette, IBM Plex, MASTER.md
motion) and does not copy its visuals **(builder's call, shown to and accepted by the user)**.

The page must make a freelancer understand in five seconds: *send invoices to clients who pay in
stablecoins; your agent keeps pesos ready to spend and saves the rest in dollars* (Plan 4 spec §7, user).

## 2. Goals, non-goals, anti-goals

Goals: one page at `/` that explains Cobro to freelancers and to their clients, looks professional on
desktop and mobile, has one signature animation, and turns a visitor into a sign-in.

Non-goals (user accepted the recommendation): testimonials, partner logos, usage stats, a journal or
blog, a country-flag marquee, a "More than banking" feature grid, pinned/scroll-jacked sections,
photographic backgrounds, an interactive product demo.

Anti-goals:
- No invented social proof or invented live activity. Example figures are labelled as examples.
- No feature Cobro does not have (yield, runway, cards, bank payouts).
- No layout shift or scroll-jacking; the page stays fast and keyboard-usable.

## 3. Sections, in order (user approved the mockup)

1. **Nav:** Cobro mark + wordmark; anchors How it works, For clients, Questions; Sign in; primary
   "Start free". Anchors hide below 900 px **(builder's call)**. The sign-up action has one name
   everywhere, "Start free" (nav, hero, final band), since Cobro charges nothing to send invoices
   **(builder's call)**.
2. **Hero, left: option L3 (user).**
   - Headline: "Your clients pay in dollars. You keep pesos." Very large, tight tracking.
   - One-line intro: "Invoices for stablecoin clients, and an agent that splits every payment within
     your rules."
   - **Email capture:** an email field and "Start free". Submitting goes to `/signin?email=<value>`;
     the sign-in page opens the Para modal with that email prefilled through
     `openModal({ defaultAuthIdentifier })` (exists in `@getpara/react-sdk-lite`, `useModal`). An empty
     or invalid email still goes to `/signin` (Para validates) **(builder's call)**.
   - **Three true facts** under it, separated by hairlines: "4 currencies clients can pay in",
     "US$0 network fee for your client", "#9884 agent identity on Celo" (ERC-8004 agent id 9884 from
     `/agent-card.json`; read it from config or the agent card, don't hard-code twice).
3. **Hero, right: the split-flap board, option C (user), in place of the "Your money" card (user).**
   - A dark board (`--fg`-based, not a new colour token unless MASTER.md gets one) with three rows:
     "Payment in", "Kept for spending" (tint digits), "Saved in dollars" (highlight digits), a header
     line "<client> paid an invoice" and a footer line "Your agent split it in 4 seconds, within your
     rules."
   - Every ~5.6 s a new example payment: characters flip through random glyphs for ~0.3–0.9 s and
     settle, row by row with ~450 ms between rows (mockup timings).
   - **Labelled as an example** (e.g. "Example" in the header) so it never reads as live data
     **(builder's call, required by the anti-goal)**. Example values must be internally consistent
     with a plausible ARS rate and the reserve logic (mockup: US$300.00 → ARS 200,000 kept + US$175.65
     saved at ~1,600 ARS/USD).
   - Accessibility: the board is `aria-hidden` for its changing glyphs, with one fixed sentence for
     screen readers; it does not announce each change. Under `prefers-reduced-motion: reduce` it shows
     the first example, settled, and never flips.
   - Pause flipping when the hero is off-screen (IntersectionObserver) and when the tab is hidden
     **(builder's call)**.
4. **How it works:** three steps that auto-advance every ~4.5 s with progress bars and a pause/play
   button; clicking a step selects it. Each step shows a UI frame built in HTML (not screenshots):
   sign-in card, invoice with payment link, agent actions (a saved-in-dollars entry and an "asks first"
   proposal). Reduced motion: no auto-advance.
5. **For your clients:** text with three points (four currencies, 10-minute locked rate, one link for
   repeat invoices) beside a pay-page preview (stepper, four options, "No network fee. You only sign.").
6. **Your agent:** a full-width dark panel (spending vs savings, with an **example** "Protected from
   inflation" figure, labelled as such) and three cards below: asks before selling dollars; hard limits;
   money goes only to you.
7. **On-chain proof ("Don't take our word for it"):** three linked rows, real data — ERC-8004 agent
   #9884 on Celo (registry `eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`); first autonomous
   conversion Oct 14, 2026, 1.07 USD₮ → 1,718 wARS, swap tx
   `0xf3a8852e9ca48432b59c981c10f1fb7321d1d595ff81e6d5c79f5c965521b00c` on Celoscan; every transaction
   tagged `celo_bc3965e128ba`. Links open in a new tab.
8. **FAQ:** five native `<details>` items: Is Cobro a bank? What does it cost? Which currencies can
   my clients use? What if the agent makes a bad trade? How do I cash out? Copy from the mockup,
   checked against what the product does at build time (e.g. cash-out wording changes once the
   address book ships).
9. **Final call to action:** primary-blue band, "Send your first invoice today", highlight-coloured
   "Start free" button.
10. **Footer:** one-line description; links Agent card, GitHub repo, Sign in.

## 4. Visual and motion rules

- Palette, type and tokens from `design-system/cobro/MASTER.md` (Plan 4a). IBM Plex Sans; IBM Plex Mono
  only for the board digits and on-chain identifiers.
- Hover and press follow MASTER.md "Motion" (Notion-like tints). The board flip and the hero's
  step auto-advance are the page's only autonomous motion **(builder's call; the user asked for one
  signature moment, and chose the board)**.
- Responsive at 375 / 768 / 1024 / 1440 px; no horizontal scroll; the board's cells shrink below
  480 px (mockup).
- Every string through `t()` in `en.ts`; every displayed fiat amount through `formatMoney` (example
  figures included) **(builder's call: keeps the rule absolute)**.
- Add `design-system/cobro/pages/landing.md`.

## 5. Also in this work

- `public/cobro-mark.svg` still uses the old teal `#0F766E`; change it to `#086288` (it is the
  ERC-8004 agent card image and the favicon source). Plan 4a missed it.
- Signed-in visitors of `/` are already redirected to `/app`; keep that.
- Metadata: title and description for `/`, and an Open Graph image if cheap **(builder's call)**.

## 6. Left to the builder

Component split, whether the board is a client component with a server-rendered first frame, exact
copy within the mockup's meaning, the example scenarios (three, consistent), the Open Graph image, and
how the agent id reaches the page.
