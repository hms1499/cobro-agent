# Plan 4e: hackathon submission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the proof and the submission for tracks LatAm (Ripio) and USA₮ x402: usage numbers from real data, a README, a pay-with-USA₮ guide, screenshots, a captioned demo-video script, and an updated Loops entry evaluated per sponsor.

**Architecture:** One tested CLI (`scripts/usage-stats.mts`) reads the production DB and Celo Blockscout and writes a markdown usage block into the README between markers, so every public number comes from data. Everything else is docs in the repo (README, `docs/guides/`, `docs/demo/`, `docs/screenshots/`) plus Loops CLI drafts the user approves.

**Tech Stack:** TypeScript, tsx, Drizzle + `@neondatabase/serverless`, Vitest (injected `fetch`), Celo Blockscout API (`https://celo.blockscout.com/api`), Playwright MCP for screenshots, `npx -y loopshouse` CLI.

**Spec:** `docs/superpowers/specs/2026-10-23-plan-4e-submission-design.md`

## Global Constraints

- Never `loops project create|update … --confirm` before the user has seen the draft and said yes.
- Never inflate numbers: self-payments and team wallets are never counted as independent; small numbers are shown as they are.
- Users are named **by role only** ("freelancer in Argentina", "client, a web3 team"); no names, no quotes. Addresses appear only inside celoscan links.
- Public text (README, guide, video captions, Loops description) is English.
- Never print or commit secrets (DB URLs, keys, emails). The team-exclusion file lives in `.superpowers/team-exclusions.json` (git-ignored) and the CLI never prints its emails.
- Never read `.env.local`. Production numbers come from Neon **main**: the user runs the CLI with their own env file (`npx tsx --env-file=<their main env file> scripts/usage-stats.mts …`).
- Unit tests never touch the network: inject `fetch`.
- Hackathon window starts `2026-10-06T12:00:00Z` (event `startsAt`). Independent payer = not in the team wallets, first Celo activity before that instant, first funder not a team wallet.
- Tracks targeted: Stable Agents LatAm (bounties `e541ed4a-0971-4db4-82d2-043add3b6c49`, `58f7e28c-b2da-4425-89b7-6a7e0fa099ac`), USA₮ x402 (`603875c0-cce6-44c8-a001-a7342006e340`, `8f651898-2fdc-4f6e-8c12-407cd08a9f7d`), Textile FX (`f47e6f01-94c0-467b-afb9-8c004f0bae13`, `1a1b28af-acb1-4754-9770-0e9494b38555`) until the 2026-11-04 cut-off. Build with buy (`e9a90153-6486-4deb-8027-a931e5eea4d2`) is removed.
- Full gate before claiming done: `npm test && npm run typecheck && npm run lint && npm run build`.
- Branch `plan-4e-submission`. Two merges **(builder's call)**: Phase A (Tasks 1–3) merges to `main` as soon as it is green, so the USA₮ guide and README are public while users are invited; Phase B (Tasks 4–6) merges before the Loops update.

## Review Focus

1. A payer whose Blockscout history is empty or errors (new wallet, API 5xx, rate limit) → counted as **not** independent, listed under "could not verify", never silently independent.
2. Address case: DB payers, exclusion wallets and Blockscout `from`/`to` differ in checksum case → all compared lowercased.
3. A local-currency payment with a `null` or malformed `ratesSnapshot` → priced with today's rates via `ratesAtPayment`, and the report says how many payments used today's rate.
4. README markers missing or duplicated → `replaceUsageBlock` throws; it never appends a second block or wipes the README.
5. Payments before the window (old smoke tests, Oct 9–14) → excluded from every count, but swaps/withdrawals likewise filtered by the window.

Each line has its test in Task 1.

## User-side checklist (not code; dates from spec §7)

- [ ] Oct 23: ask the organisers (Telegram / office hours Thu 12:00 GMT) main spec §15 questions 1–2. The builder drafts the message in Task 3, Step 4.
- [ ] Oct 23–24: write `.superpowers/team-exclusions.json` (format in Task 1) with every team email and wallet (incl. `0xd1d0…3B66`, agent wallet `0x64ad61211c1b0b7f20b3e04b49661f30f152ae78`, operator wallet, any throwaway payer keys).
- [ ] Oct 24–26: USA₮ smoke: follow `docs/guides/pay-with-usat.md` from your own wallet, pay a small USA₮ invoice on production; the builder records the result in `docs/superpowers/smoke/2026-10-payments.md`.
- [ ] By Oct 26: invite users; first weekly recurring invoice to an outside client.
- [ ] Nov 5–7: record the video from `docs/demo/video-script.md`, upload (YouTube unlisted or Loom), send the URL.
- [ ] Nov 7–8: approve the Loops draft.

---

### Task 1: Usage stats CLI

**Files:**
- Create: `scripts/lib/wallet-history.ts`, `scripts/lib/wallet-history.test.ts`
- Create: `scripts/lib/usage-stats.ts`, `scripts/lib/usage-stats.test.ts`
- Create: `scripts/usage-stats.mts`

**Interfaces:**
- Consumes: `usdWad` (`src/lib/treasury/value.ts`), `ratesAtPayment` (`src/lib/treasury/pnl.ts`), `ReferenceRates`, `getReferenceRatesOrNull` (`src/lib/fx/rates.ts`), schema tables `users`, `invoices`, `payments`, `fxTrades`, `treasuryTxs`.
- Produces:
  - `interface WalletHistory { firstActivityAt: Date | null; firstFunder: string | null }` (lowercase address)
  - `fetchWalletHistory(address: string, fetchFn: typeof fetch, base?: string): Promise<WalletHistory>` — earliest of `module=account&action=txlist` and `action=tokentx` (`sort=asc&page=1&offset=1`) on `base` (default `https://celo.blockscout.com/api`); `firstFunder` = `from` of the earliest row whose `to` is the address. Throws on non-OK HTTP or `status !== "1"` with a message other than "No transactions found" (which yields `{ null, null }`).
  - `interface Exclusions { emails: string[]; wallets: string[] }` — JSON file shape.
  - `interface UsageRows { users: { id: string; email: string | null; createdAt: Date }[]; payments: { freelancerId: string; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string; ratesSnapshot: Record<string, string> | null; settledAt: Date; recurring: boolean }[]; swaps: { txHash: string; notionalUsdCents: number; filledAt: Date }[]; withdrawals: { hash: string; usdCents: number | null; confirmedAt: Date }[] }`
  - `loadUsageRows(db: Db): Promise<UsageRows>` — swaps = `fx_trades` with status `filled`; withdrawals = `treasury_txs` kind `withdraw`, status `success`, `confirmed_at` not null; swaps need `swap_tx_hash` and `filled_at` not null.
  - `computeUsage(rows: UsageRows, exclusions: Exclusions, histories: Map<string, WalletHistory | "error">, nowRates: ReferenceRates, windowStart: Date): UsageReport`
  - `UsageReport` fields: `outsideFreelancers`, `independentPayers`, `unverifiedPayers`, `payments` (independent only), `paymentsByAsset: Record<PayAsset, number>`, `repeatPayers` (independent payers with ≥2 payments to the same freelancer), `repeatUsatPayers`, `volumeUsdCents`, `todayRatePayments`, `swaps`, `swapVolumeUsdCents`, `withdrawals`, `activity: { at: Date; kind: "payment" | "swap" | "withdrawal"; asset?: PayAsset; usdCents: number | null; role: "independent client" | "team" | "unverified" | "agent"; txHash: string }[]` sorted by `at` desc.
  - `renderUsageMarkdown(report: UsageReport, generatedAt: Date): string` — a summary table and an activity table, each tx as `[tx](https://celoscan.io/tx/<hash>)`; no addresses, no emails.
  - `replaceUsageBlock(readme: string, block: string): string` — replaces the text between `<!-- usage:start -->` and `<!-- usage:end -->`.
  - CLI: `npx tsx --env-file=<env> scripts/usage-stats.mts --exclude=.superpowers/team-exclusions.json [--write-readme]` prints the markdown (and with `--write-readme` rewrites `README.md`). Blockscout calls run sequentially, one per distinct payer, 250 ms apart.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/wallet-history.test.ts` (fake `fetch` returning canned Blockscout JSON):
  - `picks the earliest of txlist and tokentx` — txlist ts `1759000000`, tokentx ts `1758000000` → `firstActivityAt = new Date(1758000000 * 1000)`.
  - `firstFunder is the sender of the earliest incoming row, lowercased` — `from: "0xABC…"`, `to` = the address in mixed case → `"0xabc…"`.
  - `a wallet with no history gives nulls` — both responses `{ status: "0", message: "No transactions found", result: [] }` → `{ firstActivityAt: null, firstFunder: null }`.
  - `throws on HTTP 503` and `throws on status "0" with message "Max rate limit reached"`.

  And in `scripts/lib/usage-stats.test.ts` (rows built in-test, `nowRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 }`, `windowStart = new Date("2026-10-06T12:00:00Z")`):
  - `counts a payer with activity before the window and an outside funder as independent`.
  - `a payer in the exclusion wallets is team, whatever the case of the address` (`0xAbC…` in DB, `0xabc…` in exclusions).
  - `a payer first funded by a team wallet is not independent`.
  - `a payer whose first activity is after the window start is not independent`.
  - `a payer with history "error" or null activity is unverified, not independent` (Review Focus 1).
  - `repeat payer needs two payments to the same freelancer`; same payer paying two different freelancers once each → `repeatPayers = 0`; two USAT payments to one freelancer → `repeatUsatPayers = 1`.
  - `prices a 1,600 wARS payment with snapshot ARS=1600 at 100 cents`; same payment with `ratesSnapshot: null` → priced at today's rate and `todayRatePayments = 1` (Review Focus 3).
  - `rows before the window are ignored` — payment, swap and withdrawal at `2026-10-09` vs window start `2026-10-10` → all counts 0 (Review Focus 5).
  - `outsideFreelancers excludes emails case-insensitively`.
  - `renderUsageMarkdown never contains an email or a bare address` — assert the output has no `@` and every `0x` occurrence sits inside `https://celoscan.io/tx/`.
  - `replaceUsageBlock replaces only between markers`; `throws when a marker is missing`; `throws when markers appear twice` (Review Focus 4).

