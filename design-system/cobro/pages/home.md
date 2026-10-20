# Home (`/app`) — page rules

Overrides MASTER.md where they differ. Source: Plan 4 spec §4.2, mockups A / A2 / P1
(`docs/superpowers/specs/2026-10-20-plan-4-mockups/`).

## Job

Answer "how much money do I have, and what do I do next?" at a glance.

## Order

1. `h1` greeting.
2. Setup banner (treasury creating or failed) and the proposal banner, when present. Either takes the
   primary role from New invoice.
3. Money card (`MoneyCard`): "Your money", the total with `Money size="xl"` (local currency lead), the
   spending / savings split bar with direct labels, New invoice (primary) and Withdraw (outline). The
   actions show even when balances are missing or fail to load.
4. Agent line (`AgentLine`): one sentence on the highlight background, linking to the Agent tab.
5. Recent (`Recent`): `buildRecent` — invoices and agent actions, newest first, five rows; footer links
   "All invoices" and "Agent history".

## Layout

- Below 1024px: one column (`grid-cols-1`, so long rows never widen the page), in the order above.
- From 1024px: two columns, `330px` and `minmax(0, 1fr)`: money card and agent line left, Recent right.
- Content width `max-w-6xl`.

## States

- Loading: skeletons shaped like the money card, the agent line and `LoadingRows`.
- Empty Recent: `EmptyState` with "Create your first invoice".
- Balances failed: `role="alert"` message inside the money card; the actions stay.
- Rates unavailable: amounts in their own currency only, no "≈".

## Not on Home

Limits, pause, value protected, full history (Agent tab); the full invoice list (Invoices tab);
repeat clients.
