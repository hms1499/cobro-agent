# Cobro demo video: script and shot list

One end-to-end flow, screen recording with English captions, no voice. Target length 3:12 (limit 3:15).
Captions are also in [`captions.srt`](captions.srt) with the same text and timings; upload the SRT with
the video (YouTube "Subtitles", Loom "Captions") or burn it in.

Two roles appear on screen, named by role only: **the freelancer** (Cobro account, home currency ARS) and
**the client** (their own browser wallet). No names, emails or full addresses are spoken or captioned.

## Prep checklist

Do all of this before pressing record. Items marked *(prepared)* are shown on screen as data that already
exists, because the agent cron (about 20 minutes) and the 24-hour address wait cannot happen live.

- [ ] **Recorder** at 1920×1080, browser zoom 100%, bookmarks bar and extensions hidden, notifications off.
- [ ] **Two browser profiles**, so the cut between roles is clean:
  - Freelancer profile: signed out of Cobro at the start (scene 2 signs in). Email inbox open in a second
    tab, ready to show only the code line.
  - Client profile: MetaMask or Rabby on Celo mainnet holding a few dollars of **wARS**. No CELO is
    needed: the client only signs and the facilitator pays the gas. Wallet unlocked.
- [ ] **Freelancer account** set up on production: home currency **Argentine pesos (ARS)**, a small spending
  reserve (for example ARS 1,000), agent **Active**, approval mode "Before using my dollars" (saving extra
  pesos needs no approval). Check on `/app/rules` that "If the agent ran now, it would" says it does nothing.