- [ ] **Step 2: Run them to verify they fail**

  Run: `npx vitest run scripts/lib/wallet-history.test.ts scripts/lib/usage-stats.test.ts`
  Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `scripts/lib/wallet-history.ts` and `scripts/lib/usage-stats.ts` per the Interfaces block. Compare every address lowercased. `usdCents` = `usdWad(...) / 10n ** 16n` as a number.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx vitest run scripts/lib/wallet-history.test.ts scripts/lib/usage-stats.test.ts`
  Expected: PASS, all tests.

- [ ] **Step 5: Write `scripts/usage-stats.mts`** following `scripts/retire-para-beta.ts`'s wiring (Pool from `parseServerEnv().DATABASE_URL`, `pool.end()` in `finally`). Missing `--exclude` or an unreadable file → exit 1 with usage text. Fetch today's rates with `getReferenceRatesOrNull()`; if null, exit 1 ("reference rates unavailable"). Print only the markdown and one line `excluded: <n> users, <m> payments`.

- [ ] **Step 6: Smoke the CLI against Neon dev** with a throwaway exclusions file in the session scratchpad:

  Run: `npx tsx --env-file=.env.local scripts/usage-stats.mts --exclude=<scratchpad>/excl.json`
  Expected: a markdown block and the `excluded:` line; no email or address outside a celoscan link. (`--env-file` loads the file for the process; the builder never prints or reads it.)

- [ ] **Step 7: Typecheck and commit**

  Run: `npm run typecheck && npm run lint`
  Expected: both exit 0.

  ```bash
  git add scripts/lib/wallet-history.ts scripts/lib/wallet-history.test.ts scripts/lib/usage-stats.ts scripts/lib/usage-stats.test.ts scripts/usage-stats.mts
  git commit -m "feat(scripts): usage stats from the DB and Blockscout for the submission"
  ```

### Task 2: Pay-with-USA₮ guide

**Files:**
- Create: `docs/guides/pay-with-usat.md`

**Interfaces:**
- Consumes: the live `/pay/<slug>` page; pay assets USAT, USDT, WARS, WBRL (`src/lib/chain/tokens.ts`).
- Produces: a guide the README (Task 3) links as `docs/guides/pay-with-usat.md`.

- [ ] **Step 1: Research, citing sources.** Run one sponsor knowledge query (1 credit):

  `npx -y loopshouse knowledge query --event agents-on-open-rails --sponsor stable-agents-open-corridors-usa-with-x402 -q "How can a person get USA₮ on Celo mainnet today: Google Cloud Web3 faucet with Self verification (steps, limits), exchanges or swaps, and the USA₮ token address on Celo?"`

  Cross-check the USA₮ address against `TOKENS.USAT` in `src/lib/chain/tokens.ts`. Every claim in the guide cites a URL from the evidence or an official page fetched in this step.

- [ ] **Step 2: Write the guide** (English, ≤ 1 page): who it is for (a client paying a Cobro invoice); what you need (a Celo wallet, a little USA₮; gas is paid by the facilitator for x402 — verify against `/pay` behaviour); ways to get USA₮ with links; paying step by step on `/pay/<slug>` (choose USA₮, connect, sign); what you see after paying (invoice marked paid, celoscan link); a "Troubleshooting" list (wrong network, not enough USA₮, quote expired).

- [ ] **Step 3: Check every link resolves**

  Run: `grep -oE 'https?://[^) ]+' docs/guides/pay-with-usat.md | sort -u | xargs -n1 curl -s -o /dev/null -w '%{http_code} %{url_effective}\n' -L`
  Expected: every line starts with `200`.

- [ ] **Step 4: Commit**

  ```bash
  git add docs/guides/pay-with-usat.md
  git commit -m "docs: guide for clients paying a Cobro invoice in USA₮"
  ```

### Task 3: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: `replaceUsageBlock` markers from Task 1; `docs/guides/pay-with-usat.md` from Task 2.
- Produces: `README.md` with a `<!-- usage:start -->` / `<!-- usage:end -->` block that Task 6 refreshes.

- [ ] **Step 1: Write `README.md`** with these sections, in order:
  1. Title + one-line pitch + live links (app `https://cobro-agent.vercel.app`, agent #9884 on 8004scan, agent wallet on celoscan).
  2. **Who it is for** — LatAm freelancers paid by clients who already hold stablecoins (Plan 4 spec §1).
  3. **How it works** — invoice → client pays over x402 (USA₮, USD₮, wARS, wBRL) → agent keeps a local reserve and converts the excess via Textile FX within the freelancer's limits (approval above the limit) → withdrawal to saved addresses (24 h wait on new ones). A small mermaid diagram.
  4. **Tracks** — one subsection per targeted track mapping features to each judging criterion by name (criteria names copied from the Loops event data); the Textile subsection says "filler: in progress" until the separate filler plan ships.
  5. **Real usage** — the markers with a placeholder line between them; a note that numbers are generated by `scripts/usage-stats.mts` and how "independent" is decided (Global Constraints wording).
  6. **Attribution** — tag `celo_bc3965e128ba` on every tx Cobro sends (via `createOperatorClient` / treasury signing); x402 settlements are sent by the Celo facilitator (untagged; it does not list the builder-code extension) and every one is settled with Cobro's facilitator API key, with `payTo` = the freelancer's treasury wallet.
  7. **Architecture** — Next.js 16 on Vercel, Neon Postgres via Drizzle, Para server wallets, x402, Textile RFQ, cron every 20 min; folder map of `src/lib/*`.
  8. **Run locally** — `npm install`, `.env.example` → `.env.local`, `npm run db:migrate`, `npm run dev`, the full gate command.
  9. **For clients** — link to `docs/guides/pay-with-usat.md`.

