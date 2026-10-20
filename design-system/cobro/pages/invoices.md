# Invoices (`/app/invoices`) — page rules

Overrides MASTER.md where they differ. Source: Plan 4 spec §4.3.

## Job

Find any invoice and create a new one.

## Content

- `PageHeader`: "Invoices", one-line intro, New invoice (the screen's primary action).
- One card with a `ListRow` per invoice, newest first (up to 50): client name (truncates), "description,
  due/paid date", the billed amount first (`displayAmount(..., "billed")`), the status chip.
- Empty: `EmptyState` explaining what an invoice does.
- Invoice detail (`/app/invoices/[id]`) links back here with "All invoices".

## Layout

Content width `max-w-3xl`; rows never wrap the amount; no horizontal scroll at 375px.