- [ ] **Invoice amount** for scene 3: above the reserve by at least US$1 (the agent's minimum conversion) and
  small, because wARS liquidity is thin. For example **ARS 3,000**.
- [ ] **(prepared) Saved address** on `/app/settings/addresses` showing **Ready** (added more than 24 hours
  before recording), labelled with an exchange name, for example "Binance".
- [ ] **(prepared) Fallback agent action**: one recent "Converted … to dollars" entry on `/app/rules` from an
  earlier wARS payment, in case scene 5's live conversion is slow (see the CUT in scene 5).
- [ ] **Proof tabs** open in the freelancer profile, in order:
  1. Celoscan page of the agent's tagged conversion (the one from scene 5, or the fallback). Check it first
     with `/celo-tx-check <hash>` and confirm the attribution tag is found.
  2. `https://8004scan.io/agents/celo/9884`
- [ ] **Final numbers** for scene 8 from Task 6 (`scripts/usage-stats.mts`), copied into caption 26 of
  `captions.srt`. Show them as they are, however small.
- [ ] **Hide** anything private: no email in the address bar or account menu, balances you do not want
  public collapsed, the "Details" disclosures closed unless a scene opens them.

## Scenes

`CUT` means stop recording (or cut in editing) and resume at the next shot; the captions keep running in
the final edit, so each cut lands between two captions.

### 1. Landing: what Cobro is and for whom (0:00–0:16, 16 s)

Profile: freelancer. Page: `https://cobro-agent.vercel.app/`.

| Time | Action | Caption |
|---|---|---|
| 0:00–0:05 | Hero in view: "Your clients pay in dollars. You keep pesos." | Cobro: invoices and a treasury agent for LatAm freelancers. |
| 0:05–0:10 | Scroll slowly to "From invoice to savings in three steps"; let the walkthrough play. | Clients pay in stablecoins on Celo. You keep pesos. |
| 0:10–0:16 | Scroll to "An agent that works within your rules"; pause on the board. | The agent saves the rest in dollars, within your rules. |

### 2. Email sign-in, wallet created in the background (0:16–0:34, 18 s)

| Time | Action | Caption |
|---|---|---|
| 0:16–0:22 | Click **Sign in**. Type the freelancer email, click **Continue with email**. | Sign in with an email. No password, no seed phrase. |
| 0:22–0:28 | Para's code field appears. Type the 6-digit code. | Type the 6-digit code from your inbox. |
| | `CUT` while you fetch the code from the inbox tab; never show the inbox itself. | |
| 0:28–0:34 | Home page loads: "Hi, …", the balance card and "Your agent is on". | Your account and Celo wallets are created in the background. |

### 3. New weekly recurring invoice with live preview (0:34–1:02, 28 s)

Page: `/app/invoices/new` (click **New invoice**, or press Cmd+K and type "new").

| Time | Action | Caption |
|---|---|---|
| 0:34–0:41 | Fill **Who are you billing?** with a client role (for example "Web3 studio"), **What is it for?** ("Weekly design retainer"), **Amount** 3000, **Currency** Argentine pesos (ARS). | New invoice: client, what it's for, amount in pesos. |
| 0:41–0:48 | **Repeat** → **Every week**. Hover the help text. | Repeat every week: one link the client can bookmark. |
| 0:48–0:55 | Pause on **What your client will see**; the preview updates as you type. | The preview shows exactly what your client will see. |
| 0:55–1:02 | Click **Create invoice**, then **Copy link** under "Payment link (always shows the current invoice)". | Create it and copy the payment link. |

### 4. The client pays from their own wallet over x402 (1:02–1:40, 38 s)

`CUT` to the client profile. Paste the copied `/r/…` link.

| Time | Action | Caption |
|---|---|---|
| 1:02–1:09 | Pay page loads: invoice from the freelancer, amount in ARS, "Choose how to pay". | The client opens the link. No account, no sign-up. |
| 1:09–1:16 | Pan over the four currencies; hover **US dollar (USA₮)**, "Recommended for US clients". | Four currencies. USA₮ is recommended for US clients. |
| 1:16–1:23 | Pick **Argentine peso (wARS)**. "You pay …" and "Rate locked for …" appear. | Here the client pays in Argentine pesos (wARS). |
| 1:23–1:31 | **Connect wallet** → **Pay …**. The wallet asks for a signature (no gas); sign it. | One signature over x402. Cobro covers the network fee. |
| | `CUT` if "Confirming your payment…" takes longer than a few seconds. | |
| 1:31–1:40 | "Payment complete". Click **View receipt on Celoscan**, show the tab for 2 seconds. | Paid. Settled on Celo mainnet, straight to the freelancer. |

### 5. The agent acts on its own (1:40–2:10, 30 s)

`CUT` back to the freelancer profile. The agent runs right after each payment and again about every
20 minutes.

| Time | Action | Caption |
|---|---|---|
| 1:40–1:47 | **Invoices**: the new invoice shows **Paid**. Open it; the timeline ends in "Paid". | Back with the freelancer: the invoice is marked paid. |
| | `CUT` until `/app/rules` shows a new "Converted … to dollars" entry. If nothing appears within 20 minutes (the agent waits for a fair rate), use the *(prepared)* fallback entry instead. | |
| 1:47–1:55 | **Agent** (`/app/rules`): "What your agent did" → the new "Converted … to dollars" entry. | Pesos above the reserve? The agent saves the extra in dollars. |
| 1:55–2:03 | Click **Why?** to open the explanation and the price line. | It converts through Textile FX, within your caps and price limit. |
| 2:03–2:10 | Point at **View on Celoscan** on the same entry (open it in scene 7). Scroll up to show the spending and savings bars. | Every action explains why, with a tagged transaction. |

### 6. Withdrawal to a saved address (2:10–2:34, 24 s)

Page: `/app/withdraw` (from the home page **Withdraw** button).

| Time | Action | Caption |
|---|---|---|
| 2:10–2:17 | **What to withdraw** → Dollar (USD₮). Type a small amount (for example 1). | Cash out to an exchange or wallet you saved. |
| 2:17–2:25 | **Send to**: pick the *(prepared)* saved address marked ready. Briefly show `/app/settings/addresses` with **Ready** and the 24-hour rule in the intro, then come back. | New addresses are confirmed by email and wait 24 hours. |
| 2:25–2:34 | Click **Withdraw**. "Sent to …" appears. | The agent sends it and pays the network fee. |

### 7. Proof onchain (2:34–2:56, 22 s)

| Time | Action | Caption |
|---|---|---|
| 2:34–2:41 | Celoscan tab of the agent's conversion: status Success, the token transfers. | Every transaction Cobro sends carries its attribution tag. |
| 2:41–2:48 | Scroll to **Input Data**; let the end of it be visible. | On Celoscan, the input data carries Cobro's tag. |
| 2:48–2:56 | 8004scan tab: agent #9884 on Celo. | Cobro's agent is registered on ERC-8004 as agent #9884. |

### 8. Close: real numbers (2:56–3:12, 16 s)

A static title card (or the README's usage table, zoomed) with the numbers from Task 6.

| Time | Action | Caption |
|---|---|---|
| 2:56–3:04 | Title card with the Task 6 numbers. | So far: {freelancers} freelancers, {payments} payments, {conversions} agent conversions. |
| 3:04–3:12 | Back to the landing hero with the URL visible. | cobro-agent.vercel.app. Your clients pay in dollars. You keep pesos. |

## After recording

- Check the export is 3:15 or shorter and that every caption is readable (at least 5 seconds each).
- Replace the `{…}` placeholders in caption 26 before uploading the SRT.
- Upload unlisted (YouTube) or as a public Loom, and send the URL for Task 6.