- [ ] **Step 2: Check relative links exist**

  Run: `grep -oE '\]\((\./)?[^)#:]+\)' README.md | sed -E 's/^\]\((\.\/)?//; s/\)$//' | xargs -I{} sh -c 'test -e "{}" && echo "ok {}" || echo "MISSING {}"'`
  Expected: no `MISSING` line.

- [ ] **Step 3: Check `replaceUsageBlock` accepts it**

  Run: `npx tsx -e 'import fs from "node:fs"; import { replaceUsageBlock } from "./scripts/lib/usage-stats"; replaceUsageBlock(fs.readFileSync("README.md","utf8"), "x"); console.log("markers ok")'`
  Expected: `markers ok`.

- [ ] **Step 4: Draft the organiser message** (English, 5–8 lines) asking main spec §15 questions 1–2, and give it to the user in chat (not committed).

- [ ] **Step 5: Gate, commit, merge Phase A**

  Run: `npm test && npm run typecheck && npm run lint && npm run build`
  Expected: all exit 0.

  ```bash
  git add README.md
  git commit -m "docs: README for the hackathon submission"
  ```
  Then ask the user before merging `--no-ff` into `main` and pushing (Phase A).

### Task 4: Screenshots

**Files:**
- Create: `docs/screenshots/*.png`, `docs/screenshots/README.md` (index: file → screen → size)

