# Plan 4b: Withdrawal Address Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freelancer can save withdrawal addresses (label + Celo address), confirmed by a 6-digit code emailed to the account address, usable 24 hours after they are added, and withdraw to them. The server's treasury policy enforces this rule.

**Architecture:** A new module `src/lib/addresses/` holds input validation, the saved-address repository, the email code flow and the email texts. `src/lib/email/` holds a small Resend sender that calls the REST API through an injected `fetch`, so no SDK dependency is added. `encodeTreasuryCall` widens its withdrawal rule from "personal wallet only" to "personal wallet or a saved address past its 24 h wait". `withdraw()` resolves the destination from the database itself and never trusts an address sent by the client. UI: a new page `/app/settings/addresses`, reached from Settings and from the withdraw form, and a destination picker on `/app/withdraw`.

**Tech Stack:** Next.js 16.4 App Router (`cacheComponents`, Server Actions with `useActionState`), Drizzle + Neon (PGlite in tests), viem address helpers, Node `crypto` (HMAC, `randomInt`, `timingSafeEqual`), Resend REST API, Vitest 5, Playwright MCP for the browser pass.

**Spec:** `docs/superpowers/specs/2026-10-20-plan-4-real-mvp-design.md` §5 (binding), with §3 anti-goals and §10 constraints. Background: the main spec `docs/superpowers/specs/2026-10-08-cobro-design.md` §6.1/§6.2 (withdrawal policy).

## Global Constraints

- Allowed withdrawal recipients = the user's `personalWallet` plus that user's saved addresses where `removed_at IS NULL AND usable_at <= now`. This is enforced in `encodeTreasuryCall` and `withdraw()`, not only in the UI. The agent (`runTreasuryForUser`) always passes `withdrawalAddresses: []`.
- Wait: `ADDRESS_WAIT_MS = 24 * 60 * 60 * 1000`. Removing an address takes effect immediately. Adding a removed address again means a new row and a new 24 h wait.
- Code: 6 digits from `crypto.randomInt`, stored only as HMAC-SHA256 (key `SESSION_SECRET`, message `address-code:${userId}:${code}`). Valid 10 min, max 5 wrong attempts, one new code per 60 s, max 10 codes per user per rolling 24 h. A new code supersedes any earlier unused one. The code is bound to the label and address it was requested for.
- Notice email after every successful add. A failed notice is logged (`console.error`, no email address or code in the log) and does not undo the add.
- Address validation: `viem` `isAddress` (strict checksum for mixed case), input trimmed. Refuse the zero address, the user's own treasury, the user's personal wallet ("already your Cobro wallet"), every `TOKENS[*].address` and `TOKENS[*].feeCurrency`, `TEXTILE_REACTOR`, a duplicate of an active saved address, and more than `MAX_SAVED_ADDRESSES = 10` active addresses. Label: trimmed, 1–40 characters. Addresses are stored checksummed (`getAddress`).
- Email: Resend, free tier only (3,000/month, 100/day). Env `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Cobro <no-reply@mail.huyne.me>`). Both are optional in `serverEnvSchema` and resolved with `requireValue` at send time. Secrets go in through stdin only and are never printed (CLAUDE.md). Ask the user before anything paid.
- Every withdrawal still goes through `signTreasuryTx` (attribution tag). Celo mainnet only.
- UI: MASTER.md. All text through `t()` with keys in `src/i18n/en.ts`. The address sits behind "Details" (`common.details`). Touch targets `min-h-11`, one primary button per screen, `role="alert"` / `aria-live` for errors and status, Lucide icons `aria-hidden`.
- Warning copy (exact, key `addresses.warning`): "Only use an address that accepts this money on the Celo network. If the exchange or wallet does not support Celo, the money can be lost." Task 5 may name exchanges only after confirming them.
- `cacheComponents`: pages read the user and DB inside `<Suspense>`. Read `node_modules/next/dist/docs/` (Server Actions, forms) before writing Next.js code (AGENTS.md).
- Branch `plan-4b-address-book` in a worktree. Full gate `npm test && npm run typecheck && npm run lint && npm run build` before a task is claimed done.
- The 4a/4d deferred minors stay deferred (not in this plan).

## Review Focus

