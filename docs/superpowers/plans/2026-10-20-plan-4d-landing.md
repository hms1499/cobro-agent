# Plan 4d: Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/` with the approved landing page: L3 hero with email capture and three true facts, the split-flap board, how it works, for clients, your agent, on-chain proof, FAQ, final call to action, footer.

**Architecture:** `src/app/page.tsx` stays a Server Component that composes section components from `src/components/landing/`. Only two pieces are client components, the flap board and the how-it-works stepper (the email capture is a plain GET form to `/signin`, so it works before hydration). Pure helpers in `src/lib/landing/` (examples, email prefill, flap cells) carry the unit tests. `/signin` reads `?email=` and passes it to Para's `openModal({ defaultAuthIdentifier })`.

**Tech Stack:** Next.js 16.4 App Router (`cacheComponents`), React 19.3, Tailwind 4 tokens from Plan 4a, Lucide, Vitest 5, Playwright MCP for the screenshot pass.

**Spec:** `docs/superpowers/specs/2026-10-20-landing-design.md` (binding), with `docs/superpowers/specs/2026-10-20-plan-4-real-mvp-design.md` §7 as background. Mockups: `docs/superpowers/specs/2026-10-20-landing-mockups/landing.html` (layout, copy, timings) and `hero-left-options.html` (L3).

## Global Constraints

- Tokens only (MASTER.md, Plan 4a): primary `#086288`, secondary accent, tint, highlight; IBM Plex Sans; IBM Plex Mono only for board digits and on-chain identifiers. No raw hex in components; the board's dark surfaces use `bg-foreground` and opacity steps of it.
- Every string through `t()` with `landing.*` keys in `src/i18n/en.ts`; every fiat amount through `formatMoney`, example figures included.
- The sign-up action is called "Start free" everywhere (nav, hero, final band).
- Example data is labelled "Example" (board header, protected-from-inflation figure); nothing reads as live activity.
- Real on-chain data: agent id from `readPublicEnv().NEXT_PUBLIC_AGENT_ID` (9884 in production), registry `IDENTITY_REGISTRY` from `src/lib/identity/registry.ts`, swap tx `0xf3a8852e9ca48432b59c981c10f1fb7321d1d595ff81e6d5c79f5c965521b00c`, tag `celo_bc3965e128ba`, repo `https://github.com/hms1499/cobro-agent`.
- Motion: hover/press per MASTER.md; the board flip and the stepper auto-advance are the only autonomous motion; both stop under `prefers-reduced-motion: reduce`; the board pauses when off-screen or the tab is hidden.
- Responsive at 375 / 768 / 1024 / 1440 px, no horizontal scroll; nav anchors hidden below 900 px.
- CLAUDE.md: Para CSS import order untouched; signed-in visitors of `/` still redirect to `/app` (proxy, unchanged); read `node_modules/next/dist/docs/` before Next.js code.
- Branch `plan-4d-landing`; full gate `npm test && npm run typecheck && npm run lint && npm run build` before any task is claimed done.

## Review Focus

1. **Odd email input** (spaces, capitals, missing "@", 300 characters, a script tag): sign-in still opens; only a plausible address is prefilled; nothing is rendered as HTML. → `prefillEmail` tests in Task 1.
2. **Reduced motion:** the board shows the first example settled and never flips; the stepper does not auto-advance. → Task 6 emulated-media check.
3. **Background tab or board scrolled away:** no flipping timers run. → Task 3 check with `document.hidden` and scroll.
4. **375 px with the longest example** ("US$1,250.00" and "ARS 350,000"): board rows fit, no horizontal scroll. → Task 6 width check; `cells` test pins the width in Task 1.
5. **Before hydration / JS off:** the hero shows a settled board and the email form still reaches `/signin?email=…`. → Task 4 `curl` check of the server HTML and the form attributes.

---

### Task 1: Landing helpers

**Files:**
- Create: `src/lib/landing/examples.ts`, `src/lib/landing/prefill.ts`, `src/lib/landing/flap.ts`
- Test: `src/lib/landing/examples.test.ts`, `src/lib/landing/prefill.test.ts`, `src/lib/landing/flap.test.ts`

**Interfaces:**
- Produces: `interface LandingExample { client: string; paid: { amount: string; currency: "USD" }; kept: { amount: string; currency: "ARS" }; saved: { amount: string; currency: "USD" } }` and `LANDING_EXAMPLES: readonly LandingExample[]` (three items: Acme / 300.00 / 200000 / 175.65; Nova Labs / 1250.00 / 350000 / 1031.80; Pixel DAO / 480.00 / 120000 / 405.25) and `EXAMPLE_ARS_PER_USD = 1600`.
- Produces: `prefillEmail(raw: string | null | undefined): string | undefined` — trimmed, lower-cased; `undefined` unless it matches one `@` with text on both sides and a dot in the domain, and is ≤ 254 characters.
- Produces: `FLAP_WIDTH = 12` and `flapCells(text: string, width = FLAP_WIDTH): string[]` — right-aligned, padded with spaces, keeps the last `width` characters if longer.

