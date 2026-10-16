# Cobro — Design Spec

- **Date:** 2026-10-08
- **Status:** Approved in brainstorming; awaiting written-spec review
- **Event:** Celo "Agents on Open Rails" hackathon — https://www.loops.house/agents-on-open-rails
- **Deadline:** registration + submission Mon 2026-11-09 09:00 GMT (16:00 Vietnam). Internal target: submit 2026-11-08.

## 1. Summary

Cobro is an invoicing and treasury agent for Latin American freelancers. A freelancer signs in with
email, creates an invoice (by chat or form) and shares a payment link. Clients pay through x402 in
USA₮, USD₮, wARS or wBRL from their own wallets, gaslessly. Funds land in a treasury wallet that the
agent manages: following rules the freelancer sets, it keeps a local-currency spending reserve and
moves the excess into USD₮ through Textile FX, executing only at acceptable prices. Every decision is
logged and explained, and the dashboard reports how much value was protected compared with holding pesos.

## 2. Goals and success criteria

Goal: win prizes in several tracks with one product, built by a two-person team (user + Claude)
on a budget of $20–100 of mainnet funds and $0 for LLM usage.

The MVP is done when all of the following are true on **Celo mainnet**:

1. The Cobro agent has its own ERC-8004 identity, registered from the declared agent wallet, and its
   agent card is served by the app.
2. Every transaction the app broadcasts carries the team's ERC-8021 attribution code, verified with
   `verifyTx` from `@celo/attribution-tags`.
3. At least one invoice has been paid in USA₮ through Celo's x402 facilitator and at least one in wARS or wBRL.
4. The agent has executed Textile FX swaps on its own, following a freelancer's rules, and recorded P&L for each.
5. A person who has never used crypto can sign up with email, create an invoice and follow what the
   agent did, without help.
6. The submission (public repo, README, demo video) is complete by 2026-11-08.

Stretch goal: three or more independent payers (see §14 for the definition).

## 3. Hackathon constraints that shape the design

- Only Celo mainnet activity counts. Testnet references in the repo are fine.
- ERC-8004 identity is required for all tracks.
- The attribution tag must be in calldata before the first transaction we want counted. Tags cannot be
  added retroactively. Loops House issues the tag at enrollment; read it with
  `loops project get --event agents-on-open-rails` (`celo.attributionTag`). Never derive it with
  `codeFromRepo` or `codeFromHostname`.
- The entry needs an `agent-wallet`: the public address the agent sends its transactions from. It must
  register the ERC-8004 identity. Loops scans it for the first tagged transaction in the event window.
  Ours is `0x64ad61211c1b0b7f20b3e04b49661f30f152ae78`, the user's existing EOA (see §8.7).
- Submission fields (from `loops project fields`): name, description, repo URL, at least one
  screenshot, demo URL and agent wallet are required; logo and walkthrough video are optional.
- The GitHub repo must be public at registration and still resolve at judging.
- Code must be written during the hackathon (kick-off 2026-10-06).
- An "independent user" is a wallet that is not ours, was not first funded by us, and had Celo activity
  before 2026-10-06. Onboarding new users is allowed and encouraged, but the submission must explain
  where users and volume came from.
- Sponsored gas is not counted as builder contribution. Signers and authorisers are counted.

## 4. Track mapping

| Track | Prize | What Cobro shows |
|---|---|---|
| 1. Stable Agents: LatAm (Ripio) | $1,500 / $500 | Real wARS/wBRL received and held on mainnet; an autonomous treasury agent protecting freelancers from inflation; email sign-in usable by non-crypto people; amounts shown in the user's own currency |
| 2. Open Corridors: Textile FX | $750 / $250 | Every conversion is a Textile RFQ swap we broadcast (tagged); price-guarded execution with wait-and-retry; P&L reporting |
| 3. Open Corridors: USA₮ with x402 | $750 / $250 | US clients pay invoices in USA₮ through Celo's x402 facilitator to LatAm freelancers; recurring invoices produce repeat payments from the same client. Currency choice: a US-regulated dollar stablecoin for the payer, local currency or USD₮ for the payee |

Judging weights that shape the build (from the Loops event data):
- Track 1 scores five equal criteria: mainnet with a real wFIAT token, real use of wFIAT and the Celo
  stack (ERC-8004, x402, gas paid in stablecoins), agent autonomy with guardrails, UX for someone new
  to crypto with amounts in their own currency, and LatAm impact with a named user.
- Track 2 scores the P&L (40%) and volume (30%) of a **quoting** (maker/filler) strategy, plus
  originality (30%), which explicitly includes "a treasury agent managing a business's own currency
  exposure". Cobro is a taker, so it competes mainly on originality. Decision (2026-10-08): enter
  anyway, with no maker module in the MVP; revisit a filler module only if weeks 1–3 finish early.
- Track 3 scores real settlement, a named counterparty outside the team, repeat flow from the same
  counterparty, and why USA₮ suits that user (25% each).

Track 4 ("Build with buy") is out of scope for the MVP.

## 5. Scope

**In scope (MVP):**
- Email sign-in (Para), personal wallet + agent-managed treasury wallet per freelancer.
- Invoices in USD, ARS or BRL; public payment page; x402 payment in USA₮, USDT, wARS, wBRL.
- Recurring invoices (weekly or monthly) with a stable client link.
- Amounts shown in the freelancer's local currency first, USD second.
- Admin page for the agent wallet: register Cobro's ERC-8004 identity and send tagged transactions
  signed in the owner's browser wallet.