1. **Wrong-code guessing:** after 5 wrong attempts the code is dead, even if the 6th guess is right. → Task 2 test "locks the code after five wrong attempts".
2. **Double submit / two tabs on confirm:** the same code confirmed twice creates exactly one address. → Task 2 test "a code works once".
3. **Odd address input:** surrounding spaces, all-lowercase (accepted), mixed case with a bad checksum (refused), missing `0x`, an ENS name, the treasury typed in lowercase (refused as own). → Task 1 `parseAddressForm` tests.
4. **Removed address or another user's id sent to withdraw** (stale tab, crafted form): refused with nothing signed. → Task 3 withdraw tests.
5. **Email provider down or key missing:** the user sees "We couldn't send the code", no usable code remains, and they can retry at once (no cooldown from a failed send). → Task 2 test "a failed send leaves nothing behind".

---

### Task 1: Schema, address validation and the saved-address repository

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/testing.ts` (`resetDb` truncates the two new tables)
- Create: `drizzle/0004_*.sql` (generated), `src/lib/addresses/validate.ts`, `src/lib/addresses/repo.ts`
- Test: `src/lib/addresses/validate.test.ts`, `src/lib/addresses/repo.test.ts`

**Interfaces:**
- Produces (schema): `withdrawalAddresses` table `withdrawal_addresses` (`id` uuid pk, `user_id` fk cascade, `label` text, `address` text, `created_at`, `usable_at` timestamptz not null, `removed_at` timestamptz null) with partial unique index `withdrawal_addresses_active_uq` on `(user_id, address) WHERE removed_at IS NULL`. Table `emailCodes` / `email_codes` (`id` uuid pk, `user_id` fk cascade, `code_hash` text, `label` text, `address` text, `attempts` int default 0, `expires_at`, `used_at` null, `created_at`; index on `(user_id, created_at)`). New nullable column `treasury_txs.to_label` (`toLabel`). Types `WithdrawalAddressRow`, `EmailCodeRow`.
- Produces (`validate.ts`): `ADDRESS_WAIT_MS`, `ADDRESS_LABEL_MAX = 40`, `MAX_SAVED_ADDRESSES = 10`, `type AddressField = "label" | "address"`, `interface NewAddress { label: string; address: Address }`, `parseAddressForm(fields: Record<string, string>, ctx: { treasury: Address | null; personalWallet: Address | null; saved: readonly Address[] }): FormResult<NewAddress, AddressField>`. Error keys: `addresses.error.label`, `addresses.error.format`, `addresses.error.zero`, `addresses.error.own`, `addresses.error.personal`, `addresses.error.contract`, `addresses.error.duplicate`, `addresses.error.full`.
- Produces (`repo.ts`): `interface SavedAddress { id: string; label: string; address: Address; createdAt: Date; usableAt: Date }`; `listSavedAddresses(db: Db, userId: string): Promise<SavedAddress[]>` (active only, oldest first); `insertSavedAddress(db: Db, userId: string, input: NewAddress, now: Date): Promise<SavedAddress>` (`usableAt = now + ADDRESS_WAIT_MS`); `removeSavedAddress(db: Db, userId: string, id: string, now: Date): Promise<boolean>`; `usableSavedAddress(db: Db, userId: string, id: string, now: Date): Promise<SavedAddress | null>`; `isUsable(a: SavedAddress, now: Date): boolean`.

- [ ] **Step 1: Write failing tests**
  - `validate.test.ts` "accepts a labelled address, trimmed and checksummed": `{ label: "  Binance ", address: " 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 " }` → `{ ok: true, data: { label: "Binance", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" } }`.
  - "refuses what it cannot read": address with a wrong mixed-case checksum, `"d8da6bf2…"` without `0x`, `"vitalik.eth"`, `""` → `addresses.error.format`. Label `""` or 41 characters → `addresses.error.label`.
  - "refuses addresses that would lose or loop money": zero address → `zero`; `TEST_TREASURY` in lowercase → `own`; the personal wallet → `personal`; `TOKENS.USDT.address`, `TOKENS.USDT.feeCurrency`, `TEXTILE_REACTOR` → `contract`; one already in `saved` → `duplicate`; `saved.length === 10` → `full`.
  - `repo.test.ts` "a new address waits 24 hours": insert at `NOW` → `usableAt` is `NOW + 24h`; `usableSavedAddress` at `NOW + 24h − 1 ms` → `null`, at `NOW + 24h` → the row.
  - "removing takes effect at once and re-adding waits again": remove → `listSavedAddresses` empty, `usableSavedAddress` null even after 48 h; insert the same address again → succeeds with a fresh `usableAt`.
  - "never returns another user's address": `usableSavedAddress(db, otherUser.id, row.id, later)` → `null`; `removeSavedAddress(db, otherUser.id, row.id, …)` → `false`.
- [ ] **Step 2:** `npx vitest run src/lib/addresses` → FAIL (modules missing).
- [ ] **Step 3:** Add the schema, run `npm run db:generate` (rename the file to `0004_address_book.sql` and fix `meta/_journal.json` tag if drizzle names it randomly, as `0002_tx_status_failed` was), add both tables to `resetDb`, implement `validate.ts` and `repo.ts`.
- [ ] **Step 4:** `npx vitest run src/lib/addresses` → PASS. Then the full gate.
- [ ] **Step 5:** Commit `feat(addresses): saved withdrawal addresses table, validation and repository`.
- [ ] **Step 6:** Ask the user, then `npm run db:migrate` (Neon **dev** branch). Expected: migration 0004 applied, no error.

### Task 2: Email sender and the emailed-code flow

**Files:**
- Modify: `src/lib/config/server.ts` (`RESEND_API_KEY`, `EMAIL_FROM` optional strings), `.env.example` (names only; see Task 6 about the user's uncommitted notes), `src/i18n/en.ts` (`email.*` keys)
- Create: `src/lib/email/send.ts`, `src/lib/addresses/emails.ts`, `src/lib/addresses/codes.ts`
- Test: `src/lib/email/send.test.ts`, `src/lib/addresses/codes.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseAddressForm`'s `NewAddress`, `insertSavedAddress`, `listSavedAddresses`, `MAX_SAVED_ADDRESSES`, `emailCodes`.
- Produces (`send.ts`): `interface EmailMessage { to: string; subject: string; text: string }`; `type EmailSender = (message: EmailMessage) => Promise<void>`; `resendSender(opts: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender`, which POSTs `https://api.resend.com/emails` with `Authorization: Bearer <key>`, JSON `{ from, to: [to], subject, text }`, and on a non-2xx status throws `Error("Resend answered <status>")` without the body or the key; `liveEmailSender(): EmailSender`, which reads env lazily so an unset key throws when sending, not at import.
- Produces (`emails.ts`): `addressCodeEmail(code: string, pending: NewAddress): { subject: string; text: string }`, which names the label and the full address so the owner spots an address they don't know; `addressAddedEmail(saved: SavedAddress): { subject: string; text: string }`, which says it becomes usable in 24 hours and how to remove it (Settings → Withdrawal addresses).
- Produces (`codes.ts`): `CODE_TTL_MS = 600_000`, `CODE_MAX_ATTEMPTS = 5`, `CODE_COOLDOWN_MS = 60_000`, `CODES_PER_DAY = 10`; `interface CodeDeps { db: Db; now(): Date; secret: string; send: EmailSender }`; `requestAddressCode(deps: CodeDeps, user: { id: string; email: string | null }, pending: NewAddress): Promise<{ ok: true; expiresAt: Date } | { ok: false; error: "no_email" | "cooldown" | "daily_limit" | "send_failed" }>`; `confirmAddressCode(deps: CodeDeps, user: { id: string; email: string | null }, code: string): Promise<{ ok: true; address: SavedAddress } | { ok: false; error: "no_code" | "invalid" | "too_many" | "duplicate" | "full" }>`; `pendingAddressCode(db: Db, userId: string, now: Date): Promise<{ label: string; address: Address; expiresAt: Date } | null>`.
- Rules: confirm counts the attempt with one `UPDATE … SET attempts = attempts + 1 WHERE id = … AND used_at IS NULL AND expires_at > now RETURNING` before comparing (`timingSafeEqual`). The success path marks `used_at` and inserts the address in one transaction (the partial unique index is the last line of defence against a duplicate). Input code is trimmed and spaces removed; anything other than 6 digits counts as a wrong attempt. When a send fails, the code row is deleted, so it consumes neither the cooldown nor the daily cap.

- [ ] **Step 1: Write failing tests** (PGlite; `send` is a `vi.fn`; the code is read from the captured message text)
  - `send.test.ts` "posts to Resend with the key in the header only": fake `fetch` records the request; URL, method, bearer header and JSON body as above. "throws on a refusal without leaking": 422 → error message `"Resend answered 422"` that does not contain the key.
  - `codes.test.ts` "emails a code bound to the address and confirms it": request → `send` called once to `ana@example.com`, text contains the label and the checksummed address. Confirm the 6 digits → `ok`, `listSavedAddresses` has it, the second `send` call is the notice.
  - "a code works once": confirm the same code twice → second `{ ok: false, error: "no_code" }`, one address row.
  - "locks the code after five wrong attempts": five wrong codes → `invalid` ×4 then `too_many` on the 5th; the right code next → `no_code`.
  - "expires after ten minutes": confirm at `+10 min` → `no_code`.
  - "a new code replaces the old one": request A, wait 61 s, request B → A's code is refused (`invalid`), B's code is accepted and adds B's address.
  - "limits how often codes are sent": second request within 60 s → `cooldown`; the 11th request in 24 h (61 s apart) → `daily_limit`.
  - "a failed send leaves nothing behind": `send` rejects → `send_failed`, `pendingAddressCode` null, and an immediate retry with a working `send` → `ok`.
  - "needs an account email": `email: null` → `no_email`, nothing sent.
  - "a failed notice does not undo the add": `send` resolves for the code and rejects for the notice → confirm still `ok`, address saved, `console.error` called (spy).
  - "rechecks the limit at confirm time": request with 9 saved, add a 10th directly, confirm → `full`.
- [ ] **Step 2:** `npx vitest run src/lib/email src/lib/addresses` → FAIL.
- [ ] **Step 3:** Implement `send.ts`, `emails.ts`, `codes.ts`, the env fields and the `email.*` keys.
- [ ] **Step 4:** `npx vitest run src/lib/email src/lib/addresses` → PASS. Then the full gate.
- [ ] **Step 5:** Commit `feat(addresses): emailed confirmation codes through Resend`.

### Task 3: Treasury policy and withdrawals to saved addresses

**Files:**
- Modify: `src/lib/chain/treasury-tx.ts`, `src/lib/treasury/executor.ts` (policy at ~line 459, `settleWithdrawal`), `src/lib/treasury/withdraw.ts`, `src/lib/treasury/explain.ts`, `src/i18n/en.ts` (`event.withdrawn.*`, `withdraw.error.destination_not_ready`, `withdraw.error.to`)
- Test: `src/lib/chain/treasury-tx.test.ts`, `src/lib/treasury/withdraw.test.ts`, `src/lib/treasury/explain.test.ts`

**Interfaces:**
- Consumes: Task 1 `usableSavedAddress`, `treasuryTxs.toLabel`.
- Produces: `TreasuryPolicy { allowedSpenders: readonly Address[]; personalWallet: Address | null; withdrawalAddresses: readonly Address[] }`. A withdraw call is allowed when `to` equals `personalWallet` or one of `withdrawalAddresses`. The transfer's recipient is `getAddress(call.to)`.
- Produces: `WithdrawField = "asset" | "amount" | "to"`; `WithdrawInput { asset: PayAsset; amount: bigint; to: "personal" | string }` (a saved address id otherwise). `parseWithdrawForm` reads `fields.to`; when it is missing or empty the error is `withdraw.error.to`. `WithdrawError` gains `"destination_not_ready"`.
- `withdraw()` resolves `to` inside the wallet lock: `"personal"` → `ctx.personalWallet` (null → `no_personal_wallet`); otherwise `usableSavedAddress(deps.db, userId, to, deps.now())` (null → `destination_not_ready`). The policy then holds only that one saved address. `extra.toLabel` is the saved label (null for the personal wallet). `settleWithdrawal` adds `toLabel` to the event data. Explain: `event.withdrawn.title` = "Sent {amount} to {destination}", where destination is `toLabel` or `t("withdraw.yourWallet")` ("your Cobro wallet"); `event.withdrawn.why` = "You asked to send this money out of your agent's account."

- [ ] **Step 1: Write failing tests**
  - `treasury-tx.test.ts` "sends withdrawals to the personal wallet or a saved address": with `withdrawalAddresses: [SAVED]` a transfer to `SAVED` decodes to `[SAVED, 7n]`; `STRANGER` still throws `TreasuryPolicyError`; `SAVED` with `withdrawalAddresses: []` throws. Update the existing `POLICY` constant with `withdrawalAddresses: []`.
  - `withdraw.test.ts` "sends to a saved address past its wait, with its label on record": address inserted at `NOW − 24h`, `to: id` → the transfer goes to that address, `treasury_txs.to_label` is "Binance", the `withdrawn` event data has `toLabel: "Binance"`.
  - "refuses a saved address still waiting, removed, or belonging to someone else": each → `{ ok: false, error: "destination_not_ready" }`, `signed` empty, no `treasury_txs` row.
  - "a saved address works without a personal wallet": personal null, `to: id` → ok.
  - Existing tests pass `to: "personal"`; `parseWithdrawForm` tests add `to` and one case with `to` missing → `{ to: "withdraw.error.to" }`.
  - `explain.test.ts` "names the destination of a withdrawal": event data with `toLabel: "Lemon"` → title "Sent US$1.00 to Lemon" (match the amount format already used in that file); without it → "…to your Cobro wallet".
- [ ] **Step 2:** `npx vitest run src/lib/chain src/lib/treasury` → FAIL.
- [ ] **Step 3:** Implement. Executor policy: `withdrawalAddresses: []`.
- [ ] **Step 4:** `npx vitest run src/lib/chain src/lib/treasury` → PASS. Then the full gate (the withdraw action still compiles; Task 5 adds the field to the form, and until then the action passes `to: "personal"` when the field is absent so nothing regresses between tasks).
- [ ] **Step 5:** Commit `feat(treasury): withdrawals to saved addresses past their 24-hour wait`.

### Task 4: Address book page

**Files:**
- Create: `src/app/app/settings/addresses/page.tsx`, `src/app/app/settings/addresses/actions.ts`, `src/app/app/settings/addresses/address-book.tsx` (client)
- Modify: `src/app/app/settings/page.tsx` (a "Withdrawal addresses" card: count and a link), `src/i18n/en.ts` (`addresses.*`)

**Interfaces:**
- Consumes: Task 1 `listSavedAddresses`, `removeSavedAddress`, `parseAddressForm`, `isUsable`; Task 2 `requestAddressCode`, `confirmAddressCode`, `pendingAddressCode`, `liveEmailSender`.
- Produces (`actions.ts`, all start with `requireUser()`): `requestCodeAction(prev: AddressState, formData): Promise<AddressState>`, `confirmCodeAction(prev: AddressState, formData): Promise<AddressState>`, `removeAddressAction(formData): Promise<void>`. `interface AddressState { step: "form" | "code" | "added"; errors: FieldErrors<AddressField | "code">; values: Record<string, string>; message: MessageKey | null }`. Each successful change calls `refresh()`.
- Page (inside `<Suspense>`): `h1` "Withdrawal addresses"; the intro (code by email, 24 h wait, notice email) and the warning `addresses.warning`; the list (label, chip "Ready" with `CircleCheck` or "Usable in about {hours} h" with `Clock`, computed as `Math.ceil` of the remaining hours; the address under Details; a "Remove" button, a plain secondary form button); then the add form. If a code is pending, the page opens on the code step: "We sent a code to {email}. It adds {label}." Below it: "Send a new code" (resubmits the pending label and address) and "Use a different address" (back to the form). No email on the account → a `role="status"` note instead of the form. Ten addresses saved → a note instead of the form.
- Settings card: "Withdrawal addresses", "{count} saved", link `min-h-11` to `/app/settings/addresses`.

- [ ] **Step 1:** Read `node_modules/next/dist/docs/` on Server Actions / `useActionState` / forms and follow the patterns in `src/app/app/withdraw/` and `src/app/app/rules/`.
- [ ] **Step 2:** Implement the page, actions, client component and copy. The actions map each code error to a `addresses.error.<error>` key (`no_email`, `cooldown`, `daily_limit`, `send_failed`, `no_code`, `invalid`, `too_many`, `duplicate`, `full`). Exact copy for `too_many`: "Too many wrong codes. Ask for a new one."; for `send_failed`: "We couldn't send the code. Try again in a minute."
- [ ] **Step 3:** The full gate passes.
- [ ] **Step 4: Browser check** (localhost, signed in, with Resend set up per Task 6 Step 1, or with `send` failing if not yet): the page shows at 375 and 1440 px with no horizontal scroll; an invalid address shows the field error with `aria-describedby`; a wrong code shows `role="alert"`; keyboard reaches every control. Record the results in the ledger.
- [ ] **Step 5:** Commit `feat(addresses): address book page with emailed confirmation`.

### Task 5: Destination picker on the withdraw page

**Files:**
- Modify: `src/app/app/withdraw/options.ts`, `src/app/app/withdraw/page.tsx`, `src/app/app/withdraw/withdraw-form.tsx`, `src/app/app/withdraw/actions.ts`, `src/i18n/en.ts` (`withdraw.title` → "Withdraw", `withdraw.intro`, `withdraw.to`, `withdraw.yourWallet`, `withdraw.sent` → "Sent to {destination}.", `withdraw.addAddress`)
- Test: `src/app/app/withdraw/options.test.ts`

**Interfaces:**
- Consumes: Task 1 `listSavedAddresses`, `isUsable`; Task 3 `WithdrawInput.to`.
- Produces: `interface WithdrawDestination { value: "personal" | string; label: string; address: Address; usableInHours: number | null }` and `withdrawDestinations(personalWallet: Address | null, saved: readonly SavedAddress[], now: Date): WithdrawDestination[]`. The personal wallet comes first when it is known, then saved addresses oldest first. `usableInHours` is null when the address is usable, else `Math.ceil(remaining / 3_600_000)`.
- Form: fieldset "Send to" with one radio row per destination. A waiting row is `disabled` and shows "Usable in about {hours} h". The personal wallet is checked by default (or the first usable row). One Details disclosure lists label → address for every row. `addresses.warning` shows whenever a saved address exists. A link "Add an address" goes to `/app/settings/addresses`. The success message names the destination label.

- [ ] **Step 1: Write failing test** `options.test.ts` "lists your wallet first and says when a new address is usable": personal + one saved address added 23 h ago + one added 25 h ago → values `["personal", idOld…]` order by creation, `usableInHours` `[null, 1, null]` respectively; no personal wallet → only the saved rows.
- [ ] **Step 2:** `npx vitest run src/app/app/withdraw` → FAIL.
- [ ] **Step 3:** Implement. The action passes `to` through `parseWithdrawForm` (drop the Task 3 fallback to `"personal"`).
- [ ] **Step 4:** `npx vitest run src/app/app/withdraw` → PASS. Then the full gate.
- [ ] **Step 5: Exchange check.** Use WebSearch to find out whether Ripio, Lemon and Binance accept USD₮ (and wARS for Ripio) deposits **on the Celo network**. Add a help line naming an exchange only if its own docs or support pages confirm it. Otherwise keep the generic warning. Record the sources in the ledger.
- [ ] **Step 6:** Commit `feat(withdraw): choose a saved address as the destination`.

### Task 6: Email setup, end-to-end check and release

No new code. Each step that touches money, secrets, DNS or production waits for the user.

- [ ] **Step 1: Provision email.** Load the `vercel:marketplace` skill and check Resend's free plan there; alternatively the user signs up at resend.com directly. Ask the user before anything that asks for billing. The user adds the domain `mail.huyne.me` and puts the DNS records Resend lists at their DNS host. Wait until Resend shows "Verified". The user sets `RESEND_API_KEY` and `EMAIL_FROM="Cobro <no-reply@mail.huyne.me>"` in `.env.local` (we print only names and lengths to check), and on Vercel production through stdin (`vercel env add NAME production`).
- [ ] **Step 2: Localhost end to end** (Neon dev, Para BETA): add an address with the real emailed code (the user reads the email and types the code). Confirm the notice email arrives. The withdraw page shows the address waiting. With the user's yes, backdate that row's `usable_at` on the **dev** branch. Then, with the user's yes for the mainnet transaction, withdraw a small amount (≤ 0.10 USD₮) to an address the user owns, and run `/celo-tx-check` on it (success, attribution tag `celo_bc3965e128ba`, recipient = the saved address). Remove the address and confirm the withdraw form no longer offers it.
- [ ] **Step 3: Merge.** The main checkout holds the user's uncommitted `.env.example` notes and an untracked `public/vercel 2.svg`. Ask the user what to do with them before merging (a merge refuses to overwrite a dirty `.env.example`). Merge `--no-ff` into `main`, run the full gate on the merge, and update main spec §6.1/§6.2 (withdrawal destinations) and Plan 4 spec §5 status.
- [ ] **Step 4: Production.** Ask the user, then apply migration 0004 to Neon **main** (needs a freshly written `.env.main`; delete it afterwards). Then push `main`, wait for the Vercel deployment to be Ready, and check `/app/settings/addresses` and `/app/withdraw` signed in on production (add flow up to the code email; no mainnet transaction unless the user asks).
- [ ] **Step 5:** Commit any docs updates as `docs: address book in main spec and Plan 4 spec`, push, update memory (`project-plan4-backlog`).