**Interfaces:**
- Consumes: production `https://cobro-agent.vercel.app`.
- Produces: PNGs Task 6 uploads with `--screenshot <path>`.

- [ ] **Step 1: Public screens with Playwright MCP** at desktop 1440×900 and mobile 390×844: landing `/`, sign-in `/signin`, a real open invoice's `/pay/<slug>` (the user gives a slug of a test invoice). Name files `<screen>-<desktop|mobile>.png`.
- [ ] **Step 2: Signed-in screens** (dashboard, invoices list, invoice document with timeline, new-invoice form with preview, treasury/agent activity, settings/addresses): the user signs in on production in the Playwright browser window (the builder never handles the email code); if that is not possible, the user captures them at the same two sizes from the index list.
- [ ] **Step 3: Check** every file in the index exists and no screenshot shows an email, a full address outside the app's own shortened form, or a balance the user wants hidden (the user looks at each).

  Run: `ls docs/screenshots/*.png | wc -l`
  Expected: the count in the index.
- [ ] **Step 4: Commit** `git add docs/screenshots && git commit -m "docs: product screenshots for the submission"`.

### Task 5: Demo video script

**Files:**
- Create: `docs/demo/video-script.md`, `docs/demo/captions.srt`

**Interfaces:**
- Consumes: spec §3.7 flow; production data prepared by the user.
- Produces: the script the user records from.