- Treasury rules, decision engine, Textile RFQ executor, scheduled and payment-triggered runs.
- Dashboard: balances, invoices, conversions, P&L, activity feed with explanations.
- Withdrawal from the treasury wallet to the freelancer's personal wallet.
- Chat that turns natural language into invoice drafts (Gemini, Groq fallback).
- ERC-8004 registration script and agent card.
- English UI; every user-facing string in `src/i18n/en.ts`.
- UX and visual design per §17 and `design-system/cobro/MASTER.md`.

**Out of scope (only if time remains):** Spanish/Portuguese UI (`es.ts`), Telegram bot, email reminders
to clients, a Textile maker/filler module, MiniPay mini-app packaging, Track 4/buy, wMXN, wCOP,
wPEN, wCLP, USDC payments, ERC-8004 reputation feedback.

USDC is left out on purpose: Textile currently has no bid on USDC→USDT on Celo, so the agent could
not convert USDC that it receives.

## 6. Users and flows

### 6.1 Wallet model

Each freelancer has two wallets:

- **Personal wallet:** created by Para's client SDK when the freelancer signs in with email. The
  freelancer owns it. The server cannot sign with it. It is the only withdrawal destination.
- **Treasury wallet:** an app-owned wallet created through Para's REST API. Clients pay into it. The
  agent signs with it to swap on Textile and to send funds to the personal wallet, and nothing else.
  The executor enforces this in code (`encodeTreasuryCall`). Para Guardrails were meant to enforce it
  again inside Para's enclave, but the spike found them not enforced for REST signing (§8.4).

### 6.2 Flows

1. **Sign-in.** Freelancer signs in with email (Para modal). On first sign-in the server creates the
   treasury wallet; onboarding then saves the rules. Nothing is dripped at sign-in: the treasury pays
   gas in stablecoins and gets an operator drip only when it holds none (§8.6).
2. **Create invoice.** Freelancer types, for example, "Bill Acme 300 USD for the logo, due Friday", or
   fills the form. The LLM returns a structured draft and the freelancer confirms it. Output: a link
   `/pay/<slug>`. A recurring invoice ("Bill Acme 100 USD every week for maintenance") produces a
   stable link `/r/<slug>` that always opens the current period's invoice (§9.1).
3. **Client pays.** Client opens the link, connects a browser wallet (MetaMask, Rabby, MiniPay
   in-app browser), and picks USA₮, USDT, wARS or wBRL. The page shows the amount in that token, with
   the rate locked for 10 minutes. The client signs the x402 payment (no gas). Funds settle into the
   treasury wallet and the invoice becomes paid.
4. **Agent manages funds.** After each payment and on every cron run, the treasury engine compares
   balances with the rules and creates, executes or waits on conversions (§10). The cron is scheduled
   every 10 minutes but GitHub runs it every 2–5 hours in practice (§7.1).
5. **Dashboard and withdrawal.** Freelancer sees balances, invoices, conversions, P&L and the activity
   feed, and can withdraw any treasury balance to the personal wallet. Every amount is shown in the
   freelancer's local currency (ARS or BRL) first, with the USD value next to it, using the Textile
   reference rate.

## 7. Architecture

### 7.1 Stack

| Concern | Choice |
|---|---|
| App, API, UI | Next.js (App Router) + TypeScript, deployed on Vercel Hobby (free) |
| Database | Neon Postgres (free tier) + Drizzle ORM |
| Scheduler | cron-job.org (free) calls `POST /api/cron/treasury?mode=async` every 5 minutes with a bearer secret; the route answers 202 and runs the tick in `after()` (cron-job.org waits 30 s at most). GitHub Actions calls the same route without `mode` as the backup trigger and the alert: it runs inline and the workflow fails, emailing the owner, when the tick reports errors. GitHub delays its scheduled runs to every 2–5 hours (measured 2026-10-13 to 10-15). A payment also runs the agent at once through `after()` |
| Chain access | viem (Celo mainnet, chain id 42220) |
| Payer wallets | wagmi with the injected connector |
| x402 | `@x402/next` or `@x402/core` server + `@x402/evm`, `@x402/fetch` in the browser (v2 packages, ≥ 2.26.0) |
| LLM | AI SDK with `@ai-sdk/google` (Gemini free tier) and `@ai-sdk/groq` (fallback) |
| Tests | Vitest |
| Runtime | Node.js 24 |

### 7.2 Modules

Each module has one job and a small interface. Modules talk only through those interfaces.

```
src/lib/
  chain/      Celo clients, token registry, attribution suffix applied to every tx we send
  signer/     TreasurySigner interface
                para.ts       Para REST app-owned wallet (default)
                local-key.ts  encrypted server-held key (fallback if the Para spike fails)
  payments/   x402: per-invoice payment requirements, quote locking, verify/settle via the facilitator
  fx/         Textile: rates feed (reference), RFQ preview/request/submit/cancel/status, swap execution
  treasury/   engine.ts   pure decision function, no I/O
              executor.ts carries out decisions, writes the DB
  agent/      LLM: chat → invoice draft, optional longer explanations. Has no tool that moves money.
  identity/   ERC-8004 registration helpers and the agent card
  db/         Drizzle schema and queries
  i18n/       en.ts dictionary and t() helper
scripts/      register-agent.ts, smoke tests
```

`TreasurySigner`:

```ts
interface TreasurySigner {
  address: Address
  signTransaction(tx: TransactionRequest): Promise<Hex> // returns a serialized signed tx
  signTypedData(data: TypedDataDefinition): Promise<Hex>
}
```

