# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/cobro/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Cobro
**Generated:** 2026-10-08 with the ui-ux-pro-max skill (`"fintech payments wallet" --design-system --variance 4 --motion 3 --density 5`)
**Customised:** 2026-10-20: palette replaced again by the user (Plan 4, see Color Palette). 2026-10-08: the generated "Fintech/Crypto" palette (dark navy, gold, violet) was replaced
by a light teal palette chosen by the user for non-crypto users. Style, typography, spacing and
anti-patterns are kept from the skill output.
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 5/10 (Standard)
**Spec:** `docs/superpowers/specs/2026-10-08-cobro-design.md` §17

---

## Global Rules

### Color Palette (light; MVP ships light mode only)

Contrast ratios are WCAG 2.x values computed for the pair shown. Palette chosen by the user on
2026-10-20 (Plan 4, option P1); it replaced the 2026-10-08 teal.

| Role | Hex | CSS Variable | Contrast |
|------|-----|--------------|----------|
| Primary (buttons, links, focus ring, active nav text) | `#086288` | `--color-primary` | 6.75:1 with white text; 6.45:1 on background |
| On Primary | `#FFFFFF` | `--color-primary-foreground` | |
| Secondary accent (outline button borders, icons, chart strokes) | `#4D8DBA` | `--color-secondary-accent` | 3.60:1 on white: icons and borders only, never body text |
| Tint (selected nav item, selected options, savings segment) | `#97D7FF` | `--color-tint` | not for text; behind primary text use ≤ 35% opacity (`bg-tint/35`), since `#086288` on full tint is only 4.33:1 |
| Highlight (the few things that need attention: agent line, proposal banner, summaries) | `#FFEFC4` | `--color-highlight` | foreground on it 15.6:1; sparingly, never a page background |
| Background | `#F8FAFC` | `--color-background` | |
| Foreground | `#0F172A` | `--color-foreground` | 17.06:1 on background |
| Card | `#FFFFFF` | `--color-card` | |
| Muted | `#F1F5F9` | `--color-muted` | |
| Muted Foreground | `#475569` | `--color-muted-foreground` | 7.58:1 on white |
| Border (dividers, decorative) | `#E2E8F0` | `--color-border` | decorative only |
| Input border (component boundary) | `#64748B` | `--color-input` | 4.76:1 on white (needs ≥ 3:1) |
| Success (money in, protected) | `#15803D` | `--color-success` | 5.02:1 on white |
| Warning (waiting for a better price) | `#B45309` | `--color-warning` | 5.02:1 on white |
| Destructive / error | `#DC2626` | `--color-destructive` | 4.83:1 on white |
| Chart: spending bucket (local currency) | `#086288` | `--color-chart-1` | |
| Chart: savings bucket (USD) | `#97D7FF` | `--color-chart-2` | |

**Color Notes:** Deep blue for trust, light blue for selection, a warm cream reserved for what needs
the freelancer's attention. Green, amber and red stay reserved for money states, so they never
compete with the brand blue. Status is never conveyed by color alone: every status chip has an icon
and a text label. Chart segments are always labelled directly.

In code, colors live only as shadcn semantic tokens (OKLCH CSS variables in `globals.css`). No raw hex
values appear in components.
### Typography

- **Heading Font:** IBM Plex Sans (600–700)
- **Body Font:** IBM Plex Sans (400; labels 500)
- **Mono Font:** IBM Plex Mono, only for addresses and transaction hashes inside "Details"
- **Mood:** financial, trustworthy, professional
- **Numbers:** all amounts use tabular figures (`font-variant-numeric: tabular-nums`)
- **Scale:** 12 / 14 / 16 (body, minimum on mobile) / 18 / 24 / 32 / 40; body line-height 1.5
- **Loading:** `next/font/google` with `display: swap` (no CSS `@import`)

### Money formatting

- One helper, `formatMoney(amount, currency, locale)`, built on `Intl.NumberFormat`. No component
  formats amounts by hand.
- Two figures, one large and one small: `displayAmount(amount, currency, local, rates, lead)` decides
  which is which. Never format a pair by hand.
- **Balances** (Your money, spending, savings, withdraw) lead with the local currency, USD second:
  `ARS 1,784` above `US$1.10`.