- [ ] **Step 1: Write `video-script.md`**: a prep checklist (accounts signed in, a client wallet with USA₮/wARS, an invoice ready, a saved address already past its 24 h wait, a recent agent swap to show, celoscan and 8004scan tabs open, recorder at 1920×1080); then the 8 scenes of spec §3.7 with, per scene: duration, what to click, the caption text (≤ 12 words per caption, English), and a `CUT` marker where the cron (20 min) or the 24 h wait forces a cut. Total ≤ 3:15.
- [ ] **Step 2: Write `captions.srt`** with the same caption texts and the scene timings.
- [ ] **Step 3: Check** the SRT is well-formed and fits the length:

  Run: `grep -cE '^[0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3} --> [0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3}$' docs/demo/captions.srt && tail -4 docs/demo/captions.srt`
  Expected: a count equal to the number of captions in the script, and a last end time ≤ `00:03:15,000`.
- [ ] **Step 4: Commit** `git add docs/demo && git commit -m "docs: demo video script and captions"`.

### Task 6: Final numbers, Loops entry, evaluation

**Files:**
- Modify: `README.md` (usage block), `docs/superpowers/smoke/2026-10-payments.md` (USA₮ smoke row)

**Interfaces:**
- Consumes: Task 1 CLI, Task 4 PNGs, the user's video URL.

- [ ] **Step 1: The user runs** `npx tsx --env-file=<their main env file> scripts/usage-stats.mts --exclude=.superpowers/team-exclusions.json --write-readme` (via `!` in the prompt). The builder reviews the diff of `README.md` only.
- [ ] **Step 2: Record the USA₮ smoke** (tx hash, amount, PASS/FAIL, attribution of the settlement) in `docs/superpowers/smoke/2026-10-payments.md`.
- [ ] **Step 3: Gate, commit, merge Phase B** — full gate; commit `docs: final usage numbers and USA₮ smoke`; ask the user, then merge `--no-ff` and push.
- [ ] **Step 4: Draft the Loops update without `--confirm`:**

  ```bash
  npx -y loopshouse project update --event agents-on-open-rails \
    --tagline "<draft>" --description "<draft from README sections 2–6, real numbers, roles only>" \
    --videoUrl <user's URL> --screenshot docs/screenshots/<file>.png … \
    --bountyIds e541ed4a-0971-4db4-82d2-043add3b6c49 --bountyIds 58f7e28c-b2da-4425-89b7-6a7e0fa099ac \
    --bountyIds 603875c0-cce6-44c8-a001-a7342006e340 --bountyIds 8f651898-2fdc-4f6e-8c12-407cd08a9f7d \
    --bountyIds f47e6f01-94c0-467b-afb9-8c004f0bae13 --bountyIds 1a1b28af-acb1-4754-9770-0e9494b38555
  ```
  (Drop the two Textile ids if the filler missed the 2026-11-04 cut-off.) Show the returned draft to the user verbatim.
- [ ] **Step 5: After the user's explicit yes**, re-run with `--confirm`; then `npx -y loopshouse project get --event agents-on-open-rails` and check: description has no "Work in progress", `videoUrl` set, bounty count matches, `celo.agentWallet` still set.
- [ ] **Step 6: Evaluate** — `npx -y loopshouse evaluate --event agents-on-open-rails --sponsor stable-agents-latam`, then `stable-agents-open-corridors-usa-with-x402` (and `stable-agents-open-corridors` if the filler is in). Run each prompt in the repo, report strengths, gaps and suggested fixes to the user; agreed fixes go through the same draft → yes → confirm loop.