The rest of the app depends only on this interface, so switching from Para to the local-key fallback
changes one file and one config value.

### 7.3 Main data flow

```
Client --(1) GET /pay/<slug>, picks token--> GET /api/pay/<slug>?asset=X --> 402 (amount, asset, payTo = treasury wallet)
Client --(2) signs x402 payload----------->  same route --> facilitator /verify + /settle --> funds in treasury wallet
                                                 \--(3) record payment, mark invoice paid, schedule treasury run (after response)

Treasury run (after a payment, or every 10 min via GitHub Actions):
  balances + rules + Textile reference rates --> engine --> decision
  decision = convert --> RFQ request --> price check --> approve if needed --> sign swap --> broadcast (tagged) --> submit hash --> record
```

### 7.4 Pages

- `/`: landing page.
- `/app`: dashboard (both wallets' balances, invoices, conversions, P&L, activity feed).
- `/app/chat`: chat with the agent.
- `/app/rules`: treasury rules.
- `/app/invoices/new`: invoice form (also the LLM fallback).
- `/pay/[slug]`: public payment page.
- `/r/[slug]`: stable link of a recurring invoice; redirects to the current period's `/pay/[slug]`.
- `/agent-card.json`: ERC-8004 registration file.
- `/admin/agent`: owner-only page (§8.7). The agent wallet connects with a browser wallet to register
  the identity and send tagged transactions. Access requires a connected wallet equal to `AGENT_WALLET`.

## 8. Integrations (facts checked on 2026-10-08)

### 8.1 Tokens on Celo mainnet

| Token | Address | Decimals | x402 transfer method | Notes |
|---|---|---|---|---|
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 | EIP-3009 | EIP-712 `{ name: "Tether USD", version: "1" }` |
| USA₮ (USAT) | `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` | 6 | EIP-3009 | EIP-712 `{ name: "Tether America USD", version: "1" }` |
| wARS | `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D` | 18 | Permit2 | EIP-712 `{ name: "Peso Argentino", version: "1" }` |
| wBRL | `0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0` | 18 | Permit2 | EIP-712 `{ name: "Real Brasileño", version: "1" }` |

Names and versions were read from mainnet with `name()` and `eip712Domain()`. None of the four tokens
exposes `version()`. USDT has no `eip712Domain()`; its version "1" comes from the x402 docs.

### 8.2 x402 (Celo facilitator)

- Facilitator API `https://api.x402.celo.org`; header `X-API-Key` (key created at x402.celo.org, free credits).
- Network id `eip155:42220`. Prices are always explicit `{ amount, asset, extra }` objects, never `"$0.01"` strings.
- Permit2 routes (wARS, wBRL) need `extra.assetTransferMethod: "permit2"` and the
  `eip2612GasSponsoring` extension. Without it, fresh wallets get `412 permit2_allowance_required`.
- `DynamicPrice` and `DynamicPayTo` (exported by `@x402/core`) provide per-invoice amount and recipient.
- Known gap: the facilitator does not write attribution tags on settlement transactions yet (§15).
- Facilitator `/supported` (checked 2026-10-08) lists `exact` on `eip155:42220` for USDC, USDT, USAT, wARS, wBRL, wCOP and only the `eip2612GasSponsoring` extension. `@x402/extensions` 2.28 has a `builder-code` (ERC-8021) extension for settlement calldata; Celo's facilitator does not list it yet, which is what question 1 in §15 is about.
- Verified on mainnet 2026-10-09 (`docs/superpowers/smoke/2026-10-payments.md`): USD₮ settlement through the facilitator, and claim-before-settle under two simultaneous payments (one settles, the other gets 409).

### 8.3 Textile FX

- Rates feed (public, no key): `GET https://api.textilecredit.com/tickers`, `/pairs`, `/historical_trades`.
  Pairs used: `USDT_WARS`, `USDT_WBRL`, `USAT_USDT`.
- Snapshot of 2026-10-08: 1 USDT ≈ 1,606 wARS (24h volume ≈ $850), 1 USDT ≈ 5.04 wBRL (≈ $15.7k), USA₮→USDT bid only.
- RFQ v2 base `https://api.textilecredit.com/v2`: `POST /rfq/preview`, `POST /rfq/request`,
  `POST /rfq/{id}/submit`, `GET /rfq/{id}`, `POST /rfq/{id}/cancel`.
- Keyless callers send `takerProof`: an EIP-712 signature with domain `{ name: "Textile Taker Control",
  version: "1", chainId }` over `TakerControl { taker, chainId, nonce (bytes32), issuedAt (ms) }`.
  The v2 OpenAPI (`https://api.textilecredit.com/v2/openapi.json`, read 2026-10-09) requires
  `issuedAt` within 60 s of Textile's clock, so Cobro signs a fresh proof for every RFQ request
  (one Para `sign-typed-data` call) instead of reusing one for 12 hours.
- A firm quote lives about 60 s, covers the full size or returns `no_quote`, and is bound to the taker.
  The taker broadcasts `transactions.swap` itself, so our attribution tag can be appended.
- Approve the sell token to `quote.spender` first, and wait for that receipt. On an ordinary quote the
  spender is the reactor; a vault-routed quote names another spender, and Cobro refuses it because
  only the reactor is allowed. USDT requires resetting a non-zero allowance to 0 first.
- Limits: 4 outstanding RFQs, $1 minimum notional, taker fee 1 bps on Celo, client timeout 75 s.
- Celo contracts: LimitOrderReactor `0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`, Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`.

### 8.4 Para

- Client: Para React SDK email sign-in, which creates the freelancer's personal wallet.
- Server: REST API (`https://api.getpara.com`, `X-API-Key`). `POST /v1/wallets` with
  `type: "EVM"`, `userIdentifierType: "CUSTOM_ID"`, so that signing in with email never "claims" the
  treasury wallet. Since Plan 3 the custom id is `para:<Para user id>`, and an existing wallet with
  that id is adopted before a new one is created (the §15 risk). Wallets created earlier with our
  user id keep working. Signing goes through `/v1/wallets/{id}/sign-raw` (treasury transactions:
  `sign-transaction` accepts only types 0 and 2, so the CIP-64 digest is signed raw and normalised
  to low-s) and `/sign-typed-data` (Textile's `takerProof`); we broadcast ourselves. Verified on
  mainnet in Smoke D and E ([treasury smoke results](../smoke/2026-10-treasury.md)).
- Guardrails: allow calls to the Textile reactor and `approve(reactor)` on the four tokens. Allow
  token transfers (the per-user recipient check stays in code). Spike result (2026-10-08,
  `docs/superpowers/spikes/2026-10-11-para.md`): an active Development Guardrail was not enforced
  for REST signing, on Celo or Ethereum. Until a re-test shows a denial, the executor's checks are
  the only enforcement, and Guardrails are a second layer to add later.
- To prove in the spike (§13): server-side session verification, signing on chain 42220, Guardrails on
  Celo, cost of Para environments.

### 8.5 Attribution tags (ERC-8021)

- Package `@celo/attribution-tags` (≥ 0.5.0 for `withAttribution`). Code from env `ATTRIBUTION_CODE`,
  copied from `loops project get` after enrollment. Our entry's tag: `celo_bc3965e128ba` (issued
  2026-10-08). The tag is public, since it appears on-chain, so `.env.example` carries it too. Startup fails if the env value is missing or does
  not match the pattern `celo_[0-9a-f]{12}`.
- Two code paths append the tag to calldata, and nothing else broadcasts: `createOperatorClient`
  (`chain/clients.ts`) for operator transactions, and `signTreasuryTx` (`chain/treasury-tx.ts`,
  through `tagCalldata`) for treasury transactions. The admin page's ERC-8004 registration passes the
  tag as wagmi's `dataSuffix`.
- Verification: `verifyTx({ client, hash })` must return our code. This is part of the smoke tests.

### 8.6 Gas

- **Operator wallet** (server key, §8.7): pays its own gas in USDT through Celo fee abstraction
  (CIP-64 `feeCurrency` = the USDT fee-currency adapter, address taken from docs.celo.org/developer/fee-abstraction
  and checked on-chain during implementation). viem's Celo chain support serializes these transactions.
- **Treasury wallets** (decided 2026-10-09, replacing the CELO drip default): every treasury
  transaction is CIP-64 and pays gas in USD₮, else USA₮, else USDC, whichever holds at least 0.02.
  It is signed with Para `sign-raw` over the CIP-64 digest (§8.4). Guardrails were not enforced for
  REST signing anyway, so `encodeTreasuryCall` is the enforcement. When no token qualifies, the
  operator drips 0.05 USDC, at most once per 24 hours per wallet. Smoke D (2026-10-14) paid
  0.002452 USD₮ for the approval and 0.004930 USD₮ for the swap; no drip has been needed yet.

Gas paid in stablecoins counts as "real use of the Celo stack" in Track 1.

### 8.7 ERC-8004

- Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`).
- **Agent wallet** = `0x64ad61211c1b0b7f20b3e04b49661f30f152ae78` (env `AGENT_WALLET`), the user's
  existing EOA, declared on Loops. Its key stays in the user's browser wallet and never reaches the server.
  It already owns identity #9751 "CoinOp" from an earlier project. That identity stays untouched.
- Cobro gets a **new** identity: `register(agentURI)` with `agentURI = https://<domain>/agent-card.json`,
  signed by the agent wallet on `/admin/agent` (wagmi `writeContract` with `dataSuffix` = our tag).
  This is also the agent wallet's first tagged transaction, which the Loops "Find it" check looks for.
  After the `Registered` event, the card's `registrations` entry is filled in.
- **Operator wallet** (`OPERATOR_PRIVATE_KEY`): planned as a new, low-balance server key. On
  2026-10-13 the user replaced it with their existing EOA `0x2B33cb68c4D826a4Fc36264bcDB46081c99f4f57`
  (their choice, against the advice to keep a dedicated key) and swept the old operator's USDC to it.
  It sends gas drips to treasury wallets and Plan 2 refunds, paying gas in `OPERATOR_FEE_TOKEN`. It is
  not the declared agent wallet; its transactions are tagged, and credit flows through the tag in calldata.
- Treasury-wallet transactions are credited the same way (tag in calldata). This is open question 2 in §15.
- Card: `type`, `name`, `description`, `image`, `services: [{ name: "web", endpoint }]`,
  `x402Support: true`, `active: true`, `registrations: [{ agentId, agentRegistry: "eip155:42220:0x8004A169…a432" }]`
  (filled in after the `Registered` event).

### 8.8 LLM

- Gemini free tier (Flash model, chosen at implementation from the free list); Groq free tier
  (`llama-3.3-70b-versatile` or `openai/gpt-oss-120b`) when Gemini returns 429 or 5xx; form when both fail.
- Structured output (zod) for invoice drafts: `clientName`, `description`, `amount`, `currency`, `dueDate`.
- Never send keys, wallet data or anything beyond the chat text. The free tier may use inputs to improve Google products.
- Default explanations are English templates. The LLM is called only on "explain more" or in chat.

## 9. Payments design

- Invoice: `amount` + `currency` ∈ {USD, ARS, BRL}. Slug: random 10-character base58.
- Route: `GET /api/pay/[slug]?asset=USAT|USDT|WARS|WBRL`, protected by x402.
  - `DynamicPayTo` returns the invoice owner's treasury wallet.
  - `DynamicPrice` reads `invoice_quotes` for `(invoice, asset)`. If it is missing or expired, it
    creates one: the amount converted with the Textile reference rate (USD↔USDT/USAT taken as 1:1),
    rounded up to the token's smallest unit, valid 10 minutes. The 402 response and the paid retry
    therefore price the same amount. If the lock expired in between, verification fails and the client
    gets a fresh 402, which the page shows as a new confirmation.
  - On settle success: insert `payments` (payer, asset, amount, settlement tx hash), set the invoice to
    `paid`, then schedule a treasury run with Next.js `after()`.
  - A paid or cancelled invoice returns 409 and the page shows its status.
- Browser: `@x402/fetch` `wrapFetchWithPayment` with the wagmi wallet client as signer. Spend controls
  allow exactly the quoted asset and amount.

### 9.1 Recurring invoices

- A `recurring_invoices` row holds the template: client name, description, amount, currency,
  `interval` ∈ {weekly, monthly}, `next_issue_at`, `active`, and its own stable `slug`.
- Each treasury run (§10.4) also issues due instances: for every active template with
  `next_issue_at ≤ now`, it inserts an `invoices` row (`recurring_id` set, due 7 days after issue)
  and advances `next_issue_at` by one interval. A unique `(recurring_id, period_start)` index makes
  this idempotent when runs overlap.
- `/r/<slug>` redirects to the oldest open instance, or shows "all paid" with the payment history.
- The dashboard groups payments per template and shows repeat payers, which is the evidence for the
  Track 3 "repeat flow from the same counterparty" criterion.

## 10. Treasury design

### 10.1 Rules (one set per freelancer)

| Field | Default | Meaning |
|---|---|---|
| `localCurrency` | wARS | Spending currency (wARS or wBRL) |
| `reserveAmount` | 0 | Local-currency amount to keep for spending |
| `autoTopUp` | true | Refill the reserve from the USD bucket when it runs low |
| `approvalMode` | sell_usd | When the agent asks first: `auto` never, `sell_usd` before selling dollars, `all` before every conversion ([trade approvals](2026-10-14-trade-approvals-design.md)) |
| `maxSlippageBps` | 50 | Normal acceptance threshold against the reference |
| `hardMaxSlippageBps` | 150 | Acceptance threshold after the wait deadline |
| `maxWaitMinutes` | 360 | How long to wait for a better price |
| `perTradeMaxUsd` | 50 | Hard cap per swap |
| `dailyMaxUsd` | 200 | Hard cap on swaps per rolling 24 h |
| `enabled` | true | Per-user switch |

A global `TREASURY_ENABLED` env flag and a `TREASURY_DRY_RUN` flag sit above all users.

### 10.2 Engine (pure function)

Input: balances, rules, reference rates (Textile mid = (bid + ask) / 2 per pair), open intent, filled
volume in the last 24 h, now. Output: one decision: `none`, `convert(from, to, amount, reason)`,
`wait(intent)`, or `block(intent, reason)`.

- Buckets: `LOCAL` = balance of `localCurrency`; `USD` = USDT + USAT.
- `band` = max(5% of `reserveAmount`, $1 in local units, using the reference rate).
- If `LOCAL − reserve > band`: sell the excess LOCAL for USDT (`save_excess`).
- Else if `autoTopUp` and `reserve − LOCAL > band` and `USD ≥ $1`: buy LOCAL. Use USDT first. If
  USDT is short and USAT is available, first convert USAT → USDT (`hub_route`); the USDT → LOCAL leg
  follows on the next evaluation.
- Every amount is capped by `perTradeMaxUsd` and by what is left of `dailyMaxUsd`. Larger needs are
  split across runs.
- At most one open intent per user. When a run computes a conversion with the same from/to pair as
  the open intent, the intent keeps its age (so the wait deadline still applies) and takes the new
  amount. A different pair, or no conversion at all, cancels the open intent.
- A conversion the approval mode asks about is stored as a `proposed` intent instead of trading. Approval
  caps it at the amount shown; dismissal silences its group (refill or save) for 24 hours. See the
  [trade approvals spec](2026-10-14-trade-approvals-design.md) §5.

### 10.3 Price acceptance

`slippageBps` = how much worse the quote's effective rate (`buyAmount / takerPays`, normalised for
decimals) is than the reference mid, in basis points. Accept if `slippageBps ≤ maxSlippageBps`. Once
the intent is older than `maxWaitMinutes`, accept if `≤ hardMaxSlippageBps`, otherwise set it to
`blocked` and post an activity-feed alert. A `no_quote` keeps the intent waiting and respects `retryAfterMs`.

