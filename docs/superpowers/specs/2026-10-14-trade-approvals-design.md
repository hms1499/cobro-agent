# Trade approvals — Design Spec

- **Date:** 2026-10-14
- **Status:** Implemented
- **Extends:** [Cobro design spec](2026-10-08-cobro-design.md) §10 (treasury) and §17 (UX)
- **Starts after:** Plan 3 Task 17 (production rollout) is finished

## 1. Problem

The treasury agent converts on its own in both directions. When the spending reserve runs low it
sells the freelancer's dollars (USD₮/USA₮) to buy the local spending token (wARS or wBRL). Some
freelancers want local money but do not want the agent to spend their dollars without asking. Today
they can only turn refills off entirely (`autoTopUp = false`) or set the reserve to 0, and the
onboarding question ("Keep [__] ARS for spending") does not say that a reserve lets the agent sell
dollars.

## 2. Goal and success criteria

The freelancer chooses how much the agent may do on its own, and approves conversions in the app.

- A rules setting `approvalMode` with three values:
  - `auto`: every conversion runs on its own (today's behaviour).
  - `sell_usd` (default): conversions that sell dollars for a local token need approval;
    local → USD₮ conversions stay automatic.
  - `all`: every conversion needs approval.
- The freelancer approves an order, not a firm quote. After approval the agent tries to fill at once
  and otherwise waits for a better price under the existing slippage rules (§10.3).
- Proposals are shown in the app only: a dashboard banner and a dot on the Agent tab. No email or chat.
- Dismissing a proposal silences that group of conversions for 24 hours.
- The agent never converts more than the approved amount.
- With `approvalMode = auto` the executor behaves exactly as it does today.

Out of scope: notifications outside the app, editing the amount before approving, approving a
specific firm quote, and approvals for withdrawals.

## 3. Conversions and modes

The engine (§10.2) produces four kinds of conversion. Dollars are USD₮ and USA₮; local tokens are
wARS and wBRL.

| Reason | Conversion | `auto` | `sell_usd` | `all` |
|---|---|---|---|---|
| `top_up` | USD₮ → local token | automatic | approval | approval |
| `hub_route` | USA₮ → USD₮ (first leg of a refill; Textile has no USA₮ → local corridor) | automatic | approval, shared with the next leg | approval, shared with the next leg |
| `save_excess` | local token → USD₮ | automatic | automatic | approval |
| `save_other` | the other local token → USD₮ | automatic | automatic | approval |

Approval groups, used for dismissal and for the shared approval:

- **Refill:** `top_up`, `hub_route`.
- **Save:** `save_excess`, `save_other`.

A refill that goes through USA₮ is shown and approved once ("~$2.10 USA₮ → ~3,000 ARS, via USD₮").
The approval of the `hub_route` intent carries over to the `top_up` intent that follows it (§5.2).

## 4. Data model

One migration. It does not delete or rewrite existing data.

- New enum `approval_mode` (`auto`, `sell_usd`, `all`).
- `rules.approval_mode approval_mode NOT NULL DEFAULT 'sell_usd'`. Existing rows take the default.
- `intent_status` gains `proposed` (`ALTER TYPE … ADD VALUE`, as in `0002_tx_status_failed.sql`).
- `fx_intents` gains:
  - `approved_amount_atomic` (atomic, nullable): the most the freelancer approved, in `from_asset` units.
  - `approved_at` (timestamptz, nullable).
  - `dismissed_at` (timestamptz, nullable).
  - `approved_via` (uuid, nullable, unique, references `fx_intents.id`): the approved `hub_route`
    intent whose approval this intent inherited. Unique, so one approval is inherited once.
- `fx_intents_one_open_uq` covers `status in ('proposed', 'waiting', 'executing')`, and the
  repository's `OPEN_STATUSES` includes `proposed`. A user never has a proposal and a running order
  at the same time.
- `AGENT_EVENT_TYPES` gains `proposed`, `approved` and `dismissed`. `agent_events.type` is text, so
  this needs no migration.

Intent lifecycle:

```
                ┌── approval not needed ───────────────────────────┐
engine: convert ┤                                                  ▼
                └── approval needed ──► proposed ──[approve]──► waiting ──► executing ──► filled
                                          │                       │
                                 [dismiss]│   need gone or        │  need gone or
                                          ▼   pair changed        ▼  pair changed
                                      cancelled               cancelled
                               (dismissed_at set → group silent for 24 h)
```

## 5. Executor

### 5.1 Run steps

`runLocked` (src/lib/treasury/executor.ts) changes as follows. The engine (`decide`) does not change.

1. Reconcile pending transactions, read rates and balances, run `decide()`. Unchanged.
2. **Dismissal.** If `approvalMode` is not `auto`, the decision is a conversion, and an intent of the
   same approval group has `dismissed_at` within the last 24 hours, treat the decision as none and
   return `idle` with detail `dismissed`. Switching to `auto` ends the silence.
3. `planIntent()`. When it plans nothing, cancel the open intent, `proposed` included, and return
   `idle`. This is how a stale proposal disappears.
4. **Approval check**, in this order:
   1. `approvalMode = auto`: not needed.
   2. The open intent has the same pair and `approved_at` set: not needed. The amount is
      `min(decision amount, approved_amount_atomic)`.
   3. The decision is a `top_up` and there is a `hub_route` intent that was approved, filled within
      the last 24 hours, and is not yet any intent's `approved_via`: the new intent is approved by
      inheritance. `approved_via` = that intent, `approved_at` = now, and `approved_amount_atomic` =
      the USD₮ that intent's filled trade(s) bought (`fx_trades.buy_amount`).
   4. Otherwise apply the mode table (§3).
5. **Approval needed:** create or update the intent with status `proposed`. The same pair keeps the
   intent id and takes the new amount. Log `proposed` once per intent (`logOncePerIntent`), not on
   amount changes. Return `awaiting_approval`.
6. Otherwise continue as today: dry run, or RFQ, price check and swap. The price-acceptance wait
   deadline (`maxWaitMinutes`) counts from `approved_at ?? created_at`, so a proposal that waited for
   hours does not skip straight to `hardMaxSlippageBps`.

`perTradeMaxUsd` and `dailyMaxUsd` still apply. Approval never lifts a cap.

The cron summary counts the new `awaiting_approval` outcome next to `idle`, `dry_run` and the others.

### 5.2 Server actions

Both actions check the session user and update with a status condition, so a stale or foreign
intent changes nothing.

- **Approve** `approveIntent(intentId, seenAmount)`:
  `UPDATE fx_intents SET status = 'waiting', approved_amount_atomic = least(seenAmount, amount_atomic),
  amount_atomic = least(seenAmount, amount_atomic), approved_at = now
  WHERE id = $1 AND user_id = <session user> AND status = 'proposed'`.
  `seenAmount` is the amount the banner showed. It can lower the cap but never raise it. When no row
  changes, the action answers "This proposal changed, have a look again". On success it logs
  `approved` and schedules a treasury run with `after()`, as the pay route does
  (src/app/api/pay/[slug]/route.ts). The wallet lock stops overlapping runs.
- **Dismiss** `dismissIntent(intentId)`: `proposed → cancelled`, sets `dismissed_at`, and logs `dismissed`.

### 5.3 Edge cases

| Situation | Behaviour |
|---|---|
| The freelancer pauses the agent while a proposal is open | The pause action cancels the proposal without setting `dismissed_at`, so there is no 24-hour silence |
| The mode changes to `auto` while a proposal is open | The next run moves it `proposed → waiting` and runs it. Choosing `auto` counts as consent |
| The mode changes from `auto` to a mode that needs approval while an unapproved intent is `waiting` | The next run moves it back to `proposed`. An `executing` intent is left to finish |
| Dry run after approval | The intent stays `waiting` and only a `dry_run` event is logged, with the existing dedupe. Cancelling it would re-propose on every run |
| The engine wants a different pair while an approved intent is open | The approved intent is cancelled and a new proposal is made. An approval never moves to another pair |
| Two tabs approve or dismiss the same proposal | The `status = 'proposed'` condition lets exactly one win. The other sees "This proposal changed" |

## 6. UI

All text goes through `t()` with keys in `src/i18n/en.ts`. Visual rules follow `MASTER.md`.

- **Dashboard banner** (`ProposalBanner`, in its own `<Suspense>`, below the greeting, where
  `SetupBanner` sits). It shows:
  - a title ("Your agent needs your approval");
  - one line with the conversion, using `displayAmount`/`formatMoney` (for example "Convert ~$2.10
    USD₮ to ~3,000 ARS to refill your spending money"; through USA₮ it adds "via USD₮");
  - why, reusing the `event.why.*` texts;
  - the price rule ("Your agent waits for a good price: at most 0.5% worse than the market").
  "Approve" is the screen's one primary button. While the banner shows, "New invoice" becomes a
  secondary link, as it does under `SetupBanner`. "Dismiss for 24 hours" is secondary. Token units,
  pair and the approved cap sit behind a "Details" disclosure. Results and errors use `aria-live` and
  `role="alert"`.
- **Agent tab dot.** `app-nav.tsx` takes a `hasProposal` prop that the layout reads inside
  `<Suspense>`. The dot carries screen-reader text ("1 proposal waiting for approval").
- **Agent status card.** A fourth state, "Waiting for your approval", next to Active, Paused and Dry run.
- **Rules page.** A radio group "When should your agent ask you?" in the main section, not under
  advanced settings, with the three modes and one-line explanations. The `autoTopUp` checkbox stays:
  it decides whether to refill at all, and the mode decides whether a refill asks first. The "If the
  agent ran now, it would…" preview says "…propose: convert X to Y (needs your approval)" when the
  mode requires it.
- **Onboarding.** One help line under the reserve field: "Your agent asks you before using dollars to
  buy ARS. You can change this on the Agent page." No new step.
- **Activity feed.** Explanations for `proposed`, `approved` and `dismissed` in `explain.ts` and `en.ts`.

## 7. Testing

Test first (TDD). The full gate is `npm test && npm run typecheck && npm run lint && npm run build`.

- **Unit (no network, no DB):** the approval check for 3 modes × 4 reasons, including the shared
  `hub_route` approval under `sell_usd`; dismissal groups and the 24-hour boundary; the wait deadline
  counting from `approved_at`.
- **DB (PGlite via `createTestDb()`):**
  - A proposal is created, keeps its id when the amount changes, and is cancelled when the need goes.
  - Approve: `seenAmount` only lowers the cap; a foreign or changed intent is refused; a double
    approve has one winner.
  - Dismiss sets `dismissed_at`; pause cancels without it.
  - Inheritance happens once, within 24 hours, capped at the USD₮ bought.
  - Mode changes: to `auto` runs the proposal; from `auto` moves `waiting → proposed` and leaves
    `executing` alone.
  - Dry run after approval keeps the intent `waiting` and does not re-propose.
  - The unique index refuses a proposal next to a running order.
- **Regression:** the existing executor tests pass unchanged with `approvalMode = auto`.
- **UI:** rules-form tests read and save `approvalMode`. Banner, buttons and the nav dot are checked
  by hand on localhost.

## 8. Rollout

1. Build on a new branch after Plan 3 Task 17. The plan number is decided when the plan is written.
2. Run the migration on the Neon dev branch first (ask before running), then on Neon main at merge.
3. After deploy, the two production accounts are in `sell_usd`. Smoke test on the smoke-A account:
   a real proposal, approve, check the swap with `/celo-tx-check`, then a dismissal.
4. Update the main spec: `approvalMode` in §10.1, the approval step in §10.2 and §10.4, the
   `proposed` status and new columns in §11, and the banner, nav dot and rules control in §17.2.