- **Invoices** lead with the currency they were billed in, exact: `US$300.00` above `≈ ARS 481,649`
  (`lead: "billed"`). An agent event names a token amount in its own currency ("Converted US$1.07 to
  pesos").
- "≈" marks only a converted, secondary figure, never the headline.
- ARS and BRL figures of 1,000 or more are shown whole (no cents) unless they are an exact billed
  amount. USD keeps cents.
- A converted figure that is above zero but rounds to 0.00 reads `< US$0.01`, never `≈ US$0.00`.
- Token names are shown as plain-language currencies: "US dollar (USA₮)", "Dollar (USD₮)",
  "Argentine peso (wARS)", "Brazilian real (wBRL)".
- Locale is `en-US` for the MVP; it comes from the i18n layer so Spanish (`es-AR`) and Portuguese
  (`pt-BR`) formatting can follow later.

### Spacing Variables

*Density: 5/10 — Standard (4/8 px rhythm)*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding, mobile gutter |
| `--space-lg` | `24px` / `1.5rem` | Card padding, section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Cards at rest |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Raised cards, dropdowns |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, sheets |

### Layout

- Mobile-first; breakpoints 375 / 768 / 1024 / 1440. Content max width `max-w-6xl`.
- App navigation: bottom bar on mobile (Home, Invoices, Agent, Settings; icon and label), sidebar at
  ≥ 1024px. Same destinations in the same order everywhere.
- Use `min-h-dvh`, not `100vh`. Fixed bars reserve padding so they never cover content or focus.
- One main job per screen: one large figure or one form, one primary action, the rest secondary.
  The client pay page is the model.
- Home at ≥ 1024px is two columns: money card and agent line on the left (~330px), Recent on the
  right. Below 1024px the columns stack in that order. Page-level rules live in `pages/*.md`.

---

## Component Specs

Components come from shadcn/ui (Radix base) and are themed only through the tokens above.

**Shared components** (`src/components/`): every screen is built from these so screens stay in
sync. `PageHeader` (title, intro, one action), `ListRow` (an invoice or agent event: title,
subtitle, amount, status), `Money` (`md` / `lg` / `xl`), `EmptyState`, `LoadingRows`, `StatusChip`.

### Buttons

- One primary button per screen (`bg-primary text-on-primary`), radius 8px, height ≥ 44px on touch.
- Secondary buttons: outline, `--color-secondary-accent` border, `--color-primary` text. Destructive actions use `--color-destructive`
  and sit apart from primary actions.
- Async buttons are disabled while pending, show a spinner and keep their width (no layout shift).
- Hover and press follow "Motion" below. No translate or scale that moves layout.

### Cards

- `bg-card`, radius 12px, padding 24px (16px on mobile), `--shadow-sm`.
- Only cards that navigate are clickable. Those get `cursor-pointer`, a hover state and a visible
  focus ring. Static cards have neither.

### Inputs

- Visible label above every field, helper text below complex fields, error text below the field and
  linked with `aria-describedby`.
- Border `--color-input`, radius 8px, font-size 16px (prevents iOS zoom), height ≥ 44px.
- Focus: 2px ring in `--color-ring` with a 2px offset. Never remove the focus outline.
- Semantic input types (`email`, `inputmode="decimal"` for amounts) and `autocomplete` attributes.

### Status chips

| State | Color | Icon (Lucide) | Label |
|-------|-------|---------------|-------|
| Paid / converted | success | `CircleCheck` | "Paid", "Converted" |
| Open / waiting | warning | `Clock` | "Open", "Waiting for a better rate" |
| Failed / blocked | destructive | `CircleAlert` | "Failed", "Needs your attention" |
| Agent paused / dry run | muted | `Pause` / `FlaskConical` | "Paused", "Dry run" |

### Modals and sheets

- Overlay `rgba(15,23,42,0.5)`; bottom sheet on mobile, centered dialog (max 500px) on desktop.
- Always a visible close button and Escape to close; confirm before closing with unsaved changes.

### Icons

- Lucide (`lucide-react`, shipped with shadcn), 1.5–2px stroke, sizes 16 / 20 / 24 as tokens.
- Decorative icons next to text get `aria-hidden="true"`; icon-only buttons get an `aria-label`.
- No emojis as icons.

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Key Effects:** Subtle hover (150–250ms), smooth state transitions, light shadows, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** Trust & Authority + Conversion (adapted)

- **Landing section order:** Hero (promise + "Start with email") > How it works (3 steps) > Trust
  (what the agent can and cannot do, ERC-8004 identity link, on-chain receipts) > Final CTA.
- **CTA:** "Start with email" (primary) in hero and final section; nav has "Sign in".
- **App screens:** progressive disclosure. Advanced settings stay collapsed; details (hashes,
  addresses) sit behind "Details".

---

## Motion

Notion-like, measured on notion.site on 2026-10-20: transparent "ghost" items, a faint tint that
appears almost at once on hover, a slightly stronger one on press, radius 4–8px, nothing moves.

- Rows, nav items, icon buttons: the `.hover-tint` utility (`globals.css`): primary at 6% on hover in
  ~20ms ease-in, 12% on press. Hover applies only under `@media (hover: hover)`.
- Buttons: background colour change in 100ms ease-in-out, a darker shade on press. No scale, no
  translate.
- Popovers and menus: opacity, a 4px slide and 0.98 → 1 scale in 120ms ease-out, from the trigger's
  corner. Expand and collapse 200–250ms.
- CSS transitions only (no GSAP).
- Animate `opacity` and `transform` only. At most one or two animated elements per view.
- Under `prefers-reduced-motion: reduce`, transitions drop to instant state changes, and skeletons stop pulsing.
- Loading: skeletons for content longer than about 300ms; button spinners for actions.

---

## Anti-Patterns (Do NOT Use)

- ❌ Playful design
- ❌ Unclear fees (always state "No network fee — you only sign" or the exact fee)
- ❌ AI purple/pink gradients
- ❌ Crypto jargon in default views (gas, Permit2, nonce, raw token units, raw addresses)
- ❌ Token amounts without the local-currency value next to them
- ❌ Status conveyed by color alone

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Lucide)
- ❌ **Missing cursor:pointer** on clickable elements, or cursor:pointer on static ones
- ❌ **Layout-shifting hovers** — No scale or translate that moves surrounding content
- ❌ **Low contrast text** — Maintain 4.5:1 minimum (3:1 for input borders and icons that carry meaning)
- ❌ **Invisible focus states** — Focus must always be visible
- ❌ **Placeholder-only labels**

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (Lucide only)
- [ ] Colors come from tokens; no raw hex in components
- [ ] Every amount goes through `formatMoney`; local currency first, USD second
- [ ] `cursor-pointer` on clickable elements only
- [ ] Hover tint and press feedback per "Motion", without layout shift
- [ ] Text contrast ≥ 4.5:1; input borders and meaningful icons ≥ 3:1
- [ ] Focus visible, tab order matches visual order, no focus hidden behind fixed bars
- [ ] Labels on all inputs, errors next to fields, `aria-live` for payment and agent status updates
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375 / 768 / 1024 / 1440px, no horizontal scroll
- [ ] Empty, loading, error and success states exist for every data view
- [ ] Lighthouse Accessibility ≥ 95 on landing, dashboard and payment page
