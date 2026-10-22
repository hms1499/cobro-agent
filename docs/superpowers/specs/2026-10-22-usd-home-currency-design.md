# USD as a home currency (design)

- **Date:** 2026-10-22. Runs before Plan 4e (submission) **(user)**.
- Marks: **(user)** = decided by the user in the conversation; **(builder's call)** = chosen by the
  builder during the conversation, may change with a reason; unmarked = context or fact.

## 1. Intent

Today onboarding asks "What do you spend in?" and offers only Argentine pesos or Brazilian reais.
The whole treasury model assumes a local spending currency: the agent keeps a peso/real spending
reserve and saves the rest in dollars. The user wants **freelancers who live in dollars** to use
Cobro too **(user)**: people in dollarised countries (Ecuador, El Salvador) or anyone who wants to
hold only dollars and cash out on an exchange when they need to. For them Cobro is professional
invoices, a payment link, totals and withdrawals; the agent has one small job.

## 2. Decisions

1. Onboarding offers **US dollars (USD)** next to ARS and BRL, and **USD is the pre-selected option**
   **(user: "đặt cho USD là mặc định")**. With USD there is no spending reserve, so the reserve field
   is hidden.
2. For a USD freelancer the agent **only converts wARS and wBRL into USD₮** **(user)**. It never keeps
   a peso/real reserve and never buys pesos/reais. USA₮ and USD₮ are both dollars and stay as they
   are **(builder's call)**.
3. Those conversions run **without asking**, whatever approval mode is stored **(builder's call,
   stated in the conversation, not contradicted)**: selling pesos for dollars is the safe direction,
   and the approval choice is hidden for USD freelancers. The stored mode is kept for a later switch
   back to ARS/BRL.
4. The home currency can be **changed later in Settings** **(user)**.
5. When someone switches to USD while holding wARS/wBRL, the agent **converts those balances to USD₮
   on its next run**; Settings warns first, with the amounts, and says "withdraw first if you want to
   keep them" **(user agreed to the builder's recommendation)**. Balances worth less than US$1 stay
   (Textile refuses RFQs under $1) and show in the balance card so they can be withdrawn.
6. Switching from USD to ARS/BRL asks for the spending reserve in the same Settings form; after that
   the agent behaves as today (buys the local currency up to the reserve, asking first per the stored
   approval mode) **(builder's call, stated in the conversation, not contradicted)**.
7. Existing ARS/BRL freelancers see no change.

## 3. Non-goals and anti-goals

- No new pay tokens, no new Textile pairs, no change to x402, Para, withdrawals or the cron.
- No change to how invoices are billed: invoices can still be USD, ARS or BRL.
- No "frozen pesos" state: pesos held by a USD freelancer are always meant to become dollars.
- Anti-goals: a USD freelancer seeing "≈ ARS" figures or peso wording ("spending reserve", "protected
  from inflation", "buy pesos"); the agent buying local currency for a USD freelancer; a currency
  switch silently moving money without the warning; any change for existing ARS/BRL users; breaking
  the attribution tag, mainnet-only or `TOKENS` rules (CLAUDE.md).

## 4. Shape of the change

### 4.1 Data

- `local_currency` enum gains `USD` (migration 0007, `ALTER TYPE … ADD VALUE`). Applied to Neon dev,
  then Neon **main before the deploy** (same order as migration 0006: code that can write `USD` must
  not reach production first).
- A new type for "what the freelancer lives in": `HomeCurrency = "USD" | LocalCurrency`
  **(builder's call)**. `LocalCurrency` (ARS | BRL) keeps meaning "a currency with a spending token",
  so `LOCAL_ASSET`, Textile pairs and the reserve logic stay typed as today. `rules.localCurrency`
  and `AppUser.localCurrency` become `HomeCurrency`. A null value still means "not onboarded".
- `rules.reserveAmount` is stored as `0` for USD.

### 4.2 Agent (engine)

- `decide()` for home USD: if wARS ≥ $1 → convert wARS → USD₮; else if wBRL ≥ $1 → convert wBRL →
  USD₮ (reason `save_other`, same sizing, per-trade and daily caps as today); else idle
  `within_band`. Nothing else.
- Everything that maps the home currency to a spending token today (`LOCAL_ASSET` in the treasury
  view, the executor's engine input, the P&L "protected from inflation" figure) needs a USD branch:
  no spending bucket, no reserve, no protected figure (hidden) **(builder's check of the code)**.
- No approval for home USD (decision 3). Open proposals and waiting intents are cancelled when the
  home currency changes, as when the agent is paused.
- Explanations (`describeDecision`, events, Agent preview) use the existing `save_other` wording; the
  preview for an idle USD freelancer says the agent has nothing to convert.

### 4.3 Screens

- **Onboarding:** the currency choice lists USD first, pre-selected; choosing USD hides the reserve
  field and its help text; the line about "asks you before using dollars to buy …" is hidden for USD.
- **Home money card:** for USD one figure (dollars) and one pocket "Dollars"; a second row "Waiting
  to convert" only when wARS/wBRL balances exist. No reserve bar.
- **Money display:** figures lead with the home currency. For USD: USD figures show alone (no "≈"),
  invoices billed in ARS/BRL show the billed amount first and "≈ US$…" second. Summary cards sum in
  USD (already supported by `summarizeInvoices(…, "USD")`).
- **Agent page:** for USD the rules form, approval choices and "Protected from inflation" card are
  replaced by one explanation ("Your agent converts any pesos or reais you receive into dollars.")
  plus status and history.
- **Settings:** "Spending currency" becomes editable: a small form with the three choices and, for
  ARS/BRL, the reserve field. Before saving a switch it shows what will happen (decision 5/6) with
  the actual wARS/wBRL amounts, and needs a confirm. Saving cancels proposals and logs an event.
- **Withdraw:** unchanged behaviour; amounts lead with the home currency.

## 5. Constraints

CLAUDE.md rules (Suspense around request data, money as bigint/strings, `formatMoney`/
`displayAmount`, `TOKENS` only, `t()` for every string, MASTER.md UI rules, one primary button,
attribution tag, ask before mainnet transactions and production DB writes). Tests: engine decisions
for USD (wARS, wBRL, both, under $1, USA₮ untouched, caps), onboarding parse with USD and no reserve,
display for USD home, the currency-switch action (cancels proposals, stores reserve 0 for USD). Full
gate before merge. Deadline pressure: hackathon submission 2026-11-09.

## 6. Left to the builder

Component and file layout; exact copy; whether the switch form lives on the Settings page or its own
route; how the warning reads balances (live chain read, as the money card does); whether a switch
while an intent is executing is refused with a message or allowed; the event type name for a
currency change.
