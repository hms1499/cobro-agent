# Chat swap in the Agent tab (design)

- **Date:** 2026-11-03. **Status:** proposed; do not build until the user approves this document.
- **Marks:** **(user)** = decided by the user in the conversation; **(builder's call)** = chosen while writing this, may change with a reason; unmarked = context or fact.
- **Mockup:** option B in `.superpowers/brainstorm/62292-1793712879/content/agent-chat-layout.html` (gitignored). Layout only: where its labels and pause rule differ from this document, this document wins.

## 1. Intent

Today the agent converts money on its own, on its own schedule. Freelancers should also be able to decide for themselves and **save or move their money whenever they choose** **(user)**. The Agent tab gains a **Swap assistant**: the freelancer types something like "swap 25 USDT to wARS", reviews a card and taps Swap.

Chat is a faster way to place a swap the freelancer has already decided on. It does not give an AI control over money, and it does not pretend to be a general chatbot.

## 2. Goals, non-goals, anti-goals

**Goals**

- Keep the automatic agent and add chat **(user)**.
- Every swap passes one tap on a confirmation card **(user)**.
- Six directions: USD₮ ↔ wARS, USD₮ ↔ wBRL, USD₮ ↔ USA₮ **(user)**.
- Balance questions such as "What do I have?" **(user)**.
- A chat swap is not undone by the agent's next automatic run, and automation stays on whenever it would not undo it **(user)**.
- Every outcome tells the freelancer what happened and what they can do next **(user)**.

**Non-goals for the first version**

- Withdrawals or invoices through chat **(user)**.
- New tokens, including wCOP. A separate "save currency" setting is left out **(builder's call, recommended in the conversation; the user did not object)**.
- Stored chat history **(user)**.
- Two-step routes in one action (§4.2) **(user)**.
- Open conversation: answering "why did my agent convert?" and similar. Non-English UI: text goes through `t()` as everywhere else.

**Anti-goals: the work has failed if any of these becomes possible**

- Text from the LLM reaches signing without a code-rendered card and a tap by the signed-in freelancer.
- A chat message makes the LLM choose a recipient, token or contract outside the allowlist.
- A chat swap skips the checks automatic swaps pass: quote binding, reactor-only spender, daily limit, price limit, expiry, stored bytes before broadcast. The per-trade limit is the one deliberate exception (§4.3).
- The money path is copied. The removed local treasury tool showed how a copy drifts: it lost the Plan 9 back-off and the 30-minute drop rule within days.

## 3. Agent states

| State (shown label) | Automatic conversions | Chat and swaps | Entered by | Left by |
|---|---|---|---|---|
| **Running** | On | On | Default | A swap that needs it (§3.1), or "Pause agent" |
| **Auto-convert off** | Off | On | A swap that needs it (§3.1) | "Turn auto-convert on", or "Pause agent" |
| **Paused** | Off | Off; withdrawals still work | "Pause agent" | "Resume agent" |

The states and what each one allows are **(user)**. The labels are **(user)**: "Pause agent", "Resume agent" and "Turn auto-convert on" replace the mockup's "Pause", "Resume" and "Resume auto".

### 3.1 When a chat swap turns auto-convert off

**Only when the agent's next decision would undo the swap (user).** Example outcomes:

| Swap | Result |
|---|---|
| USD home: wARS → USD₮ | Stays on. It is what the agent would do anyway. |
| ARS home: excess wARS → USD₮, reserve still covered | Stays on. |
| ARS home: reserve wARS → USD₮, with refill on | Turns off. The agent would buy wARS back or propose it. |
| ARS home: USD₮ → wARS above the reserve | Turns off. The agent would sell it back. |
| ARS home: USD₮ → wBRL | Turns off. The agent would sell it as `save_other`. |
| USD₮ → USA₮ with the reserve covered | Stays on. |

**The check (builder's call on details):** one pure function next to `decide()`. It projects the balances after the swap and runs `decide()`, and the swap counts as undone when the resulting conversion is its exact inverse, or is a `hub_route` starting a refill of the local token the swap just sold. Two traps:

- Run it with `filledUsdWad24h` at 0, or a used-up daily cap hides a reversal that happens tomorrow.
- Zero the non-local wFiat balances the swap does not touch, and keep the local token's. `decide()` returns only its first candidate, so an unrelated `save_other` could hide the reversal, while a zeroed local token would invent a refill.

A proposal counts as undoing, because the freelancer would be asked to reverse what they just chose.

**Consent:** only a card whose swap needs it shows "Swapping turns off auto-convert. New payments stay as they arrive until you turn it back on." The check runs again at tap time. If the answer changed to "turns off" and the card did not say so, nothing trades and a refreshed card is shown.

**Timing (builder's call):** the state changes at the moment the swap transaction is first recorded for broadcast, in the same database transaction. Asking a balance, cancelling, no quote or a refused price change nothing. A broadcast that later fails still leaves auto-convert off; the freelancer can turn it back on.

**Already off:** stays off whichever swap follows.

### 3.2 Turning things back on

- "Resume agent" returns to the earlier state, so someone in Auto-convert off stays there **(builder's call)**.
- "Turn auto-convert on", and "Resume agent" when it would return to Running, first say what the agent would now do, using the same `decide()` preview as the rules page ("Your agent would convert ARS 41,250 to dollars") **(builder's call)**.

### 3.3 Storage and enforcement

- `rules.enabled` keeps meaning "Pause agent". A new nullable `rules.auto_paused_at` means Auto-convert off **(builder's call)**.
- `listTreasuryUsers` and `runTreasuryForUser` skip a user when it is set, so payment-triggered and approval-triggered runs stop too. `reconcileWallets` keeps running in every state, so a transaction already sent is always settled.
- Turning auto-convert off cancels the user's open intent, proposed or waiting. A waiting one would age while off, and the first run afterwards could accept a price up to the hard limit at once (the hazard noted in `dryRun`, `src/lib/treasury/executor.ts`). This is not a dismissal. If a proposal would be lost, the card says so.
- The server enforces every state: a message or swap while Paused is refused in the server action, not only hidden. `TREASURY_ENABLED=false` disables chat the same way. With `TREASURY_DRY_RUN=true`, chat answers and shows the card, but a tap signs nothing and says so **(builder's call)**.

## 4. Understanding a message

### 4.1 Pipeline

1. **Rule parser first** **(user)**: clear messages such as "swap 25 USDT to wARS", "swap to usdt" and "what do I have?" never reach an LLM. It runs in code and is fully testable.
2. **Groq for free-form messages** **(user: Groq only, no Gemini)**: one call with structured output, validated with zod, that returns `{ intent: "swap" | "balance" | "unknown", from, to, amount }`. Tokens must be the four pay assets, and `amount` is a decimal string or null.
3. **If Groq fails or times out** **(user)**: clear commands still work, and other messages get the "what I can do" reply below.

**What it can't understand** **(user)**: an `unknown` message gets a reply naming what the assistant can do, with tappable actions ("Save in dollars", "What do I have?", "Swap…"). The input placeholder gives an example from the first visit: "Try: swap 25 USDT to wARS".

**LLM boundaries (builder's call, following the spec's "never touches money paths"):**

- It receives only the text of the current message: no balances, addresses, rules, history or identifiers. Message contents are not logged.
- It has no tools and writes no text the user sees. Every reply comes from `t()` templates, which keeps the i18n rule and means a hostile message cannot make the app say anything misleading.
- Its output is only a draft. The card is rendered and re-validated by code.
- Message length is capped (200 characters), with a per-user rate limit on Groq calls. Before building, check Groq's current free models, limits and data terms; the model names in the main spec may be out of date.
- There is no conversation memory. "Make it 10" is answered by editing the card **(builder's call, follows from no stored history)**.

### 4.2 Which token and how much

**Direct pairs only**, from one allowlist constant. For wARS ↔ wBRL or USA₮ ↔ wARS/wBRL the reply explains the two steps and offers the first as a card **(user)**.

**No source named ("swap to usdt") (user):** candidates are the tokens the freelancer holds with a direct pair to the target, worth at least US$1.

- One candidate: its card appears at once.
- Several: one button per token with its balance; a tap opens that token's card.
- None: the reply says so and shows the balances.
- A target of wARS, wBRL or USA₮ has only USD₮ as its source.

**"Save in dollars" (user):** covers wARS and wBRL only. USA₮ is already dollars (USD home spec §2). With both held, cards appear one after another, each with its own tap, and the next appears after the previous result. Holding neither: "Your money is already in dollars." Naming USD₮ explicitly, as in "swap to usdt", can include USA₮.

**No amount given** means the whole available balance of that token, editable on the card **(user)**. For a dollar token paying gas, "available" means after the gas reserve (`spendableBalances`).

**Words:** "dollars" means USD₮ as a target. Money rules apply: the edited amount goes through `parseFiatInput` into `bigint`, never floats.

### 4.3 Limits

- **Per-trade limit: does not apply to chat (user).** The freelancer confirms each chat swap, and the limit exists to contain an automatic agent. It still applies to automatic swaps.
- **Daily limit: applies**, and shares one budget with automatic swaps **(user)**. Above what is left, the card lowers the amount and says why, with a link to change the limit in the rules, and tells them when more becomes available.
- **Minimum US$1** applies. The server re-checks everything at tap time.
- **Market depth:** an amount no maker covers ends in no quote, handled in §5.2.

## 5. From tap to result

**Card:** built from `POST /v2/rfq/preview` (unlocked estimate, no outstanding RFQ slot, not yet on `TextileRfqClient`). It shows what leaves, about what arrives and, when applicable, the auto-convert sentence (§3.1). Details holds token units. Editing the amount refreshes the estimate and the auto-convert check.

**Tap:** a server action on the Agent page (`maxDuration = 300`, as on `/app/withdraw`) follows the shape of `withdraw()` in `src/lib/treasury/withdraw.ts`:

1. `requireUser`; refuse in Paused, global off or dry run.
2. Take the wallet lock; `reconcilePending`; anything still pending answers "busy".
3. Read balances from the primary RPC; re-check the pair, amount, daily limit and auto-convert answer.
4. `ensureFeeToken`.
5. Firm RFQ with a fresh taker proof, then the same checks as `trade()`: `quoteMatches`, price, expiry before and after approval, `ensureAllowance`, store signed bytes, broadcast, receipt, `settleSwap`.

**Reuse, do not copy:** extract what chat needs from `trade()` in `src/lib/treasury/executor.ts` so both callers share it.

**Rules specific to chat:**

- **Price:** refuse above `maxSlippageBps`. There is no wait-then-accept-worse path, since the freelancer is present and can try again **(builder's call)**.
- **No retries of its own:** any refused or failed chat swap ends there. Nothing is left that a later run could execute. If built on `fx_intents`, closing the intent is part of every failure path, including `settleSwap` setting `executing` back to `waiting`.
- **One card, at most one swap:** each card carries an id stored on the trade under a unique constraint, so a double tap or a replayed request cannot trade twice **(builder's call)**.
- **Approval:** the tap is the approval; approval modes do not apply to chat **(builder's call)**.
- **USD home freelancers** may buy pesos or reais through chat, even though automation never does. It is their explicit choice, and §3.1 turns auto-convert off **(builder's call)**.

**Modelling (builder's call):** recommended is an `fx_intents` row with a new `chat` reason, already approved, because `settleSwap`, events and volume stats then work with few changes, and the row shows a swap in progress. A trade row with no intent is acceptable if the planner finds it simpler. Either way the origin must survive to the reconciliation path, because a pending swap can settle in a later cron run.

**History:** chat swaps appear as agent events with a why such as "You asked for this swap in chat". Pause, resume and auto-convert changes are also events.

### 5.1 While it runs and after a reload (user)

A swap can take over three minutes in the worst case: an RFQ up to 75 s plus up to three receipts at 45 s each.

- The card shows steps in plain words: "Getting your price", "Preparing", "Swapping". Token units and gas stay out of it.
- Chat is not stored, but **a swap in progress is**. On load the Agent page reads the database, and a swap in progress shows "A swap is in progress" and updates itself until it ends, with the result shown once.
- Closing or reloading the page must not leave the outcome unknown. The planner must verify whether a server action keeps running once the client disconnects. If that cannot be relied on, the tap starts the work in `after()` and the page polls.
- New swaps are refused with "busy" while one runs.

### 5.2 Every outcome has a next step (user)

| Outcome | The freelancer sees | Next step |
|---|---|---|
| Success | Amount sent and received, new balance of both tokens; hash in Details | Next card if "Save in dollars" has one; "View in History" |
| Success, auto-convert turned off | The same, plus what changed | "Turn auto-convert on" |
| Still confirming | "Still confirming. Your money is safe." | Updates itself (§5.1) |
| No quote | Nobody can fill this amount right now | "Try again"; a smaller amount if the depth is known |
| Price above the limit | The price moved past the limit | "Try again"; link to the price limit in the rules |
| Quote expired | The price expired before sending | "Try again" |
| Daily limit reached | When more is available | Link to change the limit |
| Not enough balance | The available balance | Card with the full balance |
| No gas | The wallet needs a little dollars to pay the network | How to add funds |
| Busy | Another transaction is finishing | "Try again" shortly |
| Swap failed on-chain | Nothing was converted, or only the network fee was paid | "Try again" |

"Try again" reuses the amount and pair without retyping, and starts with a new card id. Textile's outstanding-RFQ limit reads as Busy.

## 6. Screen

**Layout B** **(user)** on the Agent tab (`src/app/app/rules/page.tsx`):

- **Left:** the Swap assistant (not stored; a reload empties it apart from §5.1), with actions "Save in dollars" and "What do I have?" **(builder's call)**.
- **Right:** status with its controls, then a rules summary with "Edit rules", then recent history with "View all".
- **Paused:** the assistant is replaced by "Resume your agent to chat and swap".
- **Below `lg`:** status, chat, rules, history **(builder's call)**.

Whether the rules form becomes its own route or a disclosure is left to the planner. It must fit `MASTER.md`: tokens only, Phosphor icons with `aria-hidden`, `min-h-11`, `aria-live` for new replies, `role="alert"` for errors, and one primary button per screen (the card's Swap while a card is open).

**Copy that becomes wrong and must change:** `agent.state.*` and `agent.help.*` (the new state), `agent.pause` and `agent.resume`, `home.agentLine.*` (including "It won't convert anything until you resume it"), `settings.currencyConvertLine` and `settings.currencyBuyLine` (they promise a conversion that won't happen while auto-convert is off), and `agentState()` in `src/lib/treasury/view.ts`. The home page must show "Auto-convert off" with "Turn auto-convert on" so nobody forgets it **(builder's call)**.

The earlier Settings explainer ("Why does Cobro ask this?") is separate and not part of this work.

## 7. Only if time allows

Raised in the UX review and not yet accepted as requirements. Do these after everything above, or leave them out:

- When money arrives while auto-convert is off: "You received ARS X. Auto-convert is off." with a button that opens a card.
- On small screens: status as one line, chat right after it, rules and history collapsed.
- The rule parser understands "dólares", "pesos", "reais" and "reales", since LatAm users rarely type "wARS".

## 8. Delivery

- **Branch:** `plan-10-agent-chat-swap`. Task 6 of the submission plan keeps priority **(user)**.
- **Cut-off: 2026-11-07 (user).** It merges only after the full gate and a real-money check. Otherwise the submission uses the current version and this stays on the branch.
- **Migration:** additive, on Neon dev with `db:migrate` and on Neon main before deploy. The user has been running main's in the Neon SQL editor. A new enum value cannot be used in the transaction that adds it.
- **Key:** `GROQ_API_KEY`, optional in config so builds without it pass. The user adds it to `.env.local` and Vercel through stdin. Chat works without it, on the rule parser alone.
- **The demo video is final** and shows no chat; the README and Loops text describe it only if it ships.

## 9. Testing

- **Parser:** a table of messages to expected commands, including hostile and ambiguous ones, and the no-source and "Save in dollars" cases of §4.2.
- **LLM:** injected `fetch`; malformed output, unknown tokens, a timeout, and an injection attempt all end in a safe reply with no card.
- **Undo check:** the table in §3.1 as cases, plus both traps: a used-up daily cap, and an unrelated wBRL balance.
- **Swap path, in the executor's test style on PGlite:** each refusal and its §5.2 outcome; no state change without a broadcast; auto-convert off and intent cancel together; the daily limit shared with automation; no per-trade limit on chat while automatic swaps keep it; a changed auto-convert answer at tap time trades nothing; no second trade from one card id; no retry after failure; settlement by reconciliation after a missing receipt; a swap in progress visible on reload.
- **States:** the agent does nothing while auto-convert is off, including from a payment trigger. Pending transactions still settle in every state. Chat is refused server-side while Paused.
- **Real money:** one small swap per pair on Neon dev and Para BETA, then production, **each mainnet transaction only with the user's yes** (`CLAUDE.md`). Check the attribution tag with `celo-tx-check`.

## 10. Left to the builder

File layout, component structure, parser implementation, the Groq model, rate-limit mechanism, exact copy, and the form of the rules screen, all within the constraints above.
