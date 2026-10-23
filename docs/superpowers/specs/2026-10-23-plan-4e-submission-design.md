# Plan 4e: hackathon submission — design

- **Date:** 2026-10-23
- **Parent specs:** `2026-10-20-plan-4-real-mvp-design.md` §8 (workstream 5) and `2026-10-08-cobro-design.md` §14 "Finish"
- **Deadline:** Loops submission Mon 2026-11-09 09:00 GMT. Internal target: everything final on 2026-11-08.

Marks: **(user)** = decided by the user; **(builder's call)** = a default the builder may change with a
reason; unmarked = context or fact.

## 1. Intent

Cobro is built and live (Plans 1–5). What it lacks is proof a judge can read in five minutes: that real
people outside the team use it, that money moves on Celo mainnet under Cobro's attribution tag, and
which judging criteria each part answers. Plan 4e produces that proof and the submission that carries it.

## 2. Current state (facts, 2026-10-23)

- Loops entry **exists** (slug `cobro-bb02d`, owner = user): name, tagline, description, repo
  `https://github.com/hms1499/cobro-agent`, demo `https://cobro-agent.vercel.app`, one screenshot.
  `loops project fields` reports nothing missing. Agent wallet `0x64ad61211c1b0b7f20b3e04b49661f30f152ae78`,
  ERC-8004 identity registered (agent #9884), attribution tag `celo_bc3965e128ba`, first tagged tx recorded.
- The description still says "Work in progress". No video. The entry targets **all 7 bounties**, including
  the two Build with buy bounties.
- The repo has **no README**.
- **So far the user is the only person using the app (user).** Every mainnet payment came from team wallets.
- USA₮ has **never** been paid on mainnet: payments smoke A used USD₮ because the payer held no USA₮
  (`docs/superpowers/smoke/2026-10-payments.md`). Proven on PROD 2026-10-22: wARS invoice payment via the
  facilitator → autonomous Textile swap to USD₮ → tagged withdrawal.
- The Celo x402 facilitator does not write attribution tags on settlement transactions. Main spec §15
  questions 1–2 to the organisers (how x402 settlements and per-user treasury wallets are credited) are
  still unanswered.
- No public leaderboard exists. The event page says the live leaderboard runs the same onchain query used
  for scoring; winners are announced 2026-11-13.

## 3. Goals

1. **Tracks targeted (user), in priority order:**
   1. Stable Agents: LatAm (Ripio) — $1,500 / $500. The main track.
   2. Open Corridors: USA₮ with x402 — $750 / $250.
   3. Open Corridors: Textile FX — $750 / $250. Done last, as a separate spec (§9).
2. **Real users (user):** the user brings a few people who already use web3 and whose Celo wallets had
   activity before 2026-10-06 (the event's "independent user" rule: not our wallet, not first funded by us,
   Celo activity before 2026-10-06). Each plays a real role: freelancer (signs in, issues invoices) or
   client (pays from their own wallet).
3. **Repeat USA₮ flow:** at least one outside client pays the same freelancer more than once in USA₮,
   through a weekly recurring invoice **(builder's call)**. Track 2 weighs repeat payments from the same
   counterparty at 25%.
4. **README** in English **(builder's call: judges read English; the UI is English-first)** covering:
   what Cobro is and who it serves; the flow (invoice → x402 payment → agent converts via Textile →
   withdrawal); a per-track section mapping features to that track's judging criteria; architecture; how to
   run locally; and a table of real mainnet activity with celoscan links.
5. **Usage numbers** generated from data, not typed by hand: number of freelancers, independent payers,
   payments by asset, repeat payers, volume in USD, agent swaps and withdrawals, with tx links. Used in the
   README, the Loops description and the video's last scene.
6. **Screenshots**, desktop and mobile, of the redesigned screens (landing, dashboard, invoice document,
   new-invoice form with preview, pay page, treasury/agent activity, settings/addresses).
7. **Demo video (user):** one feature flow that covers the whole project, **screen recording with text
   captions, no voice (user)**. The builder writes the script, the shot list and the caption text; the user
   records. Proposed flow, about 3 minutes **(builder's call)**:
   1. Landing: what Cobro is and for whom.
   2. Email sign-in: the wallet is created in the background.
   3. New weekly recurring invoice with live preview, amount in the freelancer's currency.
   4. Client pays from their own wallet on `/pay` in wARS or USA₮ over x402.
   5. The agent acts on its own: converts the excess over the reserve to USD₮ via Textile (or asks for
      approval above the limit); the activity timeline shows the tagged tx.
   6. Withdrawal to a saved address (24-hour wait on new addresses as anti-theft).
   7. Proof: the tagged tx on celoscan, agent #9884 on 8004scan.
   8. Close: real user and transaction numbers.
   The agent runs on a 20-minute cron and new addresses wait 24 hours, so the script marks where the
   recording cuts and which steps use data prepared in advance.
8. **Loops entry updated:** drop "Work in progress", rewrite the description around real usage and the
   three tracks, add screenshots and the video URL, and **remove the two Build with buy bounties** so the
   entry targets the 5 bounties of the 3 tracks (user agreed to focus on 3 tracks).
9. **`loops evaluate`** for each targeted sponsor; report the feedback and fix what is agreed.

## 4. Non-goals

- Build with buy track (Cobro does not pay for third-party x402 services).
- New product features beyond what the proof needs. Anything that looks like a feature (e.g. a public
  stats page) needs the user's yes first.
- Spanish UI, chat invoices, wallet sign-in (still out, from the Plan 4 spec).
- Voice-over in the video.

## 5. Anti-goals

- Never `loops project update --confirm` (or create) without showing the user the draft and getting an
  explicit yes.
- Never inflate numbers: no self-payments counted as independent, no wallets we funded counted as users,
  no fake or staged users presented as real. If a number is small, it is shown as it is.
- Never send an untagged transaction from code we control; never touch a user's private key or seed.
- Never print secrets while collecting numbers (DB URL, keys).

## 6. Constraints

- Everything in CLAUDE.md (mainnet only, tag on every tx we send, `t()` for UI strings, MASTER.md,
  secrets, ask before destructive DB operations or mainnet transactions, one branch per plan, full gate).
- Production data lives on Neon **main**; `.env.local` points at Neon **dev**. Reading production numbers
  needs a read-only path the user approves (the user runs SQL in the Neon editor, or provides a read-only
  connection). The builder never reads `.env.local` (a hook blocks it).
- Loops CLI runs as `npx -y loopshouse …` (no global `loops` binary installed). Credits: 100, unused.

## 7. Calendar (builder's call)

- Oct 23–26: README draft, stats script, screenshot list, video script. **User:** invite users; first
  outside freelancer signs up; first weekly recurring invoice to an outside client by **Oct 26** so two or
  three periods settle before Nov 9 (weekly periods from Oct 26: Oct 26, Nov 2; earlier start gives a third).
- Oct 23–27: first USA₮ payment on mainnet (a team smoke first, then outside clients).
- Oct 27–Nov 4: users keep paying; Textile filler spec and build (§9).
- Nov 5–7: final numbers, screenshots, video recording, Loops draft, evaluate, fixes.
- Nov 8: submit (after the user's yes).

## 8. Risks

- **USA₮ path untested on mainnet.** A first USA₮ payment (team smoke) must pass before any outside
  client is asked to pay in USA₮.
- **Attribution of x402 settlements.** The facilitator sends the settlement tx, untagged. If the scoring
  query credits only tagged txs from our wallets, client payments may not count; the agent's tagged swaps
  and withdrawals will. The user asks the organisers (Telegram / office hours, Thursdays 12:00 GMT)
  main spec §15 questions 1–2; the README states how each tx is attributable (payTo = the freelancer's
  treasury wallet).
- **Too few users.** The submission shows what exists honestly; the Impact criterion also accepts "a
  credible path to users".
- **wARS liquidity** is thin (~$850/day): keep test amounts small.

## 9. Track 3: Textile FX filler (separate spec, later)

Agreed so far **(user)**: done after tracks 1 and 2; capital about **20 USD₮**; Cobro acts as a market
maker (filler) answering Textile RFQs. Facts from Textile's "How to become a filler" guide: the open-source
bot Stitch does the quoting loop; connecting needs no prior email, but Textile sends a confirmation link
that must be clicked before RFQ flow arrives; contact@textilecredit.com only if blocked or the pair is not
on a corridor. Judged on P&L (40%), volume quoted and filled from independent traders (30%), originality
(30%). Its own spec covers strategy, where the bot runs, and how the received wARS/wBRL is sold back.

## 9a. Calls made after the builder check (builder's call unless marked)

- **Who counts as independent.** Independent = **payers** (client wallets that sent a payment), judged by
  the event rule. Freelancers are counted as sign-ups (outside people onboarded), never as independent
  onchain users: their treasury wallets are new Para wallets that our operator funds with gas, so they fail
  "not first funded by us" by design. The event FAQ says onboarding new people is measured in other ways.
- **Team exclusion list.** The stats exclude every wallet and account of the team. The user supplies the
  list once (their emails, `0xd1d0…3B66`, the agent/operator wallet, any throwaway payer keys); the stats
  script takes it as input and prints which rows it excluded.
- **Attribution answer cut-off: 2026-10-29.** If the organisers have not answered by then, the plan goes
  ahead as written and the README explains how each tx is attributable.
- **Textile filler is its own spec, plan and branch.** Cut-off **2026-11-04**: if the filler has no live
  fills by then, the two Textile bounties are removed from the Loops entry and the README drops that
  section. Until then they stay.

## 9b. User answers to the builder check (2026-10-23)

- **Untagged x402 settlements (user):** whatever the organisers answer, Cobro keeps settling through the
  Celo facilitator. No self-settlement feature in 4e. Tagged agent swaps and withdrawals carry the
  attribution; the README explains how each payment links to Cobro (payTo = the freelancer's treasury).
- **Naming users (user):** public material (README, video, Loops) names users **by role only**, e.g.
  "freelancer in Argentina" or "client, a web3 team". No names, no quotes. Wallet addresses appear only
  as celoscan links in the activity table, which are public onchain anyway.
- **Getting USA₮ (user):** the builder writes a short English how-to for clients (and the user's own
  USA₮ smoke) on getting USA₮ on Celo mainnet and paying a Cobro invoice. It lives in the repo
  (`docs/guides/pay-with-usat.md`, builder's call on the path) and is linked from the README. Sources
  are checked against current docs (sponsor knowledge graph / official pages), not written from memory.

## 10. Left to the builder

README structure and wording within §3.4; the stats script's form (script vs SQL the user runs) and how it
decides "independent" (e.g. a wallet's tx count before the 2026-10-06 block); screenshot tooling and
which signed-in screens the user captures; the video script's exact captions and timings; the Loops
description text (shown to the user before any write).