- [ ] **Step 1: Write failing tests**
  - `examples.test.ts` "each example adds up at the example rate": for every item, `Number(kept.amount) / EXAMPLE_ARS_PER_USD + Number(saved.amount)` is within 1% of `Number(paid.amount)`; `LANDING_EXAMPLES.length === 3`.
  - `prefill.test.ts` "prefills only a plausible address": `prefillEmail("  Ana@Estudio.com.ar ")` → `"ana@estudio.com.ar"`; each of `""`, `null`, `"ana"`, `"ana@local"`, `"<script>@x.y"`, `"a b@x.co"`, `"a".repeat(250) + "@x.co"` → `undefined` (whitespace, `<` and `>` are not allowed inside the address).
  - `flap.test.ts`: `flapCells("US$300.00")` → 12 items, first three `" "`, last `"0"`; `flapCells("US$1,250.00").join("")` → `" US$1,250.00"`; `flapCells("X".repeat(15)).length` → 12.
- [ ] **Step 2:** `npx vitest run src/lib/landing` → FAIL (modules missing).
- [ ] **Step 3:** Implement the three modules per Interfaces.
- [ ] **Step 4:** `npx vitest run src/lib/landing` → PASS.
- [ ] **Step 5:** Commit `feat(landing): examples, email prefill and flap cell helpers`.

### Task 2: Sign-in prefill

