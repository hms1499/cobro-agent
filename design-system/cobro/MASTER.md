# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/cobro/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Cobro
**Generated:** 2026-10-08 with the ui-ux-pro-max skill (`"fintech payments wallet" --design-system --variance 4 --motion 3 --density 5`)
**Customised:** 2026-10-08. The generated "Fintech/Crypto" palette (dark navy, gold, violet) was replaced
by a light teal palette chosen by the user for non-crypto users. Style, typography, spacing and
anti-patterns are kept from the skill output.
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 5/10 (Standard)
**Spec:** `docs/superpowers/specs/2026-10-08-cobro-design.md` §17

---

## Global Rules

### Color Palette (light; MVP ships light mode only)

Contrast ratios are WCAG 2.x values computed for the pair shown.

| Role | Hex | CSS Variable | Contrast |
|------|-----|--------------|----------|
| Primary (buttons, links, focus ring) | `#0F766E` | `--color-primary` | 5.47:1 with white text |
| On Primary | `#FFFFFF` | `--color-on-primary` | |
| Background | `#F8FAFC` | `--color-background` | |
| Foreground | `#0F172A` | `--color-foreground` | 17.06:1 on background |
| Card | `#FFFFFF` | `--color-card` | |
| Card Foreground | `#0F172A` | `--color-card-foreground` | |
| Muted | `#F1F5F9` | `--color-muted` | |
| Muted Foreground | `#475569` | `--color-muted-foreground` | 7.58:1 on white |
| Border (dividers, decorative) | `#E2E8F0` | `--color-border` | decorative only |
| Input border (component boundary) | `#64748B` | `--color-input` | 4.76:1 on white (needs ≥ 3:1) |
| Success (money in, protected) | `#15803D` | `--color-success` | 5.02:1 on white |
| Warning (waiting for a better price) | `#B45309` | `--color-warning` | 5.02:1 on white |
| Destructive / error | `#DC2626` | `--color-destructive` | 4.83:1 on white |
| On Destructive | `#FFFFFF` | `--color-on-destructive` | |
| Ring | `#0F766E` | `--color-ring` | 5.47:1 on white |
| Chart: spending bucket (local currency) | `#0F766E` | `--color-chart-local` | |
| Chart: savings bucket (USD) | `#1D4ED8` | `--color-chart-usd` | 6.70:1 on white |

**Color Notes:** Calm "trust teal", in the spirit of a familiar bank or payments app. Green and
amber are reserved for money states. Status is never conveyed by color alone: every status chip has an
icon and a text label. The two chart colors are close (1.22:1), so chart segments are always
labelled directly.

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
- Local currency first, USD second: `ARS 482,000` (large) above `≈ US$300.00` (small, muted).
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

---

## Component Specs

Components come from shadcn/ui (Radix base) and are themed only through the tokens above.

### Buttons

- One primary button per screen (`bg-primary text-on-primary`), radius 8px, height ≥ 44px on touch.
- Secondary buttons: outline with `--color-primary` text. Destructive actions use `--color-destructive`
  and sit apart from primary actions.
- Async buttons are disabled while pending, show a spinner and keep their width (no layout shift).
- Hover: opacity or background change over 150–200ms. No translate or scale that moves layout.

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

- CSS transitions only (no GSAP): 150–200ms for hover and press, 200–250ms for expand and collapse,
  ease-out on enter, faster ease-in on exit.
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
- [ ] Hover and press transitions of 150–250ms without layout shift
- [ ] Text contrast ≥ 4.5:1; input borders and meaningful icons ≥ 3:1
- [ ] Focus visible, tab order matches visual order, no focus hidden behind fixed bars
- [ ] Labels on all inputs, errors next to fields, `aria-live` for payment and agent status updates
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375 / 768 / 1024 / 1440px, no horizontal scroll
- [ ] Empty, loading, error and success states exist for every data view
- [ ] Lighthouse Accessibility ≥ 95 on landing, dashboard and payment page