### 10.4 Executor

The cron route first issues due recurring invoices (§9.1) and reconciles settlements and pending
transactions, then runs these steps for each user with rules enabled, in random order and at most
three wallets at once (below Textile's four outstanding RFQs); no new wallet starts after 180 s:

1. Take a per-wallet lock (row lock with expiry) so cron and payment triggers cannot overlap.
2. Read balances and rates and run the engine. In dry-run mode, record the decision and stop. A conversion that needs approval stops here as a proposal (trade approvals §5.1).
3. `POST /rfq/request` with `taker` = treasury wallet and a `takerProof` signed for this request
   (§8.3). Store the `claimToken`.
4. Check the quote: it names our taker, sells no more than the intent, and its spender is the reactor;
   otherwise nothing is signed. Then the price check (§10.3). If either fails, `POST /rfq/{id}/cancel`
   and record the outcome.
5. If the allowance to `quote.spender` is below `takerPays`, approve up to the remaining daily cap
   (reset to 0 first for USDT). Wait for the receipt. If `expiresAt` has passed by then, discard the
   quote and leave the allowance for the next run.
6. Sign `transactions.swap` with the TreasurySigner (CIP-64, tagged, §8.5), store the signed bytes in
   `treasury_txs`, broadcast, wait for the receipt, `POST /rfq/{id}/submit`, and record `fx_trades`
   and an activity event.
7. A broadcast with an unknown outcome is never re-signed. The next run re-sends the identical stored
   bytes, or settles the row by receipt or nonce; bytes the node refused, or that it has not seen for
   30 minutes, are marked `failed`. Para signing calls carry no idempotency key, because signing has
   no side effect and no nonce is ever signed twice.

Recorded in Postgres (Plan 3): every RFQ outcome in `fx_trades` (`no_quote`, `rejected`, `expired`,
`broadcast`, `filled`, `failed`), which is also the source of §10.5's volume figures; activity events
as `type` + `data`, rendered from `en.ts` templates at display time; the intent deadline computed as
`created_at + maxWaitMinutes`, so a rules change applies at once, with `retry_after` for Textile's
`retryAfterMs`. The engine also sells a non-local wFiat (an ARS freelancer paid in wBRL) into USD₮
(`save_other`), and prices USA₮→USD₮ against 1:1.

### 10.5 P&L and volume

- Per trade: executed rate against the reference mid (bps) and fee.
- Protected value: current USD value of the treasury minus the USD value it would have today if every
  payment had been held in `localCurrency` from the moment it arrived.
- Volume: RFQs requested, quoted, filled, and filled notional in USD.

## 11. Data model (Postgres)

```
users            id, email, para_user_id, personal_wallet, created_at
treasury_wallets id, user_id, address, signer_type (para|local), para_wallet_id, encrypted_key, gas_dripped_at
rules            user_id (pk), fields of §10.1, updated_at
recurring_invoices id, slug, user_id, client_name, description, amount, currency, interval (weekly|monthly), next_issue_at, active, created_at
invoices         id, slug, user_id, recurring_id (nullable), period_start (nullable), client_name, description, amount, currency, due_date, status (open|paid|cancelled), created_at, paid_at
invoice_quotes   invoice_id, asset, amount_atomic, rate, expires_at  (unique invoice_id + asset)
payments         id, invoice_id, payer, asset, amount_atomic, tx_hash, settled_at
fx_intents       id, user_id, from_asset, to_asset, amount_atomic, reason, status (proposed|waiting|executing|filled|blocked|cancelled), created_at, attempts, last_slippage_bps, retry_after, approved_amount_atomic, approved_at, dismissed_at, approved_via
fx_trades        id, intent_id, rfq_id, sell_asset, buy_asset, sell_amount, buy_amount, rate, reference_rate, slippage_bps, fee_amount, approval_tx, swap_tx, status, created_at
agent_events     id, user_id, type, message, data (jsonb), created_at
wallet_locks     wallet_id (pk), locked_until
```

Amounts are stored as base-10 strings of atomic units (numeric in Postgres), never as floats.

Added in Plan 2:
- `users.display_name`: shown as "From" on the payment page instead of the freelancer's email.
- `treasury_wallets.status` (`creating|ready|failed`): wallet creation at Para is asynchronous and can be retried.
- `recurring_invoices.anchor_day`: monthly invoices keep their day of month.
- Invoice status `settling` with `settling_until`: a short claim taken before settlement, so two payers cannot both pay one invoice (§12 "no double charge").

Added in Plan 3 (these replace the `fx_trades` and `agent_events` lines above):
- `treasury_txs` (id, user_id, kind `approve|swap|withdraw`, nonce, hash, raw, fee_token, status `pending|success|reverted|failed`, withdrawal asset/amount/recipient/usd_cents, created_at, confirmed_at): every signed treasury transaction, stored before broadcast (§10.4 step 7). Withdrawals live here too.
- `fx_trades` as an RFQ log: one row per RFQ whatever came of it (rfq_id, claim_token, sell/buy asset and amount, fee, slippage_bps, notional_usd_cents, status `no_quote|rejected|expired|broadcast|filled|failed`, detail, swap_tx_hash, filled_at). The approval transaction lives in `treasury_txs`.
- `agent_events` without a `message` column: `type` + `data` only, text rendered from `en.ts` at display time.
- `fx_intents.retry_after`, and no `deadline_at` (computed from `created_at` and the rules).
- `payments.rates_snapshot`: Textile reference rates when the payment settled, the input for §10.5's protected value.
- `wallet_locks.holder`: the run that holds the lock, so only it can release it.

Added with trade approvals: `rules.approval_mode` (`auto|sell_usd|all`, default `sell_usd`) and the
`fx_intents` approval columns above; the open-intent index covers `proposed`.

## 12. Safety and error handling

| Situation | Behaviour |
|---|---|
| Swap or withdrawal outside the caps or to another recipient | Rejected by the executor, the only enforcement for now. Para Guardrails become a second layer once a re-test shows they deny (§8.4) |
| Textile `no_quote`, 429 | Intent keeps waiting; back off using `retryAfterMs` |
| Quote expired before broadcast | Discard and request a new quote; never send |
| x402 verify/settle failure | Invoice stays open; payer sees a clear error; no double charge |
| Gemini 429/5xx | Groq; then the form |
| Para error or timeout | Intent stays waiting and is retried next run |
| Unknown broadcast outcome | Reconcile by receipt and nonce before any new transaction from that wallet: re-send the stored bytes, or mark them `failed` when the node refused them or has not seen them for 30 minutes |
| Unknown x402 settlement outcome | After the `settling` hold, the cron looks for the matching on-chain transfer: it records the payment if found and reopens the invoice otherwise |
| Primary RPC (forno) failing | Screens read balances through a second free RPC (`CELO_RPC_FALLBACK_URL`, default Ankr's public endpoint; dRPC's free tier refuses `eth_call` on Celo); money paths wait for the primary, so nothing is signed from a lagging node |
| A cron tick reports errors | The tick logs `CRON TICK HAD ERRORS`; the GitHub workflow's run fails and GitHub emails the owner; cron-job.org emails on a failed call |

Secrets (`PARA_API_KEY`, `X402_API_KEY`, `OPERATOR_PRIVATE_KEY`, `CRON_SECRET`, LLM keys,
`LOCAL_KEY_ENCRYPTION_SECRET` for the fallback) live only in environment variables. The repo contains `.env.example`.
`AGENT_WALLET` and `ATTRIBUTION_CODE` are public values and appear in `.env.example` as they are. The
agent wallet's private key is never stored anywhere in the app.

## 13. Testing and verification

- Unit (Vitest): the treasury engine (excess, top-up, band, caps, splitting, wait deadline, hard block,
  USAT hub route, stale intent), amount math (6 vs 18 decimals, RAY rates, rounding up), quote locking,
  attribution suffix appended to calldata, slug generation.
- Integration with mocked HTTP: Textile RFQ flow (quoted, no_quote, expired), facilitator verify/settle,
  Para signing, LLM fallback chain.
- Mainnet smoke scripts with about $1 each: ERC-8004 registration, USA₮ invoice payment, wARS invoice payment,
  one Textile swap, one withdrawal. Each ends with `verifyTx` on transactions we broadcast.
- Dry-run on production for at least one day before live conversions. In practice (2026-10-13 to
  10-14) the dry run lasted about 15 hours: the delayed GitHub schedule ran only three times, and the
  1 USD₮ balance was below the $1 minimum, so the decision path never ran. On the user's ruling a paid
  US$1.10 invoice in dry run exercised it instead (correct `dry_run` decision 1.4 s after settlement),
  and production then went live ([treasury smoke results](../smoke/2026-10-treasury.md)).
- UX checks from §17.3: the MASTER.md checklist per page, Lighthouse Accessibility ≥ 95 on the key pages, and a hallway test.

**Para spike (first implementation task, decision by 2026-10-11).** Prove: Para email sign-in in Next.js
with server-side session verification; REST wallet creation with `CUSTOM_ID`; signing an EIP-1559
transaction for chain 42220 and an EIP-712 `TakerControl`; broadcasting with the attribution suffix;
a Guardrail on Celo that blocks a call outside the allow list. If any of these fails, use `local-key.ts`
(AES-GCM encrypted key in the DB) and keep Para for sign-in only, or drop Para entirely if sign-in also fails.
Outcome (2026-10-08): Para REST signer and Para email sign-in adopted; the Guardrail check failed,
so enforcement stays in the executor (report: `docs/superpowers/spikes/2026-10-11-para.md`).

## 14. Milestones

| Week | Work | Proof |
|---|---|---|
| 1 (Oct 8–14) | Done: enrollment, tag `celo_bc3965e128ba`, public repo. Scaffold app and DB, `chain/` with `sendTagged()`, Para spike, `/admin/agent` and Cobro's ERC-8004 registration from the agent wallet, operator wallet funded | First tagged mainnet transaction from the agent wallet; Loops checklist "Find it" passes |
| 2 (Oct 15–21) | Done 2026-10-09: invoices (one-off and recurring), payment page, x402 for USAT/USDT and wARS/wBRL, cron route | Real invoices paid on mainnet in USD₮, including a double-payment race ([smoke results](../smoke/2026-10-payments.md)); wARS and USA₮ smokes pending tokens |
| 3 (Oct 22–28) | Done 2026-10-14: treasury engine, executor, GitHub Actions cron, withdrawals, dashboard with value protected and activity feed | First autonomous Textile swap on 2026-10-14: 1.07 USD₮ → 1,718 wARS at 2 bps, tagged, gas in USD₮; a tagged withdrawal ([smoke results](../smoke/2026-10-treasury.md)) |
| 4 (Oct 29–Nov 4) | Chat (Gemini/Groq), UX polish, user outreach (hackathon Telegram, Celo LatAm communities) | Independent payers |
| Finish (Nov 5–8) | README, screenshots, demo video; `loops project create` draft shown to the user and confirmed only after their yes; `loops evaluate` for each targeted sponsor and fixes | Submitted Nov 8 |

Independent payer: a wallet that is not ours, was not first funded by us, and had Celo activity before 2026-10-06.

## 15. Risks and open questions

**Risks:**
- Para server signing or Guardrails do not work on Celo → local-key fallback (§13).
- Thin wARS liquidity (about $850/day) → small trades, `no_quote` handling, wBRL as the second corridor.
- No existing users → outreach in week 4; the Track 2 P&L and Track 1 demo do not depend on outside users.
- Free LLM quotas → Groq fallback, then forms; LLM is not on any money path.
- Treasury wallets live in Para **BETA** for the hackathon (decided 2026-10-09). BETA's durability and SLA are unverified and wallets cannot move to PROD, so balances stay at a few USD and Cobro moves to Para PROD before inviting real users. Resolved in Plan 3: a lost user row no longer leads to a second Para wallet, because the custom id is now `para:<Para user id>` and an existing wallet is adopted before a new one is created (§8.4).
- Para `sign-typed-data` does not normalise signatures to low-s. If Textile ever verifies the `takerProof` with OpenZeppelin-style ECDSA, about half of RFQs would be refused (no money moves). Smoke D's proof was accepted, but that is one sample; watch for RFQ errors and normalise if they appear.

**Questions for the organisers** (Telegram or office hours, Thursdays 12:00 GMT):
1. The Celo x402 facilitator does not tag settlement transactions. How are Track 3 USA₮ payments
   attributed to a team: by the `payTo` wallet?
2. Are transactions from per-user treasury wallets (not the declared `agent-wallet`) credited when
   their calldata carries our tag?

Answered: new users onboarded through Para are welcome ("Onboarding new people is exactly what we
want, and we measure it in other ways", event FAQ). The attribution tag is issued by Loops at enrollment.

## 16. Internationalisation

English first. All user-facing strings live in `src/i18n/en.ts` behind a `t()` helper. Spanish
(`es.ts`) is a later task and needs no component changes.

## 17. UX and visual design

Track 1 gives 20% to "UX a real person can use": someone new to crypto completes the core flow end to
end, amounts show in their own currency, and the rails stay out of the way. The visual system comes
from the ui-ux-pro-max skill and lives in **`design-system/cobro/MASTER.md`**, the source of truth for
tokens and component rules. Page-specific overrides go in `design-system/cobro/pages/<page>.md`.

**Visual system (summary of MASTER.md):** Minimalism & Swiss style; IBM Plex Sans (IBM Plex Mono only
for hashes and addresses); light "trust teal" palette (primary `#0F766E`, success `#15803D`, warning
`#B45309`, error `#DC2626`), with all text pairs at WCAG AA or better; shadcn/ui with OKLCH semantic
tokens; Lucide icons; CSS-only subtle motion that respects reduced motion. Light mode only in the MVP.

### 17.1 Principles

1. **Crypto stays invisible.** Default views never show gas, Permit2, nonces, raw token units or
   addresses. Buckets are named "Spending (pesos)" and "Savings (dollars)". Hashes and addresses
   live behind "Details".
2. **Local currency first.** Every amount is rendered by `formatMoney`: local currency large, USD small.
3. **One primary action per screen.**
4. **The agent explains itself.** Every activity-feed entry has a "Why?" disclosure. The agent's state
   (Active / Paused / Dry run) is always visible, with a prominent "Pause agent" control.
5. **Guardrails build trust.** The UI states what the agent can do ("convert on Textile, send to your
   wallet, at most $50 per trade") and cannot do.
6. **Mobile-first and accessible.** 375px first; WCAG 2.2 AA; status updates announced with `aria-live`.

### 17.2 Screens

| Screen | Key content and behaviour |
|---|---|
| Landing `/` | Hero "Get paid in dollars or pesos. Your agent protects the rest."; how it works in 3 steps; trust block (guardrails, ERC-8004 identity link, on-chain receipts); "Start with email" |
| Onboarding | 3 steps with a progress indicator and Back: (1) email sign-in, (2) pick ARS or BRL and set the spending reserve as a sentence with an input, (3) create a first invoice or skip |
| Dashboard `/app` | Total in local currency; Spending and Savings buckets with a reserve bar; "Value protected" stat with a small trend chart (labelled, with a text summary); agent status and last action; activity feed; a proposal banner (Approve / Dismiss for 24 hours) when the agent waits for approval; a dot on the Agent tab; invoices with icon+text status chips; first-use empty state that points to "Create your first invoice" |
| Chat `/app/chat` | Example prompt chips; the LLM draft renders as an editable invoice card; nothing is created until "Create invoice"; "Use the form instead" link always visible |
| Rules `/app/rules` | Rules as sentences ("Keep [300,000] ARS for spending. Save the rest in dollars."); advanced settings (slippage, wait, caps) collapsed; a "If the agent ran now, it would…" preview from a dry run of the engine; a "When should your agent ask you?" choice |
| Payment `/pay/[slug]` | Invoice summary (from, for, amount); stepper Choose how to pay → Connect wallet → Confirm → Paid; each token shows its amount and a plain-language name ("US dollar (USA₮), recommended for US clients"); "No network fee — you only sign"; 10-minute rate countdown; explicit states for wrong network (switch to Celo), insufficient balance (amount missing, USA₮ faucet link), signing, settling, success receipt with explorer link, and error with retry |
| Recurring `/r/[slug]` | Current period's invoice plus the list of paid periods |
| Admin `/admin/agent` | Owner-only; connect agent wallet, register identity, see the tagged tx and its `verifyTx` result |

Every data view has loading (skeleton), empty, error (with retry) and success states.

### 17.3 UX verification

- Pre-delivery checklist in MASTER.md for every page.
- Lighthouse Accessibility ≥ 95 on landing, dashboard and payment page.
- Manual pass at 375px and 1440px, keyboard-only navigation, and reduced motion.
- Hallway test: a person new to crypto signs up and creates an invoice without help (success criterion 5).