**Files:**
- Modify: `src/app/signin/sign-in.tsx` (the auto-open effect and the button's `openModal()` call)

**Interfaces:**
- Consumes: `prefillEmail` (Task 1).
- Produces: `/signin?email=<address>` opens the Para modal with the address filled in.

- [ ] **Step 1:** Read `node_modules/@getpara/react-sdk-lite/dist/provider/hooks/utils/useModal.d.ts` to confirm the `openModal({ defaultAuthIdentifier })` signature.
- [ ] **Step 2:** In `SignIn`, compute `const email = prefillEmail(searchParams.get("email"))` and call `openModal(email ? { defaultAuthIdentifier: email } : undefined)` in both places.
- [ ] **Step 3:** Full gate → PASS.
- [ ] **Step 4:** On `npm run dev`, open `/signin?email=ana%40estudio.com.ar` in Playwright and confirm the modal's input value is the address (read it with `browser_evaluate`); open `/signin?email=bad` and confirm the input is empty. Do not submit the form.
- [ ] **Step 5:** Commit `feat(signin): prefill the email from /signin?email=`.

### Task 3: Flap board

**Files:**
- Create: `src/components/landing/flap-board.tsx` (client)

**Interfaces:**
- Consumes: `LANDING_EXAMPLES`, `flapCells`, `FLAP_WIDTH` (Task 1); `formatMoney`.
- Produces: `FlapBoard()` — no props.

- [ ] **Step 1:** Render the first example **settled** on the server (no `useEffect` needed for the first frame), header "<client> paid an invoice" with an "Example" chip, three rows (Payment in / Kept for spending in `text-tint` / Saved in dollars in `text-highlight`), footer line; the cells are `aria-hidden` and one `sr-only` sentence from `t("landing.board.srSummary")` describes the example.
- [ ] **Step 2:** Animate in an effect: every 5,600 ms move to the next example; each row starts 450 ms after the previous; each cell shows 4–11 random glyphs from `" $0123456789.,ARSU"` at 70 ms per glyph (cell `i` starts `i × 25` ms late) with a 90 ms `rotateX` flip (CSS keyframe in the component or `globals.css`), then settles. No animation when `matchMedia("(prefers-reduced-motion: reduce)")` matches.
- [ ] **Step 3:** Pause the cycle (clear timers) when an `IntersectionObserver` reports the board out of view or `document.visibilityState === "hidden"`; resume on return. Clear everything on unmount.
- [ ] **Step 4:** Full gate → PASS.
- [ ] **Step 5:** Commit `feat(landing): split-flap board`.

### Task 4: Page sections and copy

**Files:**
- Modify: `src/app/page.tsx`, `src/i18n/en.ts`, `src/app/layout.tsx` only if `/` needs its own metadata there (prefer `page.tsx` `metadata`), `public/cobro-mark.svg` (`#0F766E` → `#086288`)
- Create: `src/components/landing/site-nav.tsx`, `hero.tsx`, `client-preview.tsx`, `agent-panel.tsx`, `onchain-proof.tsx`, `faq.tsx`, `final-cta.tsx`, `site-footer.tsx`

**Interfaces:**
- Consumes: `FlapBoard` (Task 3); `IDENTITY_REGISTRY`; `readPublicEnv`; `formatMoney`; `EXAMPLE_ARS_PER_USD` for the pay-page preview amounts (300 USD → wARS 481,649 style figures are fine as examples, but derive them, don't hand-type).
- Produces: the page in the spec's order, with a `{/* how it works */}` slot filled by Task 5.

- [ ] **Step 1:** Add `landing.*` keys for all copy, taken from the mockup and spec §3 (headline "Your clients pay in dollars. You keep pesos.", intro, "Start free", the three facts, sections, FAQ answers). Check every FAQ answer against current behaviour: "How do I cash out?" says withdraw to your Cobro wallet and send on to your exchange (the address book is not built yet).
- [ ] **Step 2:** Build the sections per the mockup with Plan 4a components and tokens. The hero email capture is `<form action="/signin" method="get">` with `<input type="email" name="email" autoComplete="email">` and a labelled field (visible label or `sr-only` label; the placeholder is not the label). The facts row reads the agent id from env; if it is missing, that fact is omitted.
- [ ] **Step 3:** On-chain rows link to Celoscan (tx), the ERC-8004 agent page or `/agent-card.json` for the identity (builder's call), and the repo; external links `target="_blank" rel="noreferrer"` with an `ExternalLink` icon `aria-hidden`.
- [ ] **Step 4:** `metadata` for `/`: title "Cobro: invoices and a treasury agent for stablecoin clients", description from `landing.meta.description`.
- [ ] **Step 5:** Full gate → PASS. Then `curl -s http://localhost:3000/ | grep -c 'action="/signin"'` → 1, and the server HTML contains `US$300.00` (Review Focus 5).
- [ ] **Step 6:** Commit `feat(landing): sections, copy and the blue mark`.

### Task 5: How it works stepper

**Files:**
- Create: `src/components/landing/how-it-works.tsx` (client)
- Modify: `src/app/page.tsx` (fill the slot)

**Interfaces:**
- Produces: `HowItWorks()` — no props.

- [ ] **Step 1:** Three steps (`<ol>`), each a button-like row (`aria-pressed` or `aria-current="step"`), with the expanded description for the active one; a pause/play button with a changing `aria-label`; three progress bars `aria-hidden`.
- [ ] **Step 2:** Auto-advance every 4,500 ms with the progress bar filling via `requestAnimationFrame`; clicking a step selects it and restarts the timer; pause keeps the bar where it is. No auto-advance under reduced motion (start paused).
- [ ] **Step 3:** The three frames as HTML from the mockup (sign-in card, invoice with payment link, agent actions); amounts through `formatMoney`.
- [ ] **Step 4:** Full gate → PASS.
- [ ] **Step 5:** Commit `feat(landing): how it works stepper`.

### Task 6: Page spec, screenshot review and ship

**Files:**
- Create: `design-system/cobro/pages/landing.md`
- Modify: `docs/superpowers/specs/2026-10-08-cobro-design.md` §17.2 Landing row (pointer to the landing spec)

- [ ] **Step 1:** Write `landing.md` (job, section order, the two motion pieces and their stop rules, the example-labelling rule).
- [ ] **Step 2:** Screenshot `/` signed out on `npm run dev` at 375, 768, 1024, 1440 px (full page and hero viewport). Compare with `landing.html`; fix differences.
- [ ] **Step 3:** Checks: `document.documentElement.scrollWidth === innerWidth` at each width (Review Focus 4); `browser_emulate_media({ reducedMotion: "reduce" })` → board settled after 6 s, stepper not advancing (Review Focus 2); scroll the board out of view for 6 s and confirm its text did not change, and set the tab hidden via `document.dispatchEvent` only if Playwright can't hide it (Review Focus 3); Tab through the page: every link, button, summary and the email field show a focus ring.
- [ ] **Step 4:** MASTER.md pre-delivery checklist; fix findings. Full gate → PASS.
- [ ] **Step 5:** Commit `docs: landing page spec`.
- [ ] **Step 6:** Final whole-branch review, fixes, then show the user desktop and mobile screenshots and wait for their OK.
- [ ] **Step 7:** On the user's OK: merge `--no-ff` into `main`, full gate on the merge, push; check production `/` serves the new page.
