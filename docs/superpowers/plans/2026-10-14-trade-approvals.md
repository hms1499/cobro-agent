# Trade Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The freelancer chooses whether the treasury agent asks before converting (`auto`, `sell_usd`, `all`) and approves or dismisses proposals from a dashboard banner.

**Architecture:** The pure engine (`decide`) does not change. A new `proposed` intent status sits before `waiting`; the executor decides after the engine whether a conversion needs approval, stores a proposal instead of trading, and caps an approved conversion at the approved amount. Two Server Actions approve or dismiss a proposal; the dashboard shows a banner, the nav a dot, and the rules page a three-way choice.

**Tech Stack:** Next.js 16.4 App Router (`cacheComponents: true`), Drizzle ORM on Neon Postgres (PGlite in tests), Vitest, Tailwind, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-10-14-trade-approvals-design.md` (extends `docs/superpowers/specs/2026-10-08-cobro-design.md` §10 and §17). Read both before Task 1.

## Global Constraints

- Start only after Plan 3 Task 17 is finished. Work on branch `trade-approvals` (it already holds the spec commit `d047fa2`).
- Full gate before claiming a task done: `npm test && npm run typecheck && npm run lint && npm run build`. One area: `npx vitest run src/lib/treasury`.
- `approvalMode` values exactly `auto`, `sell_usd`, `all`; default `sell_usd`.
- Approval groups: refill = `top_up`, `hub_route`; save = `save_excess`, `save_other`. Dismissal silence: 24 hours. Inheritance window: 24 hours.
- Token amounts are `bigint` in code and base-10 strings in the DB and JSON, never floats.
- All user-facing text goes through `t()` from `@/i18n` with keys in `src/i18n/en.ts` (English).
- UI follows `design-system/cobro/MASTER.md`: tokens only (no raw hex), Lucide icons with `aria-hidden`, touch targets `min-h-11`, one primary button per screen, `role="alert"`/`aria-live` for errors and status. Token units stay behind a "Details" disclosure.
- `cacheComponents: true`: a component that reads cookies or the database sits inside `<Suspense>`.
- Tests never touch the network. DB tests use `createTestDb()` from `src/lib/db/testing.ts`.
- Ask the user before running any migration against a Neon branch (`npm run db:migrate`). Never run one against Neon main from this plan.
- Commit messages: `feat(scope): …`, `fix(scope): …`, `docs: …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not stage `.env.example` (the user's uncommitted edit).

## Review Focus

1. **A proposal that grew after the banner rendered**: approving must convert at most the amount the freelancer saw (Task 4, `approveProposal` test "never raises the cap").
2. **A proposal approved hours after it was made**: the price wait starts at approval, so the agent still holds out for the normal price limit (Task 5, test "starts the price wait at approval").
3. **Dismiss, then the other group needs a conversion**: only the dismissed group goes quiet (Task 5, test "silences only the dismissed group").
4. **The engine wants more than was approved**: the RFQ sells at most the approved amount (Task 5, test "never sells more than was approved").
5. **The mode changes while a proposal or an unapproved order is open**: `auto` runs it with consent; a mode that asks moves an unapproved `waiting` order back to `proposed` (Task 5, tests "runs an open proposal once the mode is auto" and "asks again for an unapproved order").

Known trade-off (accepted, spec §5.3): an order approved while `TREASURY_DRY_RUN=true` stays `waiting`; if the switch to live comes more than `maxWaitMinutes` later, its first live run may accept up to `hardMaxSlippageBps`. The freelancer set that limit, so the loss is bounded by their own rule.

## File map

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | `approval_mode` enum, `rules.approval_mode`, `proposed` status, four `fx_intents` columns, new open-intent index predicate, three event types (Task 3) |
| `drizzle/0003_trade_approvals.sql` + `drizzle/meta/*` | Generated migration |
| `src/lib/treasury/approvals.ts` (new) | Pure rules: groups, which mode asks, wait start, form parsing, event data |
| `src/lib/treasury/explain.ts` | Event texts for `proposed`/`approved`/`dismissed`, `describeProposal`, preview wording |
| `src/lib/treasury/repo.ts` | Open statuses, `saveIntent` approvals, `proposeIntent`, `approveProposal`, `dismissProposal`, `cancelProposals`, `openProposal`, `dismissedRecently`, `inheritableApproval` |
| `src/lib/treasury/executor.ts` | Approval gate, cap, `awaiting_approval`, dry-run keep, wait start |
| `src/lib/treasury/rules-form.ts`, `src/app/app/rules/*` | `approvalMode` field and preview |
| `src/lib/treasury/live.ts`, `src/app/app/actions.ts` | `runTreasuryAfterApproval`, approve/dismiss actions, pause cancels proposals |
| `src/lib/treasury/view.ts`, `src/app/app/agent-status.tsx`, `src/app/app/proposal-banner.tsx` (new), `src/app/app/proposal-controls.tsx` (new), `src/app/app/page.tsx`, `src/app/app/app-nav.tsx`, `src/app/app/layout.tsx`, `src/app/app/onboarding/onboarding-form.tsx` | UI |
| `src/i18n/en.ts` | New keys (Tasks 3, 6, 8) |
| `docs/superpowers/specs/2026-10-08-cobro-design.md` | §10.1, §10.2, §10.4, §11, §17.2 |

---

### Task 1: Schema and migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0003_trade_approvals.sql`, `drizzle/meta/0003_snapshot.json` (generated), `drizzle/meta/_journal.json` (generated)
- Test: `src/lib/treasury/repo.test.ts`

**Interfaces:**
- Produces: `approvalMode` pg enum; `type ApprovalMode = "auto" | "sell_usd" | "all"`; `RulesRow.approvalMode`; `FxIntentRow.approvedAmountAtomic: string | null`, `approvedAt: Date | null`, `dismissedAt: Date | null`, `approvedVia: string | null`; `intent_status` value `"proposed"`.

Why the index predicate names the terminal statuses: drizzle's migrator applies all pending migrations in one transaction, and Postgres refuses to use an enum value added by `ALTER TYPE … ADD VALUE` before that transaction commits. `status not in ('filled', 'blocked', 'cancelled')` covers `proposed` without naming it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/treasury/repo.test.ts` (it already has `db`, `NOW`, `seedFreelancer`, `fxIntents`, `rules` and `eq` in scope):

```ts
describe("trade approvals schema", () => {
  it("gives new rules the sell_usd approval mode", async () => {
    const user = await seedFreelancer(db);
    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(row.approvalMode).toBe("sell_usd");
  });

  it("allows one open intent per user, a proposal included", async () => {
    const user = await seedFreelancer(db);
    const base = { userId: user.id, fromAsset: "USDT" as const, toAsset: "WARS" as const, amountAtomic: "1000000", reason: "top_up" as const };
    await db.insert(fxIntents).values({ ...base, status: "proposed" });
    await expect(db.insert(fxIntents).values({ ...base, status: "waiting" })).rejects.toThrow();
    await db.insert(fxIntents).values({ ...base, status: "cancelled", dismissedAt: NOW });
  });

  it("lets one intent inherit a given approval only once", async () => {
    const user = await seedFreelancer(db);
    const base = { userId: user.id, amountAtomic: "1000000", status: "filled" as const };
    const [hub] = await db
      .insert(fxIntents)
      .values({ ...base, fromAsset: "USAT", toAsset: "USDT", reason: "hub_route", approvedAt: NOW, approvedAmountAtomic: "1000000" })
      .returning();
    await db.insert(fxIntents).values({ ...base, fromAsset: "USDT", toAsset: "WARS", reason: "top_up", approvedVia: hub.id });
    await expect(
      db.insert(fxIntents).values({ ...base, fromAsset: "USDT", toAsset: "WARS", reason: "top_up", approvedVia: hub.id }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/repo.test.ts`
Expected: FAIL, with TypeScript or runtime errors naming `approvalMode`, `dismissedAt` or `approvedVia`.

- [ ] **Step 3: Change the schema**

In `src/lib/db/schema.ts`:

1. Add `type AnyPgColumn` to the `drizzle-orm/pg-core` import list.
2. Replace the `intentStatus` line and add `approvalMode` below it:

```ts
export const intentStatus = pgEnum("intent_status", ["proposed", "waiting", "executing", "filled", "blocked", "cancelled"]);
/** Trade approvals spec §2: what the agent may convert without asking the freelancer. */
export const approvalMode = pgEnum("approval_mode", ["auto", "sell_usd", "all"]);
```

3. In `rules`, after `autoTopUp`:

```ts
  approvalMode: approvalMode("approval_mode").notNull().default("sell_usd"),
```

4. Replace the `fxIntents` doc comment, add four columns after `retryAfter`, and replace the index:

```ts
/** Spec §10.2 and trade approvals §4: at most one open (proposed, waiting or executing) intent per user. */
export const fxIntents = pgTable(
  "fx_intents",
  {
    // … existing columns up to and including retryAfter stay as they are …
    /** Trade approvals §4: the most the freelancer approved, in from_asset units; null until approved. */
    approvedAmountAtomic: atomic("approved_amount_atomic"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** The freelancer dismissed this proposal: its approval group stays quiet for 24 hours. */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    /** The approved hub_route intent whose approval this top_up inherited; unique, so an approval is inherited once. */
    approvedVia: uuid("approved_via")
      .unique()
      .references((): AnyPgColumn => fxIntents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Names the closed statuses: the migration that adds 'proposed' cannot use that value in the same transaction.
  (t) => [uniqueIndex("fx_intents_one_open_uq").on(t.userId).where(sql`status not in ('filled', 'blocked', 'cancelled')`)],
);
```

5. Next to the other row types at the bottom:

```ts
export type ApprovalMode = (typeof approvalMode.enumValues)[number];
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate --name trade_approvals`
Expected: a new `drizzle/0003_trade_approvals.sql`. Open it and check that it holds these statements (order may differ):

```sql
CREATE TYPE "public"."approval_mode" AS ENUM('auto', 'sell_usd', 'all');
ALTER TYPE "public"."intent_status" ADD VALUE 'proposed' BEFORE 'waiting';
DROP INDEX "fx_intents_one_open_uq";
ALTER TABLE "fx_intents" ADD COLUMN "approved_amount_atomic" numeric(78, 0);
ALTER TABLE "fx_intents" ADD COLUMN "approved_at" timestamp with time zone;
ALTER TABLE "fx_intents" ADD COLUMN "dismissed_at" timestamp with time zone;
ALTER TABLE "fx_intents" ADD COLUMN "approved_via" uuid;
ALTER TABLE "rules" ADD COLUMN "approval_mode" "approval_mode" DEFAULT 'sell_usd' NOT NULL;
ALTER TABLE "fx_intents" ADD CONSTRAINT "fx_intents_approved_via_fx_intents_id_fk" FOREIGN KEY ("approved_via") REFERENCES "public"."fx_intents"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "fx_intents_one_open_uq" ON "fx_intents" USING btree ("user_id") WHERE status not in ('filled', 'blocked', 'cancelled');
ALTER TABLE "fx_intents" ADD CONSTRAINT "fx_intents_approved_via_unique" UNIQUE("approved_via");
```

If the `DROP INDEX` / `CREATE UNIQUE INDEX` pair is missing (drizzle-kit did not notice the predicate change), add those two lines by hand, each followed by `--> statement-breakpoint`. No line may mention `'proposed'` except the `ADD VALUE`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/treasury/repo.test.ts`
Expected: PASS (`createTestDb` applies 0003).

- [ ] **Step 6: Run the treasury and DB suites for regressions**

Run: `npx vitest run src/lib/treasury src/lib/db && npm run typecheck`
Expected: PASS. Nothing reads the new columns yet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0003_trade_approvals.sql drizzle/meta src/lib/treasury/repo.test.ts
git commit -m "feat(db): approval mode, proposed intents and approval columns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Approval rules (pure)

**Files:**
- Create: `src/lib/treasury/approvals.ts`
- Test: `src/lib/treasury/approvals.test.ts`

**Interfaces:**
- Consumes: `ConvertReason` from `./engine`; `ApprovalMode`, `FxIntentRow` types from `@/lib/db/schema` (type-only imports, so client components may import this module).
- Produces:
  - `APPROVAL_MODES: readonly ["auto", "sell_usd", "all"]`
  - `isApprovalMode(value: unknown): value is ApprovalMode`
  - `type ApprovalGroup = "refill" | "save"`
  - `GROUP_REASONS: Record<ApprovalGroup, ConvertReason[]>`
  - `approvalGroup(reason: ConvertReason): ApprovalGroup`
  - `modeNeedsApproval(mode: ApprovalMode, reason: ConvertReason): boolean`
  - `waitStartedAt(intent: { createdAt: Date; approvedAt: Date | null }): Date`
  - `parseProposalForm(fields: Record<string, string>): { intentId: string; seenAtomic: bigint } | null` (`seenAtomic` 0n when the field is absent, as for dismiss)
  - `intentEventData(intent: Pick<FxIntentRow, "fromAsset" | "toAsset" | "amountAtomic" | "reason">): { from: string; to: string; amount: string; reason: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/treasury/approvals.test.ts
import { describe, expect, it } from "vitest";
import {
  approvalGroup,
  intentEventData,
  isApprovalMode,
  modeNeedsApproval,
  parseProposalForm,
  waitStartedAt,
} from "./approvals";

describe("modeNeedsApproval", () => {
  it.each([
    ["auto", "top_up", false],
    ["auto", "hub_route", false],
    ["auto", "save_excess", false],
    ["auto", "save_other", false],
    ["sell_usd", "top_up", true],
    ["sell_usd", "hub_route", true],
    ["sell_usd", "save_excess", false],
    ["sell_usd", "save_other", false],
    ["all", "top_up", true],
    ["all", "hub_route", true],
    ["all", "save_excess", true],
    ["all", "save_other", true],
  ] as const)("%s mode, %s → %s", (mode, reason, expected) => {
    expect(modeNeedsApproval(mode, reason)).toBe(expected);
  });
});

describe("approvalGroup", () => {
  it("puts refills and savings in separate groups", () => {
    expect([approvalGroup("top_up"), approvalGroup("hub_route")]).toEqual(["refill", "refill"]);
    expect([approvalGroup("save_excess"), approvalGroup("save_other")]).toEqual(["save", "save"]);
  });
});

describe("isApprovalMode", () => {
  it("accepts the three modes only", () => {
    expect(["auto", "sell_usd", "all"].every(isApprovalMode)).toBe(true);
    expect(isApprovalMode("sometimes")).toBe(false);
    expect(isApprovalMode(undefined)).toBe(false);
  });
});

describe("waitStartedAt", () => {
  it("counts the price wait from approval when there was one", () => {
    const createdAt = new Date("2026-10-15T04:00:00Z");
    const approvedAt = new Date("2026-10-15T12:00:00Z");
    expect(waitStartedAt({ createdAt, approvedAt })).toBe(approvedAt);
    expect(waitStartedAt({ createdAt, approvedAt: null })).toBe(createdAt);
  });
});

describe("parseProposalForm", () => {
  const id = "0b8f8a52-3c1e-4a8e-9a55-0d6f3c2f1e10";

  it("reads the proposal id and the amount the banner showed", () => {
    expect(parseProposalForm({ intentId: id, seenAtomic: "2100000" })).toEqual({ intentId: id, seenAtomic: 2_100_000n });
    expect(parseProposalForm({ intentId: id })).toEqual({ intentId: id, seenAtomic: 0n });
  });

  it("refuses anything else", () => {
    expect(parseProposalForm({ intentId: "not-a-uuid", seenAtomic: "1" })).toBeNull();
    expect(parseProposalForm({ intentId: id, seenAtomic: "1.5" })).toBeNull();
    expect(parseProposalForm({ intentId: id, seenAtomic: "-1" })).toBeNull();
    expect(parseProposalForm({})).toBeNull();
  });
});

describe("intentEventData", () => {
  it("keeps what the activity feed needs", () => {
    expect(intentEventData({ fromAsset: "USDT", toAsset: "WARS", amountAtomic: "2100000", reason: "top_up" })).toEqual({
      from: "USDT",
      to: "WARS",
      amount: "2100000",
      reason: "top_up",
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/approvals.test.ts`
Expected: FAIL with "Failed to resolve import ./approvals".

- [ ] **Step 3: Write the module**

```ts
// src/lib/treasury/approvals.ts
import type { ApprovalMode, FxIntentRow } from "@/lib/db/schema";
import type { ConvertReason } from "./engine";

/** Trade approvals spec §2, in the order the rules page lists them. */
export const APPROVAL_MODES = ["auto", "sell_usd", "all"] as const satisfies readonly ApprovalMode[];

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value);
}

/** Trade approvals §3: dismissal silences a group, and a refill's two legs share one approval. */
export type ApprovalGroup = "refill" | "save";

export const GROUP_REASONS: Record<ApprovalGroup, ConvertReason[]> = {
  refill: ["top_up", "hub_route"],
  save: ["save_excess", "save_other"],
};

export function approvalGroup(reason: ConvertReason): ApprovalGroup {
  return GROUP_REASONS.refill.includes(reason) ? "refill" : "save";
}

/** Trade approvals §3: sell_usd asks before a refill (it sells dollars); all asks before anything. */
export function modeNeedsApproval(mode: ApprovalMode, reason: ConvertReason): boolean {
  if (mode === "auto") return false;
  return mode === "all" || approvalGroup(reason) === "refill";
}

/** Trade approvals §5.1 step 6: the price wait (§10.3) starts at approval, not when the proposal was made. */
export function waitStartedAt(intent: { createdAt: Date; approvedAt: Date | null }): Date {
  return intent.approvedAt ?? intent.createdAt;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The banner's hidden fields. Null for anything malformed, which the action reports as a changed proposal. */
export function parseProposalForm(fields: Record<string, string>): { intentId: string; seenAtomic: bigint } | null {
  const intentId = fields.intentId ?? "";
  const seen = fields.seenAtomic ?? "0";
  if (!UUID.test(intentId) || !/^\d{1,78}$/.test(seen)) return null;
  return { intentId, seenAtomic: BigInt(seen) };
}

/** What proposed, approved and dismissed events carry, in the same shape as the executor's decision data. */
export function intentEventData(intent: Pick<FxIntentRow, "fromAsset" | "toAsset" | "amountAtomic" | "reason">) {
  return { from: intent.fromAsset, to: intent.toAsset, amount: intent.amountAtomic, reason: intent.reason };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/treasury/approvals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/approvals.ts src/lib/treasury/approvals.test.ts
git commit -m "feat(treasury): approval modes, groups and form parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Event types, activity texts and the proposal view

**Files:**
- Modify: `src/lib/db/schema.ts` (`AGENT_EVENT_TYPES`), `src/lib/treasury/explain.ts`, `src/i18n/en.ts`
- Test: `src/lib/treasury/explain.test.ts`

**Interfaces:**
- Consumes: `FxIntentRow` (Task 1); `percentText`, `moneyText` (existing in `explain.ts`).
- Produces:
  - event types `"proposed" | "approved" | "dismissed"` in `AgentEventType`
  - `interface ProposalView { title: string; body: string; why: string; price: string; units: string }`
  - `describeProposal(intent: Pick<FxIntentRow, "fromAsset" | "toAsset" | "amountAtomic" | "reason">, ctx: ExplainContext, maxSlippageBps: number): ProposalView`
  - `describeDecision(decision, ctx, opts?: { askFirst?: boolean }): string` (`askFirst` is used in Task 6)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/treasury/explain.test.ts` (it has `ctx` with ARS at 1,600 per dollar and `NBSP`), and add `describeProposal` to its import from `./explain`:

```ts
describe("approval events", () => {
  it("explains a proposal, an approval and a dismissal", () => {
    const data = { from: "USDT", to: "WARS", amount: "2000000", reason: "top_up" };
    expect(describeEvent({ type: "proposed", data }, ctx)).toMatchObject({
      tone: "warning",
      title: `Your agent asks to convert ≈ ARS${NBSP}3,200 to pesos`,
    });
    expect(describeEvent({ type: "approved", data }, ctx).title).toBe(`You approved converting ≈ ARS${NBSP}3,200 to pesos`);
    expect(describeEvent({ type: "dismissed", data }, ctx).why).toBe("Your agent won't suggest this again for 24 hours.");
  });

  it("names the spending currency for the first leg of a refill through USD₮", () => {
    const data = { from: "USAT", to: "USDT", amount: "2000000", reason: "hub_route" };
    expect(describeEvent({ type: "proposed", data }, ctx).title).toBe(`Your agent asks to convert ≈ ARS${NBSP}3,200 to pesos`);
  });
});

describe("describeProposal", () => {
  it("says what, why, at what price, and keeps token units for Details", () => {
    const view = describeProposal({ fromAsset: "USDT", toAsset: "WARS", amountAtomic: "2100000", reason: "top_up" }, ctx, 50);
    expect(view).toEqual({
      title: "Your agent needs your approval",
      body: `Convert ≈ ARS${NBSP}3,360 to pesos.`,
      why: "Your spending money is below the reserve you set.",
      price: "Your agent waits for a fair price: at most 0.50% below the market rate.",
      units: "2.1 USD₮",
    });
  });

  it("mentions the USD₮ step of a refill from USA₮", () => {
    const view = describeProposal({ fromAsset: "USAT", toAsset: "USDT", amountAtomic: "2100000", reason: "hub_route" }, ctx, 50);
    expect(view.body).toBe(`Convert ≈ ARS${NBSP}3,360 to pesos, through USD₮.`);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/explain.test.ts`
Expected: FAIL (`describeProposal` is not exported; `"proposed"` is not an event type).

- [ ] **Step 3: Add the event types**

In `src/lib/db/schema.ts`, append to `AGENT_EVENT_TYPES` after `"payment_reconciled"`:

```ts
  "proposed",
  "approved",
  "dismissed",
```

- [ ] **Step 4: Add the texts**

In `src/i18n/en.ts`, next to the other `event.*` keys:

```ts
  "event.proposed.title": "Your agent asks to convert {amount} to {target}",
  "event.proposed.why": "You asked your agent to check with you first. Approve or dismiss it on your dashboard.",
  "event.approved.title": "You approved converting {amount} to {target}",
  "event.approved.why": "Your agent converts it at a fair price, within the limits you set.",
  "event.dismissed.title": "You dismissed converting {amount} to {target}",
  "event.dismissed.why": "Your agent won't suggest this again for 24 hours.",
  "proposal.title": "Your agent needs your approval",
  "proposal.body": "Convert {amount} to {target}.",
  "proposal.bodyVia": "Convert {amount} to {target}, through USD₮.",
  "proposal.why.top_up": "Your spending money is below the reserve you set.",
  "proposal.why.hub_route": "Your spending money is below the reserve you set.",
  "proposal.why.save_excess": "Your spending money is above the reserve you set.",
  "proposal.why.save_other": "You were paid in a currency you don't spend in.",
  "proposal.price": "Your agent waits for a fair price: at most {pct} below the market rate.",
  "proposal.units": "{amount} {symbol}",
```

- [ ] **Step 5: Explain the events and the proposal**

In `src/lib/treasury/explain.ts`:

1. Add imports:

```ts
import { TOKENS } from "@/lib/chain/tokens";
import type { FxIntentRow } from "@/lib/db/schema";
import { formatDecimal } from "@/lib/money/decimal";
```

2. Below `targetText`, add:

```ts
/** A refill through USD₮ (hub_route) is for the spending currency, though its first leg buys USD₮. */
function proposalTarget(to: unknown, reason: unknown, local: LocalCurrency | null): string {
  if (reason === "hub_route" && local) return t(`event.target.${local}`);
  return targetText(to);
}
```

3. In `describeEvent`'s `switch`, before `case "withdrawn":`:

```ts
    case "proposed":
    case "approved":
    case "dismissed":
      return {
        tone: event.type === "proposed" ? "warning" : "info",
        title: t(`event.${event.type}.title`, { amount, target: proposalTarget(d.to, d.reason, ctx.local) }),
        why: t(`event.${event.type}.why`),
        txHash: null,
      };
```

4. After `describeEvent`, add:

```ts
export interface ProposalView {
  title: string;
  body: string;
  why: string;
  price: string;
  /** Token units, shown only behind "Details". */
  units: string;
}

/** The dashboard banner's text for one proposal (trade approvals §6). */
export function describeProposal(
  intent: Pick<FxIntentRow, "fromAsset" | "toAsset" | "amountAtomic" | "reason">,
  ctx: ExplainContext,
  maxSlippageBps: number,
): ProposalView {
  const amount = moneyText(intent.fromAsset, intent.amountAtomic, ctx);
  const target = proposalTarget(intent.toAsset, intent.reason, ctx.local);
  return {
    title: t("proposal.title"),
    body: t(intent.reason === "hub_route" ? "proposal.bodyVia" : "proposal.body", { amount, target }),
    why: t(`proposal.why.${intent.reason}`),
    price: t("proposal.price", { pct: percentText(maxSlippageBps) }),
    units: t("proposal.units", {
      amount: formatDecimal(BigInt(intent.amountAtomic), TOKENS[intent.fromAsset].decimals),
      symbol: t(`asset.${intent.fromAsset}.symbol`),
    }),
  };
}
```

5. Give `describeDecision` the option Task 6 uses (its text is added in Task 6):

```ts
export function describeDecision(
  decision: Decision,
  ctx: ExplainContext,
  opts: { askFirst?: boolean } = {},
): string {
  if (decision.kind === "none")
    return t(IDLE[decision.reason], { amount: MINIMUM_TEXT });
  return t(opts.askFirst ? "preview.propose" : "preview.convert", {
    amount: moneyText(decision.from, decision.amount.toString(), ctx),
    target: targetText(decision.to),
    why: reasonText(decision.reason),
  });
}
```

and add the key now so the file type-checks:

```ts
  "preview.propose": "ask you to approve converting {amount} to {target}. {why}",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/treasury/explain.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/treasury/explain.ts src/lib/treasury/explain.test.ts src/i18n/en.ts
git commit -m "feat(treasury): explain proposals, approvals and dismissals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Repository

**Files:**
- Modify: `src/lib/treasury/repo.ts`
- Test: `src/lib/treasury/repo.test.ts`

**Interfaces:**
- Consumes: Task 1 columns; `DAY_MS` from `@/lib/invoices/dates`.
- Produces:
  - `OPEN_STATUSES` now `["proposed", "waiting", "executing"]` (so `openIntent` and `cancelIntent` include proposals)
  - `interface SaveApproval { via?: string; capAtomic?: bigint }`
  - `saveIntent(db, userId, plan, now, approval?: SaveApproval): Promise<FxIntentRow>`
  - `proposeIntent(db, userId, plan, now): Promise<FxIntentRow>`
  - `approveProposal(db, userId, intentId: string, seenAtomic: bigint, now): Promise<FxIntentRow | null>`
  - `dismissProposal(db, userId, intentId: string, now): Promise<FxIntentRow | null>`
  - `cancelProposals(db, userId, now): Promise<void>`
  - `openProposal(db, userId): Promise<FxIntentRow | null>`
  - `dismissedRecently(db, userId, reasons: ConvertReason[], now): Promise<boolean>`
  - `inheritableApproval(db, userId, now): Promise<{ intentId: string; boughtAtomic: bigint } | null>`

`saveIntent` rules: a kept intent that is `proposed` becomes approved now (the freelancer's mode no longer asks, which counts as consent), and so does any intent saved with `approval.via` (inheritance). The recorded cap is `approval.capAtomic ?? amount`. An already approved intent keeps its approval.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/treasury/repo.test.ts`; add the new names to its `./repo` import, add `fxTrades` to the schema import, and add `import type { IntentPlan } from "./engine";`:

```ts
const topUp = (amount: bigint): ConvertDecision => ({ kind: "convert", from: "USDT", to: "WARS", amount, usdWad: 0n, reason: "top_up" });
const newPlan = (d: ConvertDecision): Extract<IntentPlan, { action: "convert" }> => ({ action: "convert", keep: null, cancel: null, decision: d });
const keepPlan = (id: string, d: ConvertDecision): Extract<IntentPlan, { action: "convert" }> => ({ action: "convert", keep: id, cancel: null, decision: d });

describe("proposals", () => {
  it("proposes, keeps the id when the amount changes, and is the open intent", async () => {
    const user = await seedFreelancer(db);
    const first = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    const again = await proposeIntent(db, user.id, keepPlan(first.id, topUp(3_000_000n)), minutes(10));
    expect(again).toMatchObject({ id: first.id, status: "proposed", amountAtomic: "3000000", approvedAt: null });
    expect((await openIntent(db, user.id))?.id).toBe(first.id);
    expect((await openProposal(db, user.id))?.id).toBe(first.id);
  });

  it("approves at most the amount the freelancer saw (never raises the cap)", async () => {
    const user = await seedFreelancer(db);
    const proposal = await proposeIntent(db, user.id, newPlan(topUp(3_000_000n)), NOW);
    const approved = await approveProposal(db, user.id, proposal.id, 2_100_000n, minutes(5));
    expect(approved).toMatchObject({ status: "waiting", amountAtomic: "2100000", approvedAmountAtomic: "2100000", approvedAt: minutes(5) });

    const other = await seedFreelancer(db);
    const small = await proposeIntent(db, other.id, newPlan(topUp(1_500_000n)), NOW);
    expect((await approveProposal(db, other.id, small.id, 9_000_000n, NOW))?.approvedAmountAtomic).toBe("1500000");
  });

  it("refuses to approve someone else's proposal, or one already handled", async () => {
    const owner = await seedFreelancer(db);
    const stranger = await seedFreelancer(db);
    const proposal = await proposeIntent(db, owner.id, newPlan(topUp(2_000_000n)), NOW);
    expect(await approveProposal(db, stranger.id, proposal.id, 2_000_000n, NOW)).toBeNull();
    expect(await approveProposal(db, owner.id, proposal.id, 2_000_000n, NOW)).not.toBeNull();
    expect(await approveProposal(db, owner.id, proposal.id, 2_000_000n, NOW)).toBeNull();
    expect(await dismissProposal(db, owner.id, proposal.id, NOW)).toBeNull();
  });

  it("dismisses with a timestamp, and pausing cancels without one", async () => {
    const user = await seedFreelancer(db);
    const first = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    expect(await dismissProposal(db, user.id, first.id, NOW)).toMatchObject({ status: "cancelled", dismissedAt: NOW });
    expect(await dismissedRecently(db, user.id, ["top_up", "hub_route"], minutes(60))).toBe(true);
    expect(await dismissedRecently(db, user.id, ["save_excess", "save_other"], minutes(60))).toBe(false);
    expect(await dismissedRecently(db, user.id, ["top_up", "hub_route"], minutes(24 * 60))).toBe(false);

    const second = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), minutes(1));
    await cancelProposals(db, user.id, minutes(2));
    const [row] = await db.select().from(fxIntents).where(eq(fxIntents.id, second.id));
    expect(row).toMatchObject({ status: "cancelled", dismissedAt: null });
    expect(await openProposal(db, user.id)).toBeNull();
  });
});

describe("saveIntent approvals", () => {
  it("treats a kept proposal as approved once the mode no longer asks", async () => {
    const user = await seedFreelancer(db);
    const proposal = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    const saved = await saveIntent(db, user.id, keepPlan(proposal.id, topUp(2_000_000n)), minutes(30));
    expect(saved).toMatchObject({ id: proposal.id, status: "waiting", approvedAt: minutes(30), approvedAmountAtomic: "2000000" });
  });

  it("keeps an earlier approval as it was", async () => {
    const user = await seedFreelancer(db);
    const proposal = await proposeIntent(db, user.id, newPlan(topUp(2_000_000n)), NOW);
    await approveProposal(db, user.id, proposal.id, 2_000_000n, minutes(5));
    const saved = await saveIntent(db, user.id, keepPlan(proposal.id, topUp(1_800_000n)), minutes(10));
    expect(saved).toMatchObject({ amountAtomic: "1800000", approvedAt: minutes(5), approvedAmountAtomic: "2000000" });
  });

  it("records an inherited approval on a new intent", async () => {
    const user = await seedFreelancer(db);
    const [hub] = await db
      .insert(fxIntents)
      .values({ userId: user.id, fromAsset: "USAT", toAsset: "USDT", amountAtomic: "2000000", reason: "hub_route", status: "filled", approvedAt: NOW })
      .returning();
    const saved = await saveIntent(db, user.id, newPlan(topUp(1_900_000n)), NOW, { via: hub.id, capAtomic: 1_990_000n });
    expect(saved).toMatchObject({ approvedVia: hub.id, approvedAt: NOW, approvedAmountAtomic: "1990000", status: "waiting" });
  });
});

describe("inheritableApproval", () => {
  async function filledHub(userId: string, opts: { approved: boolean; filledAt: Date }) {
    const [hub] = await db
      .insert(fxIntents)
      .values({
        userId,
        fromAsset: "USAT",
        toAsset: "USDT",
        amountAtomic: "2000000",
        reason: "hub_route",
        status: "filled",
        approvedAt: opts.approved ? NOW : null,
      })
      .returning();
    await insertTrade(db, {
      userId,
      intentId: hub.id,
      sellAsset: "USAT",
      buyAsset: "USDT",
      sellAmount: "2000000",
      buyAmount: "1990000",
      status: "filled",
      filledAt: opts.filledAt,
    });
    return hub;
  }

  it("finds an approved hub leg filled in the last 24 hours, with the USD₮ it bought", async () => {
    const user = await seedFreelancer(db);
    const hub = await filledHub(user.id, { approved: true, filledAt: NOW });
    expect(await inheritableApproval(db, user.id, minutes(30))).toEqual({ intentId: hub.id, boughtAtomic: 1_990_000n });
  });

  it("ignores an unapproved, an old or an already inherited hub leg", async () => {
    const user = await seedFreelancer(db);
    await filledHub(user.id, { approved: false, filledAt: NOW });
    await filledHub(user.id, { approved: true, filledAt: minutes(-25 * 60) });
    const used = await filledHub(user.id, { approved: true, filledAt: NOW });
    await db.insert(fxIntents).values({
      userId: user.id,
      fromAsset: "USDT",
      toAsset: "WARS",
      amountAtomic: "1990000",
      reason: "top_up",
      status: "filled",
      approvedVia: used.id,
    });
    expect(await inheritableApproval(db, user.id, minutes(30))).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/repo.test.ts`
Expected: FAIL (the new functions are not exported).

- [ ] **Step 3: Implement**

In `src/lib/treasury/repo.ts`:

1. Imports: add `isNotNull, isNull` to the `drizzle-orm` import, `alias` from `drizzle-orm/pg-core`, and change the engine import to `import type { ConvertReason, IntentPlan } from "./engine";`.

2. Replace `OPEN_STATUSES`:

```ts
const OPEN_STATUSES: ("proposed" | "waiting" | "executing")[] = ["proposed", "waiting", "executing"];
```

3. Replace `saveIntent` with:

```ts
/** How a conversion that runs now is approved (trade approvals §5.1 step 4). */
export interface SaveApproval {
  /** The approved hub_route intent this one inherits from. */
  via?: string;
  /** The cap recorded when the intent becomes approved now; defaults to its amount. */
  capAtomic?: bigint;
}

/**
 * Applies a convert plan that runs now: cancel the old intent, keep it (new amount, same age) or create a
 * new one. A kept proposal becomes approved now: the mode no longer asks, which counts as consent. An
 * intent that already had an approval keeps it.
 */
export async function saveIntent(
  db: Db,
  userId: string,
  plan: Extract<IntentPlan, { action: "convert" }>,
  now: Date,
  approval: SaveApproval = {},
): Promise<FxIntentRow> {
  return db.transaction(async (tx) => {
    if (plan.cancel) await cancelIntent(tx, plan.cancel, now);
    const fields = { amountAtomic: plan.decision.amount.toString(), reason: plan.decision.reason, updatedAt: now };
    const grant = {
      approvedAt: now,
      approvedAmountAtomic: (approval.capAtomic ?? plan.decision.amount).toString(),
      approvedVia: approval.via ?? null,
    };
    if (plan.keep) {
      const [current] = await tx
        .select()
        .from(fxIntents)
        .where(and(eq(fxIntents.id, plan.keep), inArray(fxIntents.status, OPEN_STATUSES)));
      if (current) {
        const approveNow = current.approvedAt === null && (current.status === "proposed" || approval.via !== undefined);
        // "executing" left behind by a crashed run goes back to waiting; its age is kept.
        const [kept] = await tx
          .update(fxIntents)
          .set({ ...fields, status: "waiting", ...(approveNow ? grant : {}) })
          .where(eq(fxIntents.id, current.id))
          .returning();
        return kept;
      }
    }
    const [created] = await tx
      .insert(fxIntents)
      .values({
        ...fields,
        userId,
        fromAsset: plan.decision.from,
        toAsset: plan.decision.to,
        createdAt: now,
        ...(approval.via ? grant : {}),
      })
      .returning();
    return created;
  });
}

/**
 * Trade approvals §5.1 step 5: the conversion waits for the freelancer. The same pair keeps its id and
 * takes the new amount; the executor never calls this for an approved intent.
 */
export async function proposeIntent(
  db: Db,
  userId: string,
  plan: Extract<IntentPlan, { action: "convert" }>,
  now: Date,
): Promise<FxIntentRow> {
  return db.transaction(async (tx) => {
    if (plan.cancel) await cancelIntent(tx, plan.cancel, now);
    const fields = { amountAtomic: plan.decision.amount.toString(), reason: plan.decision.reason, status: "proposed" as const, updatedAt: now };
    if (plan.keep) {
      const [kept] = await tx
        .update(fxIntents)
        .set(fields)
        .where(and(eq(fxIntents.id, plan.keep), inArray(fxIntents.status, OPEN_STATUSES), isNull(fxIntents.approvedAt)))
        .returning();
      if (kept) return kept;
    }
    const [created] = await tx
      .insert(fxIntents)
      .values({ ...fields, userId, fromAsset: plan.decision.from, toAsset: plan.decision.to, createdAt: now })
      .returning();
    return created;
  });
}

/**
 * Trade approvals §5.2. `seenAtomic` is what the banner showed: it can lower the amount, never raise it.
 * Null when the proposal is someone else's, or no longer a proposal (approved, dismissed or replaced).
 */
export async function approveProposal(
  db: Db,
  userId: string,
  intentId: string,
  seenAtomic: bigint,
  now: Date,
): Promise<FxIntentRow | null> {
  const capped = sql`least(${fxIntents.amountAtomic}, ${seenAtomic.toString()}::numeric)`;
  const [row] = await db
    .update(fxIntents)
    .set({ status: "waiting", amountAtomic: capped, approvedAmountAtomic: capped, approvedAt: now, updatedAt: now })
    .where(and(eq(fxIntents.id, intentId), eq(fxIntents.userId, userId), eq(fxIntents.status, "proposed")))
    .returning();
  return row ?? null;
}

/** Trade approvals §5.2: the proposal is cancelled and its group stays quiet for 24 hours. */
export async function dismissProposal(db: Db, userId: string, intentId: string, now: Date): Promise<FxIntentRow | null> {
  const [row] = await db
    .update(fxIntents)
    .set({ status: "cancelled", dismissedAt: now, updatedAt: now })
    .where(and(eq(fxIntents.id, intentId), eq(fxIntents.userId, userId), eq(fxIntents.status, "proposed")))
    .returning();
  return row ?? null;
}

/** Pausing the agent drops its proposal without counting as a dismissal (trade approvals §5.3). */
export async function cancelProposals(db: Db, userId: string, now: Date): Promise<void> {
  await db
    .update(fxIntents)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(fxIntents.userId, userId), eq(fxIntents.status, "proposed")));
}

export async function openProposal(db: Db, userId: string): Promise<FxIntentRow | null> {
  const [row] = await db
    .select()
    .from(fxIntents)
    .where(and(eq(fxIntents.userId, userId), eq(fxIntents.status, "proposed")));
  return row ?? null;
}

/** Whether a proposal with one of these reasons was dismissed in the last 24 hours. */
export async function dismissedRecently(db: Db, userId: string, reasons: ConvertReason[], now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: fxIntents.id })
    .from(fxIntents)
    .where(
      and(
        eq(fxIntents.userId, userId),
        inArray(fxIntents.reason, reasons),
        gt(fxIntents.dismissedAt, new Date(now.getTime() - DAY_MS)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Trade approvals §5.1 step 4.3: an approved hub_route leg that filled in the last 24 hours and that no
 * intent has inherited yet, with the USD₮ it bought (the cap for the refill's second leg).
 */
export async function inheritableApproval(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ intentId: string; boughtAtomic: bigint } | null> {
  const child = alias(fxIntents, "child");
  const [row] = await db
    .select({ intentId: fxIntents.id, bought: sql`coalesce(sum(${fxTrades.buyAmount}), 0)`.mapWith(String) })
    .from(fxIntents)
    .innerJoin(fxTrades, and(eq(fxTrades.intentId, fxIntents.id), eq(fxTrades.status, "filled")))
    .leftJoin(child, eq(child.approvedVia, fxIntents.id))
    .where(
      and(
        eq(fxIntents.userId, userId),
        eq(fxIntents.reason, "hub_route"),
        eq(fxIntents.status, "filled"),
        isNotNull(fxIntents.approvedAt),
        isNull(child.id),
        gt(fxTrades.filledAt, new Date(now.getTime() - DAY_MS)),
      ),
    )
    .groupBy(fxIntents.id)
    .orderBy(desc(sql`max(${fxTrades.filledAt})`))
    .limit(1);
  return row ? { intentId: row.intentId, boughtAtomic: BigInt(row.bought) } : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/treasury/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole treasury suite**

Run: `npx vitest run src/lib/treasury && npm run typecheck`
Expected: PASS. The executor still calls `saveIntent` with four arguments, which is unchanged behaviour for unapproved intents.

- [ ] **Step 6: Commit**

```bash
git add src/lib/treasury/repo.ts src/lib/treasury/repo.test.ts
git commit -m "feat(treasury): store, approve, dismiss and inherit proposals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Executor approval gate

**Files:**
- Modify: `src/lib/treasury/executor.ts`
- Test: `src/lib/treasury/executor.test.ts`

**Interfaces:**
- Consumes: Task 2 (`approvalGroup`, `GROUP_REASONS`, `modeNeedsApproval`, `waitStartedAt`), Task 4 (`proposeIntent`, `dismissedRecently`, `inheritableApproval`, `saveIntent` with `SaveApproval`, `approveProposal`/`dismissProposal` in tests).
- Produces: `RunOutcome` gains `"awaiting_approval"`; `runTreasuryForUser` returns `{ outcome: "idle", detail: "dismissed" }` during a dismissal's silence.

Spec §5.3 says an `executing` intent is left to finish when the mode starts asking. A run that is really executing holds the wallet lock, so `runLocked` never sees it; an `executing` intent that `runLocked` does see was left by a crashed run, after `reconcilePending` settled its transactions. Treating that leftover like a `waiting` one (proposing it again when unapproved) is therefore safe, and is what `proposeIntent` does.

- [ ] **Step 1: Keep the existing tests on today's behaviour**

New rules default to `sell_usd`, which would turn the existing top-up tests into proposals. In `src/lib/treasury/executor.test.ts`, change the helper (add `type ApprovalMode` to the `@/lib/db/schema` import):

```ts
async function freelancer(reserveAmount = "0.00", approvalMode: ApprovalMode = "auto") {
  const user = await seedFreelancer(db);
  await db.update(rules).set({ reserveAmount, approvalMode }).where(eq(rules.userId, user.id));
  return user;
}
```

Run: `npx vitest run src/lib/treasury/executor.test.ts`
Expected: PASS (nothing reads the mode yet).

- [ ] **Step 2: Write the failing tests**

Add `approveProposal, dismissProposal` to the `./repo` import, then append:

```ts
describe("runTreasuryForUser: approvals", () => {
  // Reserve ARS 16,000 (US$10) and nothing held: the engine wants US$10 of wARS from USD₮.
  const RESERVE = "16000.00";
  const refillQuote = (usdt: bigint, pesosOut: bigint) => quoted({ sellAmount: usdt, takerPays: usdt, buyAmount: pesos(pesosOut) });

  it("proposes a refill instead of trading, and says so once", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps } = harness({ USDT: 20_000_000n });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "awaiting_approval" });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("awaiting_approval");
    expect(deps.rfq.request).not.toHaveBeenCalled();
    expect(await eventTypes(user.id)).toEqual(["proposed"]);
    expect((await intentsOf(user.id)).map((i) => [i.status, i.reason, i.amountAtomic])).toEqual([["proposed", "top_up", "10000000"]]);
  });

  it("still saves extra pesos on its own in sell_usd mode, and asks first in all mode", async () => {
    const saver = await freelancer("0.00", "sell_usd");
    const asker = await freelancer("0.00", "all");
    expect((await runTreasuryForUser(harness({ WARS: pesos(3_200n), ...gas }).deps, saver.id)).outcome).toBe("converted");
    expect((await runTreasuryForUser(harness({ WARS: pesos(3_200n), ...gas }).deps, asker.id)).outcome).toBe("awaiting_approval");
  });

  it("updates the open proposal's amount and drops it when the need goes", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps, state } = harness({ USDT: 20_000_000n });
    await runTreasuryForUser(deps, user.id);
    const [first] = await intentsOf(user.id);
    state.balances.WARS = pesos(4_800n); // US$3 held: US$7 still missing
    await runTreasuryForUser(deps, user.id);
    expect(await intentsOf(user.id)).toEqual([expect.objectContaining({ id: first.id, status: "proposed", amountAtomic: "7000000" })]);
    state.balances.WARS = pesos(16_000n);
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("idle");
    expect((await intentsOf(user.id)).map((i) => i.status)).toEqual(["cancelled"]);
    expect(await eventTypes(user.id)).toEqual(["proposed"]);
  });

  it("converts an approved proposal on the next run", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps } = harness({ USDT: 20_000_000n }, { outcome: refillQuote(10_000_000n, 15_950n) });
    await runTreasuryForUser(deps, user.id);
    const [proposal] = await intentsOf(user.id);
    await approveProposal(db, user.id, proposal.id, 10_000_000n, NOW);
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    expect((await intentsOf(user.id))[0].status).toBe("filled");
  });

  it("never sells more than was approved", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps } = harness({ USDT: 20_000_000n }, { outcome: refillQuote(6_000_000n, 9_570n) });
    await runTreasuryForUser(deps, user.id);
    const [proposal] = await intentsOf(user.id);
    await approveProposal(db, user.id, proposal.id, 6_000_000n, NOW);
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    expect(deps.rfq.request).toHaveBeenCalledWith(expect.objectContaining({ sellAmount: 6_000_000n }));
  });

  it("starts the price wait at approval, so an old proposal still holds out for the normal limit", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    // Proposed 8 hours ago, past the 6-hour wait; the quote is 1% worse: within the hard limit, not the normal one.
    const [proposal] = await db
      .insert(fxIntents)
      .values({
        userId: user.id,
        fromAsset: "USDT",
        toAsset: "WARS",
        amountAtomic: "10000000",
        reason: "top_up",
        status: "proposed",
        createdAt: new Date(NOW.getTime() - 8 * 3_600_000),
      })
      .returning();
    await approveProposal(db, user.id, proposal.id, 10_000_000n, NOW);
    const { deps } = harness({ USDT: 20_000_000n }, { outcome: refillQuote(10_000_000n, 15_840n) });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "waiting", detail: "price" });
  });

  it("stays quiet for 24 hours after a dismissal, then asks again", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps } = harness({ USDT: 20_000_000n });
    await runTreasuryForUser(deps, user.id);
    const [proposal] = await intentsOf(user.id);
    await dismissProposal(db, user.id, proposal.id, NOW);
    deps.now = () => new Date(NOW.getTime() + 3_600_000);
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "idle", detail: "dismissed" });
    deps.now = () => new Date(NOW.getTime() + 24 * 3_600_000);
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("awaiting_approval");
  });

  it("silences only the dismissed group", async () => {
    const user = await freelancer(RESERVE, "all");
    const { deps, state } = harness({ USDT: 20_000_000n });
    await runTreasuryForUser(deps, user.id);
    const [refill] = await intentsOf(user.id);
    await dismissProposal(db, user.id, refill.id, NOW);
    state.balances.WBRL = pesos(10n); // paid in reais: the engine now wants to save them (the save group)
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("awaiting_approval");
    expect((await intentsOf(user.id)).find((i) => i.status === "proposed")?.reason).toBe("save_other");
  });

  it("runs an open proposal once the mode is auto, with that choice as consent", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps } = harness({ USDT: 20_000_000n }, { outcome: refillQuote(10_000_000n, 15_950n) });
    await runTreasuryForUser(deps, user.id);
    await db.update(rules).set({ approvalMode: "auto" }).where(eq(rules.userId, user.id));
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    expect((await intentsOf(user.id))[0]).toMatchObject({ status: "filled", approvedAt: NOW });
  });

  it("asks again for an unapproved order when the mode starts asking", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const [order] = await db
      .insert(fxIntents)
      .values({ userId: user.id, fromAsset: "USDT", toAsset: "WARS", amountAtomic: "10000000", reason: "top_up", createdAt: NOW })
      .returning();
    const { deps } = harness({ USDT: 20_000_000n });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("awaiting_approval");
    expect(await intentsOf(user.id)).toEqual([expect.objectContaining({ id: order.id, status: "proposed" })]);
  });

  it("keeps an approved order in dry run and does not propose it again", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps } = harness({ USDT: 20_000_000n }, { dryRun: true });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("awaiting_approval");
    const [proposal] = await intentsOf(user.id);
    await approveProposal(db, user.id, proposal.id, 10_000_000n, NOW);
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect((await intentsOf(user.id)).map((i) => i.status)).toEqual(["waiting"]);
    expect(await eventTypes(user.id)).toEqual(["proposed", "dry_run"]);
  });

  it("asks once for a refill through USD₮ and lets the second leg inherit the approval, once", async () => {
    const user = await freelancer(RESERVE, "sell_usd");
    const { deps, state } = harness({ USAT: 20_000_000n }, { outcome: quoted({ sellAmount: 10_000_000n, takerPays: 10_000_000n, buyAmount: 9_990_000n }) });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("awaiting_approval");
    const [hub] = await intentsOf(user.id);
    expect(hub.reason).toBe("hub_route");
    await approveProposal(db, user.id, hub.id, 10_000_000n, NOW);
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");

    // The hub leg bought 9.99 USD₮; the refill's second leg sells at most that, with no new question.
    state.balances = { ...state.balances, USAT: 10_000_000n, USDT: 9_990_000n };
    deps.rfq.request = vi.fn(async () => refillQuote(9_000_000n, 14_380n));
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    const second = (await intentsOf(user.id)).find((i) => i.reason === "top_up");
    expect(second).toMatchObject({ approvedVia: hub.id, approvedAmountAtomic: "9990000", status: "filled" });

    // A further refill needs a new approval.
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("awaiting_approval");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/executor.test.ts -t "approvals"`
Expected: FAIL (the executor converts instead of proposing).

- [ ] **Step 4: Implement the gate**

In `src/lib/treasury/executor.ts`:

1. Imports: add

```ts
import { approvalGroup, GROUP_REASONS, modeNeedsApproval, waitStartedAt } from "./approvals";
```

and add `dismissedRecently`, `inheritableApproval`, `proposeIntent` and `type SaveApproval` to the `./repo` import.

2. Add `| "awaiting_approval"` to `RunOutcome` (after `"idle"`).

3. Replace the body of `runLocked` from `const balances = …` to the end with:

```ts
  const balances = await deps.chain.readBalances(ctx.address);
  const decision = decide(await engineInput(deps.db, ctx, balances, rates, deps.now()));
  const open = await openIntent(deps.db, ctx.userId);
  // Trade approvals §5.1 step 2: a dismissed group stays quiet for 24 hours, unless the mode no longer asks.
  if (
    decision.kind === "convert" &&
    ctx.rules.approvalMode !== "auto" &&
    (await dismissedRecently(deps.db, ctx.userId, GROUP_REASONS[approvalGroup(decision.reason)], deps.now()))
  ) {
    if (open) await cancelIntent(deps.db, open.id, deps.now());
    return result("idle", "dismissed");
  }
  const plan = planIntent(open && { id: open.id, fromAsset: open.fromAsset, toAsset: open.toAsset }, decision);
  if (plan.action === "none") {
    if (plan.cancel) await cancelIntent(deps.db, plan.cancel, deps.now());
    return result("idle", decision.kind === "none" ? decision.reason : undefined);
  }

  const approval = await approvalFor(deps, ctx, open, plan);
  if (approval.kind === "needed") return propose(deps, ctx, plan, result);
  const d = capDecision(plan.decision, approval.cap, rates);
  const sized = { ...plan, decision: d };
  if (deps.flags.dryRun) return dryRun(deps, ctx, sized, approval.approved, result);

  const intent = await saveIntent(deps.db, ctx.userId, sized, deps.now(), approval.save);
  if (intent.retryAfter && intent.retryAfter > deps.now()) return result("waiting", "retry_after");

  const { feeToken } = await ensureFeeToken(deps, ctx, balances, { asset: d.from, amount: d.amount });
  if (!feeToken) {
    await logOncePerIntent(deps, ctx.userId, intent.id, "needs_gas", {});
    await updateIntent(deps.db, intent.id, { attempts: intent.attempts + 1 }, deps.now());
    return result("needs_gas");
  }
  return trade(deps, ctx, intent, d, feeToken, rates, result);
}

type Approval =
  | { kind: "needed" }
  /** `approved`: the freelancer (or an inherited approval) already said yes, so dry run keeps the intent. */
  | { kind: "granted"; cap: bigint | null; save: SaveApproval; approved: boolean };

/** Trade approvals §5.1 step 4, in order: an earlier approval, the auto mode, an inherited approval, the mode table. */
async function approvalFor(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  open: FxIntentRow | null,
  plan: Extract<IntentPlan, { action: "convert" }>,
): Promise<Approval> {
  const kept = plan.keep !== null && open?.id === plan.keep ? open : null;
  if (kept?.approvedAt) {
    const cap = kept.approvedAmountAtomic === null ? null : BigInt(kept.approvedAmountAtomic);
    return { kind: "granted", cap, save: {}, approved: true };
  }
  const mode = ctx.rules.approvalMode;
  if (mode === "auto") return { kind: "granted", cap: null, save: {}, approved: false };
  if (plan.decision.reason === "top_up") {
    const parent = await inheritableApproval(deps.db, ctx.userId, deps.now());
    if (parent) {
      return { kind: "granted", cap: parent.boughtAtomic, save: { via: parent.intentId, capAtomic: parent.boughtAtomic }, approved: true };
    }
  }
  if (modeNeedsApproval(mode, plan.decision.reason)) return { kind: "needed" };
  return { kind: "granted", cap: null, save: {}, approved: false };
}

/** Trade approvals §2: never more than the freelancer approved. */
function capDecision(d: ConvertDecision, cap: bigint | null, rates: ReferenceRates): ConvertDecision {
  if (cap === null || d.amount <= cap) return d;
  return { ...d, amount: cap, usdWad: usdWad(d.from, cap, rates) };
}

/** Trade approvals §5.1 step 5: store the proposal and tell the freelancer once per intent. */
async function propose(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  plan: Extract<IntentPlan, { action: "convert" }>,
  result: Result,
): Promise<RunResult> {
  const intent = await proposeIntent(deps.db, ctx.userId, plan, deps.now());
  await logOncePerIntent(deps, ctx.userId, intent.id, "proposed", decisionData(plan.decision));
  return result("awaiting_approval");
}
```

4. In `logOncePerIntent`, widen the type: `type: "waiting" | "no_quote" | "needs_gas" | "proposed",`.

5. Replace `dryRun`:

```ts
/**
 * Spec §10.3 in dry run: record what would be done, once per pair and reason, and keep no intent.
 * A stored intent would age while nothing trades, and the first live run would then treat it as past
 * the wait deadline and accept a price up to the hard limit at once. An approved intent is the
 * exception (trade approvals §5.3): cancelling it would make the next run propose it again.
 */
async function dryRun(
  deps: ExecutorDeps,
  ctx: TreasuryContext,
  plan: Extract<IntentPlan, { action: "convert" }>,
  keepApproved: boolean,
  result: Result,
): Promise<RunResult> {
  for (const id of [plan.cancel, keepApproved ? null : plan.keep]) if (id) await cancelIntent(deps.db, id, deps.now());
  const data = decisionData(plan.decision);
  const last = await lastEvent(deps.db, ctx.userId, "dry_run");
  if (!last || dryRunKey(last.data) !== dryRunKey(data)) await logEvent(deps.db, ctx.userId, "dry_run", data, deps.now());
  return result("dry_run");
}
```

6. In `trade`, change the wait start:

```ts
    intentCreatedAt: waitStartedAt(intent),
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run src/lib/treasury/executor.test.ts -t "approvals"`
Expected: PASS. If the USD₮ refill test fails on `quoteMatches` (`takerPays` above the capped amount), print `deps.rfq.request.mock.calls.at(-1)` and lower the second quote's `takerPays`/`buyAmount` keeping a slippage under 0.5%; do not change the executor for it.

- [ ] **Step 6: Run the whole treasury suite**

Run: `npx vitest run src/lib/treasury && npm run typecheck && npm run lint`
Expected: PASS, with every pre-existing executor test unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/treasury/executor.ts src/lib/treasury/executor.test.ts
git commit -m "feat(treasury): ask before converting when the approval mode says so

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rules form and preview

**Files:**
- Modify: `src/lib/treasury/rules-form.ts`, `src/app/app/rules/rules-form.tsx`, `src/app/app/rules/page.tsx`, `src/i18n/en.ts`
- Test: `src/lib/treasury/rules-form.test.ts`, `src/lib/treasury/explain.test.ts`

**Interfaces:**
- Consumes: `APPROVAL_MODES`, `isApprovalMode`, `modeNeedsApproval` (Task 2); `describeDecision(…, { askFirst })` (Task 3).
- Produces: `RulesInput.approvalMode: ApprovalMode`; `RulesField` includes `"approvalMode"`; `rulesFormValues(row).approvalMode`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/treasury/rules-form.test.ts`, add `approvalMode: "sell_usd"` to `VALID` and to the expected `data` of "reads the sentence and the advanced settings", then append:

```ts
describe("approval mode", () => {
  it("reads each mode and refuses others", () => {
    for (const approvalMode of ["auto", "sell_usd", "all"] as const) {
      const parsed = parseRulesForm({ ...VALID, approvalMode });
      expect(parsed.ok && parsed.data.approvalMode).toBe(approvalMode);
    }
    expect(parseRulesForm({ ...VALID, approvalMode: "sometimes" })).toEqual({
      ok: false,
      errors: { approvalMode: "rules.error.approvalMode" },
    });
  });

  it("round-trips through the stored rules", async () => {
    const user = await seedFreelancer(db);
    const parsed = parseRulesForm({ ...VALID, approvalMode: "all" });
    if (!parsed.ok) throw new Error("expected valid rules");
    await saveRules(db, user.id, parsed.data, new Date());
    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(rulesFormValues(row).approvalMode).toBe("all");
  });
});
```

In `src/lib/treasury/explain.test.ts`, append:

```ts
describe("describeDecision with approval", () => {
  it("says the agent would ask first", () => {
    const decision = { kind: "convert", from: "USDT", to: "WARS", amount: 2_000_000n, usdWad: 0n, reason: "top_up" } as const;
    expect(describeDecision(decision, ctx, { askFirst: true })).toMatch(/^ask you to approve converting ≈ ARS.3,200 to pesos\./);
  });
});
```

If any existing `rulesFormValues` test compares the whole object, add `approvalMode: "sell_usd"` to its expectation.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/rules-form.test.ts src/lib/treasury/explain.test.ts`
Expected: FAIL on `approvalMode`.

- [ ] **Step 3: Parse and store the mode**

In `src/lib/treasury/rules-form.ts`:

- Import `import type { ApprovalMode } from "@/lib/db/schema";` (merge into the existing schema import) and `import { isApprovalMode } from "./approvals";`.
- Add `| "approvalMode"` to `RulesField` and `approvalMode: ApprovalMode;` to `RulesInput`.
- In `parseRulesForm`, after the reserve check:

```ts
  const approvalMode = fields.approvalMode;
  if (!isApprovalMode(approvalMode)) errors.approvalMode = "rules.error.approvalMode";
```

- Add `!isApprovalMode(approvalMode) ||` to the failure condition, and `approvalMode,` to `data`.
- In `rulesFormValues`, add `approvalMode: row.approvalMode,`.

- [ ] **Step 4: Texts**

In `src/i18n/en.ts`, next to the `rules.*` keys:

```ts
  "rules.approval.legend": "When should your agent ask you?",
  "rules.approval.auto": "Never: convert on its own",
  "rules.approval.autoHelp": "Your agent follows your rules without asking.",
  "rules.approval.sell_usd": "Before using my dollars",
  "rules.approval.sell_usdHelp": "Your agent saves extra pesos in dollars on its own, but asks before using dollars to buy your currency.",
  "rules.approval.all": "Before every conversion",
  "rules.approval.allHelp": "Your agent suggests each conversion and waits for your approval.",
  "rules.error.approvalMode": "Choose when your agent should ask you.",
```

- [ ] **Step 5: The radio group**

In `src/app/app/rules/rules-form.tsx`, import `APPROVAL_MODES` from `@/lib/treasury/approvals`, and insert after the `autoTopUp` `<label>`:

```tsx
      <fieldset className="flex flex-col gap-2" aria-describedby={state.errors.approvalMode ? "approvalMode-error" : undefined}>
        <legend className="mb-2 font-medium">{t("rules.approval.legend")}</legend>
        {APPROVAL_MODES.map((mode) => (
          <label key={mode} className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="approvalMode"
              value={mode}
              defaultChecked={state.values.approvalMode === mode}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex flex-col">
              <span>{t(`rules.approval.${mode}`)}</span>
              <span className="text-sm text-muted-foreground">{t(`rules.approval.${mode}Help`)}</span>
            </span>
          </label>
        ))}
        {state.errors.approvalMode && (
          <p id="approvalMode-error" role="alert" className="text-sm text-destructive">
            {t(state.errors.approvalMode)}
          </p>
        )}
      </fieldset>
```

- [ ] **Step 6: The preview**

In `src/app/app/rules/page.tsx`, import `modeNeedsApproval` from `@/lib/treasury/approvals`, and in `Preview` replace the `text = …` line with:

```tsx
    const decision = decide(input);
    const askFirst = decision.kind === "convert" && modeNeedsApproval(row.approvalMode, decision.reason);
    text = describeDecision(decision, { local: row.localCurrency, rates }, { askFirst });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/treasury && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/treasury/rules-form.ts src/lib/treasury/rules-form.test.ts src/lib/treasury/explain.test.ts src/app/app/rules src/i18n/en.ts
git commit -m "feat(rules): choose when the agent asks before converting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Approve, dismiss and pause actions

**Files:**
- Modify: `src/lib/treasury/live.ts`, `src/app/app/actions.ts`, `src/app/app/page.tsx` (only `maxDuration`)

**Interfaces:**
- Consumes: `parseProposalForm`, `intentEventData` (Task 2); `approveProposal`, `dismissProposal`, `cancelProposals` (Task 4).
- Produces:
  - `runTreasuryAfterApproval(userId: string): Promise<void>` in `live.ts`
  - `interface ProposalState { outcome: "approved" | "dismissed" | "changed" | null }`
  - `approveProposalAction(previous: ProposalState, formData: FormData): Promise<ProposalState>`
  - `dismissProposalAction(previous: ProposalState, formData: FormData): Promise<ProposalState>`

The actions stay thin: their logic is the repository functions tested in Task 4. They are checked by hand in Task 8.

- [ ] **Step 1: The background run**

In `src/lib/treasury/live.ts`, after `runTreasuryAfterPayment`:

```ts
/** Trade approvals §5.2: an approval schedules a run for its owner at once. Called from after(). */
export async function runTreasuryAfterApproval(userId: string): Promise<void> {
  try {
    if (!parseServerEnv().TREASURY_ENABLED) return;
    await runTreasuryForUser(liveExecutorDeps(), userId);
  } catch (error) {
    console.error(`Treasury run after approval for ${userId} failed:`, error);
  }
}
```

- [ ] **Step 2: The actions**

In `src/app/app/actions.ts`, add imports:

```ts
import { after } from "next/server";
import { formFields } from "@/lib/forms";
import { intentEventData, parseProposalForm } from "@/lib/treasury/approvals";
import { runTreasuryAfterApproval } from "@/lib/treasury/live";
import { approveProposal, cancelProposals, dismissProposal } from "@/lib/treasury/repo";
```

(`logEvent` is already imported from `@/lib/treasury/repo`; merge the names into that import.) Then append:

```ts
export interface ProposalState {
  outcome: "approved" | "dismissed" | "changed" | null;
}

/** Trade approvals §5.2: approve what the banner showed, then run the agent at once. */
export async function approveProposalAction(_previous: ProposalState, formData: FormData): Promise<ProposalState> {
  const user = await requireUser();
  const form = parseProposalForm(formFields(formData));
  if (!form) return { outcome: "changed" };
  const db = getDb();
  const now = new Date();
  const intent = await db.transaction(async (tx) => {
    const row = await approveProposal(tx, user.id, form.intentId, form.seenAtomic, now);
    if (row) await logEvent(tx, user.id, "approved", intentEventData(row), now);
    return row;
  });
  if (!intent) return { outcome: "changed" };
  after(() => runTreasuryAfterApproval(user.id));
  refresh();
  return { outcome: "approved" };
}

/** Trade approvals §5.2: drop the proposal; its group stays quiet for 24 hours. */
export async function dismissProposalAction(_previous: ProposalState, formData: FormData): Promise<ProposalState> {
  const user = await requireUser();
  const form = parseProposalForm(formFields(formData));
  if (!form) return { outcome: "changed" };
  const db = getDb();
  const now = new Date();
  const intent = await db.transaction(async (tx) => {
    const row = await dismissProposal(tx, user.id, form.intentId, now);
    if (row) await logEvent(tx, user.id, "dismissed", intentEventData(row), now);
    return row;
  });
  if (!intent) return { outcome: "changed" };
  refresh();
  return { outcome: "dismissed" };
}
```

In `setAgentEnabled`, before `logEvent`:

```ts
  // Trade approvals §5.3: a paused agent has nothing to propose; this is not a dismissal.
  if (!enabled) await cancelProposals(db, user.id, now);
```

- [ ] **Step 3: Give the dashboard's actions time to trade**

In `src/app/app/page.tsx`, below `metadata`:

```ts
/**
 * Approving a proposal runs the agent in after(): it may reconcile, drip gas, request a quote and wait
 * for receipts, like the withdrawal action, so it gets the same 300 s as the wallet lock.
 */
export const maxDuration = 300;
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run src/lib/treasury`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/live.ts src/app/app/actions.ts src/app/app/page.tsx
git commit -m "feat(treasury): approve and dismiss proposals; pausing drops them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dashboard banner, nav dot, agent status and onboarding note

**Files:**
- Modify: `src/lib/treasury/view.ts`, `src/app/app/agent-status.tsx`, `src/app/app/page.tsx`, `src/app/app/app-nav.tsx`, `src/app/app/layout.tsx`, `src/app/app/onboarding/onboarding-form.tsx`, `src/i18n/en.ts`
- Create: `src/app/app/proposal-banner.tsx`, `src/app/app/proposal-controls.tsx`
- Test: `src/lib/treasury/view.test.ts`

**Interfaces:**
- Consumes: `openProposal` (Task 4), `describeProposal` (Task 3), the actions and `ProposalState` (Task 7).
- Produces: `AgentState` gains `"awaiting"`; `agentState` takes `awaitingApproval: boolean`; `AppNavLinks({ pathname, hasProposal })`; `AppNav({ hasProposal })`.

- [ ] **Step 1: Write the failing test**

In `src/lib/treasury/view.test.ts`, replace the `agentState` test with:

```ts
describe("agentState", () => {
  it("shows the most restrictive switch, then a waiting proposal", () => {
    const base = { globalEnabled: true, dryRun: false, userEnabled: true, awaitingApproval: false };
    expect(agentState({ ...base, globalEnabled: false, awaitingApproval: true })).toBe("off");
    expect(agentState({ ...base, userEnabled: false, awaitingApproval: true })).toBe("paused");
    expect(agentState({ ...base, awaitingApproval: true })).toBe("awaiting");
    expect(agentState({ ...base, dryRun: true })).toBe("dry_run");
    expect(agentState(base)).toBe("active");
  });
});
```

Run: `npx vitest run src/lib/treasury/view.test.ts`
Expected: FAIL.

- [ ] **Step 2: Agent state**

In `src/lib/treasury/view.ts`:

```ts
export type AgentState = "off" | "paused" | "awaiting" | "dry_run" | "active";

/** Spec §17.1 principle 4: Active / Paused / Dry run is always visible ("off" = the global switch); a proposal waits on the freelancer. */
export function agentState(input: { globalEnabled: boolean; dryRun: boolean; userEnabled: boolean; awaitingApproval: boolean }): AgentState {
  if (!input.globalEnabled) return "off";
  if (!input.userEnabled) return "paused";
  if (input.awaitingApproval) return "awaiting";
  return input.dryRun ? "dry_run" : "active";
}
```

Run: `npx vitest run src/lib/treasury/view.test.ts`
Expected: PASS.

- [ ] **Step 3: Texts**

In `src/i18n/en.ts`:

```ts
  "agent.state.awaiting": "Needs you",
  "agent.help.awaiting": "Your agent has a conversion for you to approve. It won't move that money until you do.",
  "proposal.approve": "Approve",
  "proposal.approving": "Approving…",
  "proposal.dismiss": "Dismiss for 24 hours",
  "proposal.approved": "Approved. Your agent is converting it now.",
  "proposal.dismissed": "Dismissed. Your agent won't suggest this for 24 hours.",
  "proposal.changed": "This proposal changed. Have a look again.",
  "nav.proposalWaiting": "1 proposal waiting for your approval",
  "onboarding.approvalNote": "Your agent asks you before using dollars to buy {currency}. You can change this on the Agent page.",
```

- [ ] **Step 4: Agent status card**

In `src/app/app/agent-status.tsx`:

- Import `Hand` from `lucide-react` and `openProposal` from `@/lib/treasury/repo` (merge with `listEvents`).
- Add to `CHIPS`: `awaiting: { icon: Hand, className: "text-warning" },`.
- Replace the `Promise.all` line and the `state` line with:

```tsx
  const [[last], rates, proposal] = await Promise.all([listEvents(db, user.id, 1), getReferenceRatesOrNull(), openProposal(db, user.id)]);
  const state = agentState({
    globalEnabled: env.TREASURY_ENABLED,
    dryRun: env.TREASURY_DRY_RUN,
    userEnabled: row.enabled,
    awaitingApproval: proposal !== null,
  });
```

- Change the toggle condition so a waiting proposal still shows Pause: `{state !== "off" && <AgentToggle enabled={row.enabled} />}` stays as is (it already covers `awaiting`).

- [ ] **Step 5: Banner controls (client)**

```tsx
// src/app/app/proposal-controls.tsx
"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { approveProposalAction, dismissProposalAction, type ProposalState } from "./actions";

const INITIAL: ProposalState = { outcome: null };

/** "Approve" is the screen's one primary action while a proposal waits (MASTER.md "Buttons"). */
export function ProposalControls({ intentId, seenAtomic }: { intentId: string; seenAtomic: string }) {
  const [approved, approve] = useActionState(approveProposalAction, INITIAL);
  const [dismissed, dismiss] = useActionState(dismissProposalAction, INITIAL);
  const outcome = approved.outcome ?? dismissed.outcome;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <form action={approve}>
          <input type="hidden" name="intentId" value={intentId} />
          <input type="hidden" name="seenAtomic" value={seenAtomic} />
          <SubmitButton pendingLabel={t("proposal.approving")}>{t("proposal.approve")}</SubmitButton>
        </form>
        <form action={dismiss}>
          <input type="hidden" name="intentId" value={intentId} />
          <Button type="submit" variant="outline" size="lg" className="min-h-11">
            {t("proposal.dismiss")}
          </Button>
        </form>
      </div>
      <div aria-live="polite">
        {outcome === "approved" && <p className="text-success">{t("proposal.approved")}</p>}
        {outcome === "dismissed" && <p>{t("proposal.dismissed")}</p>}
      </div>
      {outcome === "changed" && (
        <p role="alert" className="text-destructive">
          {t("proposal.changed")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Banner (server)**

```tsx
// src/app/app/proposal-banner.tsx
import { eq } from "drizzle-orm";
import { Hand } from "lucide-react";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { rules, type FxIntentRow } from "@/lib/db/schema";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { describeProposal } from "@/lib/treasury/explain";
import type { AppUser } from "@/lib/users/queries";
import { ProposalControls } from "./proposal-controls";

/** Trade approvals §6: what the agent wants to do, why, at what price; token units behind Details. */
export async function ProposalBanner({ user, proposal }: { user: AppUser; proposal: FxIntentRow }) {
  const db = getDb();
  const [[row], rates] = await Promise.all([db.select().from(rules).where(eq(rules.userId, user.id)), getReferenceRatesOrNull()]);
  if (!row) return null;
  const view = describeProposal(proposal, { local: user.localCurrency, rates }, row.maxSlippageBps);
  return (
    <section aria-labelledby="proposal-heading" className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
      <h2 id="proposal-heading" className="flex items-center gap-2 text-lg font-semibold">
        <Hand aria-hidden="true" className="size-5 text-warning" />
        {view.title}
      </h2>
      <p className="font-medium">{view.body}</p>
      <p className="max-w-prose text-muted-foreground">
        {view.why} {view.price}
      </p>
      <ProposalControls key={`${proposal.id}:${proposal.amountAtomic}`} intentId={proposal.id} seenAtomic={proposal.amountAtomic} />
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
        <p className="tabular-nums">{view.units}</p>
      </details>
    </section>
  );
}
```

- [ ] **Step 7: Dashboard**

In `src/app/app/page.tsx`:

- Import `openProposal` from `@/lib/treasury/repo` and `ProposalBanner` from `./proposal-banner`.
- In `Home`, load the proposal with the invoices and demote "New invoice" while it waits:

```tsx
  const db = getDb();
  const [invoices, rates, proposal] = await Promise.all([listInvoices(db, user.id), getReferenceRatesOrNull(), openProposal(db, user.id)]);
  // One primary action per screen: a setup or approval banner takes it from "New invoice" (MASTER.md "Buttons").
  const newInvoiceLink = user.treasuryStatus === "ready" && !proposal ? primaryLink : secondaryLink;
```

- Below `<SetupBanner status={user.treasuryStatus} />`:

```tsx
      {proposal && (
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <ProposalBanner user={user} proposal={proposal} />
        </Suspense>
      )}
```

- [ ] **Step 8: Nav dot**

In `src/app/app/app-nav.tsx`:

```tsx
export function AppNav({ hasProposal }: { hasProposal: boolean }) {
  return <AppNavLinks pathname={usePathname()} hasProposal={hasProposal} />;
}

export function AppNavLinks({ pathname, hasProposal = false }: { pathname: string | null; hasProposal?: boolean }) {
```

and inside the `<Link>`, replace `<Icon aria-hidden="true" className="size-5" />` with:

```tsx
                <span className="relative">
                  <Icon aria-hidden="true" className="size-5" />
                  {hasProposal && href === "/app/rules" && (
                    <span aria-hidden="true" className="absolute -right-1 -top-1 size-2.5 rounded-full bg-destructive" />
                  )}
                </span>
                {t(label)}
                {hasProposal && href === "/app/rules" && <span className="sr-only">{t("nav.proposalWaiting")}</span>}
```

(Remove the now-duplicated `{t(label)}` that followed the icon.)

In `src/app/app/layout.tsx`:

```tsx
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { openProposal } from "@/lib/treasury/repo";
import { AppNav, AppNavLinks } from "./app-nav";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* usePathname can suspend and the proposal read needs the session; the fallback is the nav without marks */}
      <Suspense fallback={<AppNavLinks pathname={null} />}>
        <NavWithProposal />
      </Suspense>
      {/* pb-20 keeps content clear of the fixed mobile bar */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-0">{children}</div>
    </div>
  );
}

/** Trade approvals §6: a dot on the Agent tab while a proposal waits. Signed-out and onboarding visitors get none. */
async function NavWithProposal() {
  const user = await getCurrentUser();
  const proposal = user ? await openProposal(getDb(), user.id) : null;
  return <AppNav hasProposal={proposal !== null} />;
}
```

- [ ] **Step 9: Onboarding note**

In `src/app/app/onboarding/onboarding-form.tsx`, right after the reserve `</FormField>`:

```tsx
      <p className="text-sm text-muted-foreground">{t("onboarding.approvalNote", { currency })}</p>
```

- [ ] **Step 10: Full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all exit 0. Read the build output for any "Uncached data was accessed outside of <Suspense>" error; if the layout triggers it, keep `NavWithProposal` inside the `<Suspense>` as written.

- [ ] **Step 11: Check by hand on localhost**

Ask the user before this step: it needs `npm run db:migrate` on the Neon **dev** branch (applies 0003) and a dev server. With their yes:

1. `npm run db:migrate`, then `npm run dev`.
2. Sign in as the dev user (wallet `0x1e1b…2070`, empty). Rules page: the radio group shows "Before using my dollars" selected; switching to "Before every conversion" and saving keeps it after a reload.
3. Without a funded dev treasury the banner cannot be produced by the agent. Insert one proposal by SQL on the dev branch only (ask first), for example `INSERT INTO fx_intents (user_id, from_asset, to_asset, amount_atomic, reason, status) VALUES ('<dev user id>', 'USDT', 'WARS', '2100000', 'top_up', 'proposed');`, then check: banner text and Details, "New invoice" is secondary, Agent tab dot (mobile width too), agent card "Needs you". Dismiss: banner gone, activity feed shows the dismissal. Insert another, Approve: banner gone, activity shows the approval (the run itself finds an empty wallet and goes idle).
4. Keyboard: Tab reaches Approve, Dismiss and Details in order with a visible focus ring.

- [ ] **Step 12: Commit**

```bash
git add src/lib/treasury/view.ts src/lib/treasury/view.test.ts src/app/app src/i18n/en.ts
git commit -m "feat(dashboard): proposal banner, Agent tab dot and waiting state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Main spec and final gate

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-cobro-design.md`, `docs/superpowers/specs/2026-10-14-trade-approvals-design.md` (status line only)

- [ ] **Step 1: Update the main spec**

1. §10.1 table, after the `autoTopUp` row:

```markdown
| `approvalMode` | sell_usd | When the agent asks first: `auto` never, `sell_usd` before selling dollars, `all` before every conversion ([trade approvals](2026-10-14-trade-approvals-design.md)) |
```

2. §10.2, after the "At most one open intent per user" bullet:

```markdown
- A conversion the approval mode asks about is stored as a `proposed` intent instead of trading. Approval
  caps it at the amount shown; dismissal silences its group (refill or save) for 24 hours. See the
  [trade approvals spec](2026-10-14-trade-approvals-design.md) §5.
```

3. §10.4 step 2, append: "A conversion that needs approval stops here as a proposal (trade approvals §5.1)."

4. §11, the `fx_intents` line becomes:

```
fx_intents       id, user_id, from_asset, to_asset, amount_atomic, reason, status (proposed|waiting|executing|filled|blocked|cancelled), created_at, attempts, last_slippage_bps, retry_after, approved_amount_atomic, approved_at, dismissed_at, approved_via
```

and add under "Added in Plan 2" a new paragraph:

```markdown
Added with trade approvals: `rules.approval_mode` (`auto|sell_usd|all`, default `sell_usd`) and the
`fx_intents` approval columns above; the open-intent index covers `proposed`.
```

5. §17.2: in the Dashboard row add "a proposal banner (Approve / Dismiss for 24 hours) when the agent waits for approval; a dot on the Agent tab"; in the Rules row add "a 'When should your agent ask you?' choice".

6. In the trade approvals spec header, set `- **Status:** Implemented`.

- [ ] **Step 2: Final gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all exit 0. Paste the test count in the commit message body.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs
git commit -m "docs: trade approvals in the main spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand over for rollout**

Stop here and report to the user. Rollout follows spec §8 and needs their yes at each step: merge `--no-ff` into `main` and re-run the gate; apply 0003 to Neon main before deploying (the deploy reads `approval_mode`); push; smoke on the smoke-A account (a real proposal, approve, `/celo-tx-check` on the swap, then a dismissal).
