# Landing (`/`) — page rules

Overrides MASTER.md where they differ. Source: `docs/superpowers/specs/2026-10-20-landing-design.md`,
mockups in `docs/superpowers/specs/2026-10-20-landing-mockups/`.

## Job

A freelancer understands in five seconds what Cobro does and starts with their email.

## Order

Nav → hero (headline, email capture, three true facts | split-flap board) → how it works → for your
clients → your agent → on-chain proof → questions → final call to action → footer.

## Rules

- One action name everywhere: "Start free". The hero form is a GET to `/signin?email=`; the sign-in page
  prefills Para only with a plausible address (`prefillEmail`).
- Only two things move on their own: the board (`FlapBoard`) and the stepper (`HowItWorks`). Both stop
  under `prefers-reduced-motion`; the board also pauses when off-screen or when the tab is hidden, and a
  paused board always shows real example figures, never random glyphs.
- Example data is labelled "Example" and adds up (`LANDING_EXAMPLES`, tested). On-chain facts are real
  and link out.
- No testimonials, logos, stats or features Cobro does not have.
- Hide elements at small widths with `max-*` variants (`max-sm:hidden`), not `hidden sm:inline-flex`:
  the shared link classes already set `inline-flex`, which would win.
