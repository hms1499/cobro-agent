# Plan 3b: Infrastructure Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the treasury agent run on time and fairly, cut redundant dashboard reads and RPC calls, and get told when a cron run goes wrong, using only free services.

**Architecture:**
- The cron route gets an async mode: it answers `202` at once and runs the tick in `after()`. That fits cron-job.org's 30 s request limit, and cron-job.org becomes the frequent trigger. The synchronous mode stays for GitHub Actions, which becomes the backup trigger and the alert channel: its workflow fails when the tick reports errors.
- A cron tick visits wallets in random order, with at most three running at once.
- viem batches concurrent reads into one Multicall3 call. Screens read balances through a client that falls back to a second free RPC. Money paths stay on the primary RPC.
- Per-request reads of the user, rules and open proposal go through React `cache()`.

**Tech Stack:** Everything from Plans 1–3 and trade approvals, with no new dependencies: Next.js 16.4.0 (`after()` from `next/server`), React 19.3 (`cache`), viem 2.57.3 (`batch.multicall`, `fallback`, `multicall3Abi`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-cobro-design.md` (§7.1 Scheduler, §10.4 Executor, §12 Safety). The source for this plan is the system design review of 2026-10-16. It recorded these findings:
- GitHub's `*/10` schedule actually runs every 2–5 hours.
- The cron visits wallets serially in `user_id` order, inside a 180 s start budget, so later wallets starve.
- `/app` repeats the user lookup twice, the open-proposal lookup three times and the rules read three times.
- A treasury balance read makes five `eth_call`s, and forno is the only RPC.
- Failures exist only as `console.error` lines.

Free-service facts:
- cron-job.org (FAQ, read 2026-10-16): free, jobs every minute at most, custom headers, POST, email on failure, **30 s request timeout**, and a job is auto-disabled after more than 25 failures.
- Vercel: a function keeps running after the client disconnects unless `supportsCancellation` is set. Work that must finish belongs in `after()`.
- Free Celo RPCs answering `eth_chainId` = `0xa4ec` on 2026-10-16:
  - `https://celo.drpc.org` (0.23 s)
  - `https://1rpc.io/celo` (0.40 s)
  - `https://rpc.ankr.com/celo` (0.47 s)

## Global Constraints

- Celo mainnet only: chain id `42220`. Primary RPC is `CELO_RPC_URL`, default `https://forno.celo.org`. Multicall3 is `0xcA11bde05977b3631167028862bE2a173976CA11`, from viem's `celo.contracts.multicall3`.
- **Money paths read only from the primary RPC client.** That covers the executor, withdrawals, allowance, receipts, nonce and sending. A lagging fallback node could show a stale allowance or balance, and a swap built on it reverts. The fallback client is for screens only: the dashboard, the rules preview and the withdraw page's list of amounts.
- Every transaction we broadcast still carries the tag `celo_bc3965e128ba`. This plan changes no signing or sending code.
- The cron secret check (`isAuthorizedCron`) runs **before** anything is scheduled or run. An unauthorized request gets `401` and schedules nothing.
- Wallet locks (`acquireWalletLock`, 5 min TTL) are what make overlapping ticks safe. Two triggers (cron-job.org and GitHub) may overlap, and a wallet that is busy returns `locked`.
- Concurrency is at most **3** wallets at once, below Textile's limit of 4 outstanding RFQs.
- Secrets live only in `.env.local`, Vercel env and GitHub Actions secrets. Never print, log or commit them. Push them through stdin.
- All user-facing text goes through `t()`. This plan adds no user-facing text.
- Tests are colocated `*.test.ts` run by `npm test`. Unit tests never touch the network: use `custom()` viem transports and fake deps.
- Branch `plan-3b-infra`. Commit messages are `feat(scope): …` / `fix(scope): …` / `docs: …` / `chore: …`, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not edit `.env.example`. It carries the user's uncommitted notes. New env values have code defaults instead.
- No Vercel env change, merge, push, secret rotation or cron-job.org change happens before Task 6, and in Task 6 only after the user says yes to that step.

## Review Focus

1. **cron-job.org and GitHub ticks overlap.** Each wallet runs once; the other tick sees `locked`, which is not an error. Pinned in Task 2 (`tickHasErrors` ignores `locked`).
2. **The background tick throws** (for example, the DB is down when issuing recurring invoices). The error is logged as `CRON TICK FAILED` and nothing is unhandled. Pinned in Task 2.
3. **An unauthorized async request** gets `401` and schedules nothing. Pinned in Task 2.
4. **One wallet's run throws while two others are in flight.** The others finish, the failure is counted, and no wallet runs twice. Pinned in Task 1.
5. **One token's `balanceOf` fails inside the multicall.** The balance read rejects as it did before, so the dashboard shows its load error instead of a silent zero. Pinned in Task 3.

---

### Task 1: Bounded concurrency in `runTreasuries`

**Files:**
- Modify: `src/lib/treasury/executor.ts` (function `runTreasuries`, near the end of the file)
- Test: `src/lib/treasury/executor.test.ts` (`describe("runTreasuries")`)

**Interfaces:**
- Produces: `runTreasuries(userIds: string[], run: (userId: string) => Promise<RunResult>, opts?: { deadline?: number; now?: () => number; concurrency?: number }): Promise<RunResult[]>`. Results come in completion order. The default concurrency is 1, which is the current behaviour.

- [ ] **Step 1: Write the failing tests** (append inside `describe("runTreasuries", …)`)

```ts
  it("runs at most `concurrency` wallets at once and visits each exactly once", async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];
    const run = async (userId: string) => {
      active += 1;
      peak = Math.max(peak, active);
      seen.push(userId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (userId === "c") throw new Error("boom");
      return { userId, outcome: "idle" as const };
    };
    const results = await runTreasuries(["a", "b", "c", "d", "e"], run, { concurrency: 3 });
    expect(peak).toBe(3);
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(results).toHaveLength(5);
    expect(results.find((r) => r.userId === "c")).toEqual({ userId: "c", outcome: "failed", detail: "boom" });
  });

  it("returns at once for no wallets, whatever the concurrency", async () => {
    expect(await runTreasuries([], async (userId) => ({ userId, outcome: "idle" as const }), { concurrency: 3 })).toEqual([]);
  });

  it("starts no new wallet after the deadline, even with free workers", async () => {
    let clock = 0;
    const started: string[] = [];
    const results = await runTreasuries(
      ["a", "b", "c", "d"],
      async (userId) => {
        started.push(userId);
        await Promise.resolve(); // let the second worker start before time moves on
        clock += 100;
        return { userId, outcome: "idle" as const };
      },
      { concurrency: 2, deadline: 50, now: () => clock },
    );
    // a and b start at clock 0; after either finishes the clock is past 50, so c and d never start.
    expect([...started].sort()).toEqual(["a", "b"]);
    expect(results).toHaveLength(2);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/executor.test.ts -t runTreasuries`
Expected: FAIL. `peak` is 1, not 3, because the runs are serial today. The deadline test may already pass.

- [ ] **Step 3: Implement**

Replace `runTreasuries` in `src/lib/treasury/executor.ts` with:

```ts
/**
 * Runs wallets with at most `concurrency` at once (default 1); a failure never stops the others.
 * No new wallet starts after `deadline`. Results come in completion order.
 */
export async function runTreasuries(
  userIds: string[],
  run: (userId: string) => Promise<RunResult>,
  opts: { deadline?: number; now?: () => number; concurrency?: number } = {},
): Promise<RunResult[]> {
  const now = opts.now ?? Date.now;
  const queue = [...userIds];
  const results: RunResult[] = [];
  const worker = async () => {
    while (queue.length > 0) {
      if (opts.deadline !== undefined && now() > opts.deadline) return;
      const userId = queue.shift()!;
      try {
        results.push(await run(userId));
      } catch (error) {
        console.error(`Treasury run for ${userId} failed:`, error);
        results.push({ userId, outcome: "failed", detail: messageOf(error) });
      }
    }
  };
  const workers = Math.min(Math.max(1, opts.concurrency ?? 1), queue.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/treasury/executor.test.ts -t runTreasuries`
Expected: PASS, including the existing test "keeps going after one wallet fails…".

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/executor.ts src/lib/treasury/executor.test.ts
git commit -m "feat(treasury): run up to N wallets at once in a cron tick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cron tick module, async mode and the alert flag

**Files:**
- Create: `src/lib/cron/tick.ts`
- Create: `src/lib/cron/tick.test.ts`
- Modify: `src/app/api/cron/treasury/route.ts` (whole file)
- Modify: `.github/workflows/treasury-cron.yml` (the `run:` block)

**Interfaces:**
- Consumes: `runTreasuries(…, { concurrency })` and `summarizeRuns` from Task 1; `ReconcileResult` from `@/lib/payments/reconcile`; `RunOutcome` and `RunResult` from `@/lib/treasury/executor`; `isAuthorizedCron` from `./auth`.
- Produces:
  - `TickResult`
  - `TickDeps`
  - `TREASURY_CONCURRENCY = 3`
  - `shuffled<T>(items: readonly T[], random?: () => number): T[]`
  - `runCronTick(deps: TickDeps): Promise<TickResult>`
  - `tickHasErrors(result: TickResult): boolean`
  - `handleCronRequest(request: Request, opts: { secret: string | undefined; tick: () => Promise<TickResult>; schedule: (task: () => Promise<void>) => void }): Promise<Response>`

- [ ] **Step 1: Write the failing tests** in `src/lib/cron/tick.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { handleCronRequest, runCronTick, shuffled, tickHasErrors, type TickDeps, type TickResult } from "./tick";

const SECRET = "s".repeat(40);
const OK: TickResult = {
  issued: 0,
  reconciled: { recorded: 0, reopened: 0, errors: 0 },
  pending: { settled: 0, stillPending: 0, errors: 0 },
  treasury: { idle: 1 },
};

function deps(over: Partial<TickDeps> = {}): TickDeps {
  return {
    issueDue: async () => 0,
    reconcileSettlements: async () => ({ recorded: 0, reopened: 0, errors: 0 }),
    reconcileWallets: async () => ({ settled: 0, stillPending: 0, errors: 0 }),
    treasuryEnabled: true,
    listUsers: async () => ["a", "b"],
    runUser: async (userId) => ({ userId, outcome: "idle" }),
    deadline: Number.MAX_SAFE_INTEGER,
    ...over,
  };
}

const post = (query = "", auth = `Bearer ${SECRET}`) =>
  new Request(`https://cobro.test/api/cron/treasury${query}`, { method: "POST", headers: { authorization: auth } });

describe("shuffled", () => {
  it("returns a permutation and leaves the input alone", () => {
    const input = ["a", "b", "c", "d"];
    const out = shuffled(input, () => 0);
    expect([...out].sort()).toEqual(input);
    expect(out).not.toEqual(input); // random() = 0 rotates the order
    expect(input).toEqual(["a", "b", "c", "d"]);
  });
});

describe("runCronTick", () => {
  it("issues, reconciles and runs every listed wallet", async () => {
    const runUser = vi.fn(async (userId: string) => ({ userId, outcome: "idle" as const }));
    const result = await runCronTick(deps({ issueDue: async () => 2, runUser }));
    expect(result).toEqual({ ...OK, issued: 2, treasury: { idle: 2 } });
    expect(runUser.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]);
  });

  it("reports a failed reconciliation as 'error' and still runs the wallets", async () => {
    const result = await runCronTick(
      deps({ reconcileSettlements: async () => Promise.reject(new Error("rpc down")), reconcileWallets: async () => Promise.reject(new Error("db")) }),
    );
    expect(result.reconciled).toBe("error");
    expect(result.pending).toBe("error");
    expect(result.treasury).toEqual({ idle: 2 });
  });

  it("runs no wallet when the treasury is switched off", async () => {
    const runUser = vi.fn();
    expect((await runCronTick(deps({ treasuryEnabled: false, runUser }))).treasury).toBe("disabled");
    expect(runUser).not.toHaveBeenCalled();
  });
});

describe("tickHasErrors", () => {
  it("is false for a clean tick, a locked wallet or a disabled treasury", () => {
    expect(tickHasErrors(OK)).toBe(false);
    expect(tickHasErrors({ ...OK, treasury: { locked: 1, idle: 2 } })).toBe(false);
    expect(tickHasErrors({ ...OK, treasury: "disabled" })).toBe(false);
  });

  it("is true for any reconciliation error or failed wallet run", () => {
    expect(tickHasErrors({ ...OK, reconciled: "error" })).toBe(true);
    expect(tickHasErrors({ ...OK, reconciled: { recorded: 0, reopened: 0, errors: 1 } })).toBe(true);
    expect(tickHasErrors({ ...OK, pending: "error" })).toBe(true);
    expect(tickHasErrors({ ...OK, pending: { settled: 0, stillPending: 0, errors: 2 } })).toBe(true);
    expect(tickHasErrors({ ...OK, treasury: { failed: 1 } })).toBe(true);
  });
});

describe("handleCronRequest", () => {
  it("answers 401 and schedules nothing without the secret, in either mode", async () => {
    const tick = vi.fn(async () => OK);
    const schedule = vi.fn();
    for (const query of ["", "?mode=async"]) {
      const response = await handleCronRequest(post(query, "Bearer wrong"), { secret: SECRET, tick, schedule });
      expect(response.status).toBe(401);
    }
    expect(tick).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("runs the tick inline and reports ok in sync mode", async () => {
    const response = await handleCronRequest(post(), { secret: SECRET, tick: async () => ({ ...OK, treasury: { failed: 1 } }), schedule: vi.fn() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, treasury: { failed: 1 } });
  });

  it("answers 202 at once in async mode and runs the tick in the scheduled task", async () => {
    let task: (() => Promise<void>) | undefined;
    const tick = vi.fn(async () => OK);
    const response = await handleCronRequest(post("?mode=async"), { secret: SECRET, tick, schedule: (t) => (task = t) });
    expect(response.status).toBe(202);
    expect(tick).not.toHaveBeenCalled();
    await task!();
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("logs a background tick that throws or reports errors, and never rethrows", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const tasks: (() => Promise<void>)[] = [];
    const schedule = (t: () => Promise<void>) => tasks.push(t);
    await handleCronRequest(post("?mode=async"), { secret: SECRET, tick: async () => Promise.reject(new Error("db down")), schedule });
    await handleCronRequest(post("?mode=async"), { secret: SECRET, tick: async () => ({ ...OK, reconciled: "error" }), schedule });
    for (const task of tasks) await expect(task()).resolves.toBeUndefined();
    expect(errors.mock.calls.map(([first]) => first)).toEqual(["CRON TICK FAILED", "CRON TICK HAD ERRORS"]);
    errors.mockRestore();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/cron/tick.test.ts`
Expected: FAIL with "Failed to resolve import ./tick".

- [ ] **Step 3: Implement `src/lib/cron/tick.ts`**

```ts
import type { ReconcileResult } from "@/lib/payments/reconcile";
import { runTreasuries, summarizeRuns, type RunOutcome, type RunResult } from "@/lib/treasury/executor";
import { isAuthorizedCron } from "./auth";

/** Below Textile's 4 outstanding RFQs per taker; each run holds at most one. */
export const TREASURY_CONCURRENCY = 3;

export interface PendingResult {
  settled: number;
  stillPending: number;
  errors: number;
}

export interface TickResult {
  issued: number;
  reconciled: ReconcileResult | "error";
  pending: PendingResult | "error";
  treasury: Partial<Record<RunOutcome, number>> | "disabled";
}

export interface TickDeps {
  issueDue(): Promise<number>;
  reconcileSettlements(): Promise<ReconcileResult>;
  reconcileWallets(): Promise<PendingResult>;
  treasuryEnabled: boolean;
  listUsers(): Promise<string[]>;
  runUser(userId: string): Promise<RunResult>;
  /** No new wallet starts after this (epoch ms). */
  deadline: number;
  now?: () => number;
  random?: () => number;
}

/** Fisher–Yates on a copy, so no wallet is always last when the start budget runs out. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One cron tick (spec §7.1, §10.4): recurring invoices, settlement and wallet reconciliation, then the agents. */
export async function runCronTick(deps: TickDeps): Promise<TickResult> {
  const issued = await deps.issueDue();
  let reconciled: TickResult["reconciled"];
  try {
    reconciled = await deps.reconcileSettlements();
  } catch (error) {
    console.error("Settlement reconciliation failed:", error);
    reconciled = "error";
  }
  // Transactions already sent are settled whatever the switches say; this signs and trades nothing.
  let pending: TickResult["pending"];
  try {
    pending = await deps.reconcileWallets();
  } catch (error) {
    console.error("Treasury reconciliation failed:", error);
    pending = "error";
  }
  if (!deps.treasuryEnabled) return { issued, reconciled, pending, treasury: "disabled" };
  const results = await runTreasuries(shuffled(await deps.listUsers(), deps.random), (userId) => deps.runUser(userId), {
    deadline: deps.deadline,
    now: deps.now,
    concurrency: TREASURY_CONCURRENCY,
  });
  return { issued, reconciled, pending, treasury: summarizeRuns(results) };
}

/** What makes the GitHub workflow fail (and email the owner). `locked` is normal when two triggers overlap. */
export function tickHasErrors(result: TickResult): boolean {
  if (result.reconciled === "error" || result.reconciled.errors > 0) return true;
  if (result.pending === "error" || result.pending.errors > 0) return true;
  return result.treasury !== "disabled" && (result.treasury.failed ?? 0) > 0;
}

/**
 * `?mode=async` answers 202 at once and runs the tick in `schedule` (after() in the route), for
 * cron-job.org's 30 s request limit. Without it the tick runs inline and the body says `ok`, for the
 * GitHub workflow. The secret is checked before anything runs or is scheduled.
 */
export async function handleCronRequest(
  request: Request,
  opts: { secret: string | undefined; tick: () => Promise<TickResult>; schedule: (task: () => Promise<void>) => void },
): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), opts.secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (new URL(request.url).searchParams.get("mode") === "async") {
    opts.schedule(async () => {
      try {
        const result = await opts.tick();
        if (tickHasErrors(result)) console.error("CRON TICK HAD ERRORS", JSON.stringify(result));
        else console.log("Cron tick:", JSON.stringify(result));
      } catch (error) {
        console.error("CRON TICK FAILED", error);
      }
    });
    return Response.json({ accepted: true }, { status: 202 });
  }
  const result = await opts.tick();
  return Response.json({ ok: !tickHasErrors(result), ...result });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cron/tick.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Replace `src/app/api/cron/treasury/route.ts`**

```ts
import { after } from "next/server";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { parseServerEnv } from "@/lib/config/server";
import { handleCronRequest, runCronTick } from "@/lib/cron/tick";
import { getDb } from "@/lib/db/client";
import { issueDueRecurring } from "@/lib/invoices/repo";
import { logTransferFinder, reconcileSettlements } from "@/lib/payments/reconcile";
import { reconcileWallets, runTreasuryForUser } from "@/lib/treasury/executor";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { listTreasuryUsers } from "@/lib/treasury/repo";

/** One RFQ can block up to 75 s and receipts take seconds; stay inside Vercel's 300 s (after() shares it). */
export const maxDuration = 300;
/** No new wallet is started after this, so the last ones can finish within maxDuration. */
const START_BUDGET_MS = 180_000;

/**
 * Called by cron-job.org with `?mode=async` (answers 202, runs in after()) and by
 * .github/workflows/treasury-cron.yml without it (runs inline, body says `ok`). Spec §7.1, §10.4.
 */
export async function POST(request: Request) {
  const env = parseServerEnv();
  const started = Date.now();
  return handleCronRequest(request, {
    secret: env.CRON_SECRET,
    schedule: (task) => after(task),
    tick: () => {
      const db = getDb();
      const deps = liveExecutorDeps();
      return runCronTick({
        issueDue: () => issueDueRecurring(db, new Date()),
        reconcileSettlements: () => reconcileSettlements(db, logTransferFinder(createCeloPublicClient(env.CELO_RPC_URL)), new Date()),
        reconcileWallets: () => reconcileWallets(deps),
        treasuryEnabled: env.TREASURY_ENABLED,
        listUsers: () => listTreasuryUsers(db),
        runUser: (userId) => runTreasuryForUser(deps, userId),
        deadline: started + START_BUDGET_MS,
      });
    },
  });
}
```

- [ ] **Step 6: Make the GitHub workflow fail on a reported error**

In `.github/workflows/treasury-cron.yml`, replace the comment at the top and the `run: |` block:

```yaml
# cron-job.org calls the route every 5 minutes with ?mode=async (spec §7.1). This workflow is the
# backup trigger and the alert: it runs the tick inline and fails (GitHub emails the owner) when the
# tick reports errors. GitHub delays scheduled runs, so expect it every few hours, not every 10 minutes.
```

```yaml
        run: |
          body=$(curl --fail-with-body --silent --show-error --max-time 290 \
            -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
            "${APP_URL}/api/cron/treasury") || { echo "$body"; exit 1; }
          echo "$body"
          echo "$body" | jq -e '.ok == true' > /dev/null || { echo "::error::The cron tick reported errors"; exit 1; }
```

- [ ] **Step 7: Typecheck and run the area's tests**

Run: `npm run typecheck && npx vitest run src/lib/cron src/lib/treasury/executor.test.ts`
Expected: exit 0, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/cron/tick.ts src/lib/cron/tick.test.ts src/app/api/cron/treasury/route.ts .github/workflows/treasury-cron.yml
git commit -m "feat(cron): async mode for cron-job.org, shuffled wallets, and a failing workflow on errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Multicall batching and a display-only RPC fallback

**Files:**
- Modify: `src/lib/chain/clients.ts` (`createCeloPublicClient`; add `createCeloDisplayClient`)
- Modify: `src/lib/config/server.ts` (add `CELO_RPC_FALLBACK_URL`)
- Modify: `src/lib/config/config.test.ts` (default value)
- Modify: `src/lib/treasury/live.ts` (add `readDisplayBalances`)
- Modify: `src/lib/treasury/view.ts:63`, `src/app/app/rules/page.tsx:67`, `src/app/app/withdraw/page.tsx:37` (screens use `readDisplayBalances`)
- Test: `src/lib/treasury/balances.test.ts`

**Interfaces:**
- Produces:
  - `createCeloPublicClient(rpcUrl: string, transport?: Transport)`: same signature, now with `batch: { multicall: true }`.
  - `createCeloDisplayClient(rpcUrls: readonly string[], transport?: Transport)`.
  - `readDisplayBalances(owner: Address): Promise<TreasuryBalances>` in `@/lib/treasury/live`.
  - `ServerEnv.CELO_RPC_FALLBACK_URL: string` (default `https://celo.drpc.org`).

- [ ] **Step 1: Write the failing tests** (append to `src/lib/treasury/balances.test.ts`)

```ts
import { custom, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, multicall3Abi, type Hex } from "viem";
import { celo } from "viem/chains";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { erc20Balance, TREASURY_TOKENS } from "./balances";

/** A fake node that answers Multicall3 aggregate3; `fail` makes that call index unsuccessful. */
function multicallNode(fail?: number) {
  const calls: { to: Hex; data: Hex }[] = [];
  const transport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return "0xa4ec";
      if (method !== "eth_call") throw new Error(`unexpected RPC ${method}`);
      const [tx] = params as [{ to: Hex; data: Hex }];
      calls.push(tx);
      const decoded = decodeFunctionData({ abi: multicall3Abi, data: tx.data });
      const inner = (decoded.args as readonly [readonly unknown[]])[0];
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: inner.map((_, i) => ({
          success: i !== fail,
          returnData: i === fail ? "0x" : encodeAbiParameters([{ type: "uint256" }], [BigInt(i + 1)]),
        })),
      });
    },
  });
  return { transport, calls };
}

describe("readTreasuryBalances over the Celo client", () => {
  it("reads all five balances in one Multicall3 eth_call", async () => {
    const node = multicallNode();
    const balances = await readTreasuryBalances(erc20Balance(createCeloPublicClient("https://unused.invalid", node.transport)), OWNER);
    expect(node.calls).toHaveLength(1);
    expect(getAddress(node.calls[0].to)).toBe(getAddress(celo.contracts.multicall3.address));
    expect(TREASURY_TOKENS.map((symbol) => balances[symbol])).toEqual([1n, 2n, 3n, 4n, 5n]);
  });

  it("rejects when one token's balanceOf fails, instead of reporting zero", async () => {
    const node = multicallNode(2);
    await expect(readTreasuryBalances(erc20Balance(createCeloPublicClient("https://unused.invalid", node.transport)), OWNER)).rejects.toThrow();
  });
});
```

Merge the new imports into the file's existing import lines. `readTreasuryBalances` and `OWNER` are already defined there.

Append to the `parseServerEnv` "applies defaults" test in `src/lib/config/config.test.ts`:

```ts
    expect(env.CELO_RPC_FALLBACK_URL).toBe("https://celo.drpc.org");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/treasury/balances.test.ts src/lib/config/config.test.ts`
Expected: FAIL. The node sees five `eth_call`s, each to a token address (the "unexpected" decode throws or the count is 5), and `CELO_RPC_FALLBACK_URL` is undefined.

- [ ] **Step 3: Implement**

`src/lib/chain/clients.ts`: add `fallback` to the viem import, then replace `createCeloPublicClient`:

```ts
/** Reads made in the same tick are batched into one Multicall3 call (a treasury's 5 balanceOf → 1 eth_call). */
export function createCeloPublicClient(rpcUrl: string, transport?: Transport) {
  return createPublicClient({ chain: celo, batch: { multicall: true }, transport: transport ?? http(rpcUrl) });
}

/**
 * For screens only (dashboard, rules preview, withdraw page): moves to the next RPC when one fails.
 * Never use it on a money path. A lagging fallback node can show a stale balance or allowance, and a
 * swap or withdrawal built on it reverts.
 */
export function createCeloDisplayClient(rpcUrls: readonly string[], transport?: Transport) {
  return createPublicClient({
    chain: celo,
    batch: { multicall: true },
    transport: transport ?? fallback(rpcUrls.map((url) => http(url))),
  });
}
```

`src/lib/config/server.ts`: add after `CELO_RPC_URL`:

```ts
  /** Second RPC for screens only (createCeloDisplayClient); money paths use CELO_RPC_URL alone. */
  CELO_RPC_FALLBACK_URL: z.preprocess(emptyToUndefined, z.url().default("https://celo.drpc.org")),
```

`src/lib/treasury/live.ts`:
- Change the clients import to `import { createCeloDisplayClient, createCeloPublicClient } from "@/lib/chain/clients";`.
- Add `type ReadBalance` and `type TreasuryBalances` to the `./balances` import.
- Add `import type { Address } from "viem";` (the file already imports from viem, so merge it there).
- Append:

```ts
let display: ReadBalance | undefined;

/**
 * Balances for screens (dashboard, rules preview, withdraw page), with the fallback RPC. Money paths
 * (executor, withdrawal action) use liveExecutorDeps().chain.readBalances, which reads the primary RPC only.
 */
export function readDisplayBalances(owner: Address): Promise<TreasuryBalances> {
  if (!display) {
    const env = parseServerEnv();
    display = erc20Balance(createCeloDisplayClient([env.CELO_RPC_URL, env.CELO_RPC_FALLBACK_URL]));
  }
  return readTreasuryBalances(display, owner);
}
```

Screens:
- `src/lib/treasury/view.ts`: replace `liveExecutorDeps().chain.readBalances(user.treasuryAddress)` with `readDisplayBalances(user.treasuryAddress)`, and change the import to `import { readDisplayBalances } from "./live";`.
- `src/app/app/rules/page.tsx` (Preview): replace `liveExecutorDeps().chain.readBalances(user.treasuryAddress)` with `readDisplayBalances(user.treasuryAddress)`, and change the import to `import { readDisplayBalances } from "@/lib/treasury/live";`.
- `src/app/app/withdraw/page.tsx`: same replacement and import. Leave `src/app/app/withdraw/actions.ts` alone; the action validates against the primary RPC.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/treasury/balances.test.ts src/lib/config/config.test.ts src/lib/chain && npm run typecheck`
Expected: PASS, typecheck exit 0. The existing operator-client tests in `clients.test.ts` still pass, because batching only affects `readContract`.

- [ ] **Step 5: Check one real read against mainnet (read-only, by hand)**

```bash
npx tsx -e '
import { createCeloDisplayClient, createCeloPublicClient } from "./src/lib/chain/clients";
import { erc20Balance, readTreasuryBalances } from "./src/lib/treasury/balances";
const owner = "0x3C9b8b64372A3dD0313358ddd4b56D2B66Ff1a97";
(async () => {
  console.log("forno+multicall", await readTreasuryBalances(erc20Balance(createCeloPublicClient("https://forno.celo.org")), owner));
  console.log("display(drpc only)", await readTreasuryBalances(erc20Balance(createCeloDisplayClient(["https://celo.drpc.org"])), owner));
})();'
```

Expected: both lines print the same balances. On 2026-10-16 that was USDT 42618n and WARS 1718483410796304315978n, unless they have changed since.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chain/clients.ts src/lib/config/server.ts src/lib/config/config.test.ts src/lib/treasury/live.ts src/lib/treasury/balances.test.ts src/lib/treasury/view.ts src/app/app/rules/page.tsx src/app/app/withdraw/page.tsx
git commit -m "feat(chain): batch reads through Multicall3; screens fall back to a second RPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One read per request for the user, rules and open proposal

**Files:**
- Modify: `src/lib/auth/current-user.ts` (`getCurrentUser` wrapped in `cache`)
- Create: `src/lib/treasury/request-reads.ts`
- Modify:
  - `src/app/app/layout.tsx:26`
  - `src/app/app/page.tsx:64`
  - `src/app/app/agent-status.tsx:29-31`
  - `src/app/app/proposal-banner.tsx:14`
  - `src/app/app/rules/page.tsx:38-40`
  - `src/lib/treasury/view.ts:60`

**Interfaces:**
- Produces:
  - `getCurrentUser: () => Promise<AppUser | null>`: same type, memoised per request.
  - `getRulesRow(userId: string): Promise<RulesRow | null>` in `@/lib/treasury/request-reads`.
  - `getOpenProposal(userId: string): Promise<FxIntentRow | null>` in `@/lib/treasury/request-reads`.

React `cache()` memoises only while a Server Component tree renders. In Route Handlers, Server Actions and Vitest it calls straight through. That is why behaviour elsewhere is unchanged, and also why no unit test can observe the deduplication. The check is the query count in Step 3.

- [ ] **Step 1: Implement**

`src/lib/auth/current-user.ts`: add `import { cache } from "react";` and turn the function into:

```ts
/**
 * Reads the request's cookies: call it only inside a <Suspense> boundary, a Route Handler or a Server Action.
 * Memoised per request (React cache), so the layout, the page and its sections share one lookup.
 */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token, requireValue(parseServerEnv().SESSION_SECRET, "SESSION_SECRET"));
  if (!session) return null;
  return loadAppUser(getDb(), session.userId);
});
```

Create `src/lib/treasury/request-reads.ts`:

```ts
import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { rules, type FxIntentRow, type RulesRow } from "@/lib/db/schema";
import { openProposal } from "./repo";

/** Per-request (React cache): the dashboard's banner, agent card and treasury summary share one read. */
export const getRulesRow = cache(async (userId: string): Promise<RulesRow | null> => {
  const [row] = await getDb().select().from(rules).where(eq(rules.userId, userId));
  return row ?? null;
});

/** Per-request (React cache): the nav dot, the dashboard and the agent card share one read. */
export const getOpenProposal = cache((userId: string): Promise<FxIntentRow | null> => openProposal(getDb(), userId));
```

Call sites (drop each import that becomes unused: `eq`, `rules`, `openProposal`, `getDb`):
- `src/app/app/layout.tsx`: `hasProposal = user ? (await getOpenProposal(user.id)) !== null : false;`
- `src/app/app/page.tsx`: `const [invoices, rates, proposal] = await Promise.all([listInvoices(db, user.id), getReferenceRatesOrNull(), getOpenProposal(user.id)]);`
- `src/app/app/agent-status.tsx`:

```ts
  const row = await getRulesRow(user.id);
  if (!row) return null;
  const [[last], rates, proposal] = await Promise.all([listEvents(db, user.id, 1), getReferenceRatesOrNull(), getOpenProposal(user.id)]);
```

- `src/app/app/proposal-banner.tsx`:

```ts
  const [row, rates] = await Promise.all([getRulesRow(user.id), getReferenceRatesOrNull()]);
  if (!row) return null;
```

  (The `db` constant there becomes unused; remove it.)
- `src/app/app/rules/page.tsx` (`Rules`):

```ts
  const row = await getRulesRow(user.id);
  if (!row) redirect("/app/onboarding");
  const proposal = await getOpenProposal(user.id);
```

- `src/lib/treasury/view.ts` (`loadTreasuryView`):

```ts
  const row = await getRulesRow(user.id);
  if (!row) return null;
```

  Import it with `import { getRulesRow } from "./request-reads";`.

- [ ] **Step 2: Typecheck, lint and run all tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: exit 0, all tests pass.

- [ ] **Step 3: Count the dashboard's queries on localhost (by hand)**

Temporarily pass `logger: true` to `drizzle(...)` in `src/lib/db/client.ts`. Run `npm run dev`, sign in, and load `/app` once.

Count the logged `select` statements on `"users"` (expected 1), `"rules"` (expected 1, the user join aside) and `"fx_intents" … "proposed"` (expected 1). Before this task the counts were 2, 3 and 3. Then revert `client.ts`; `git diff src/lib/db/client.ts` must be empty.

If the user cannot sign in for this check, record "not observed" in the ledger and rely on the React docs.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/current-user.ts src/lib/treasury/request-reads.ts src/app/app/layout.tsx src/app/app/page.tsx src/app/app/agent-status.tsx src/app/app/proposal-banner.tsx src/app/app/rules/page.tsx src/lib/treasury/view.ts
git commit -m "perf(app): read the user, rules and open proposal once per request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Spec and the full gate

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-cobro-design.md` (§7.1 Scheduler row, §10.4 intro, §12 table)

- [ ] **Step 1: Update the spec**

§7.1, replace the Scheduler row with:

```markdown
| Scheduler | cron-job.org (free) calls `POST /api/cron/treasury?mode=async` every 5 minutes with a bearer secret; the route answers 202 and runs the tick in `after()` (cron-job.org waits 30 s at most). GitHub Actions calls the same route without `mode` as the backup trigger and the alert: it runs inline and the workflow fails, emailing the owner, when the tick reports errors. GitHub delays its scheduled runs to every 2–5 hours (measured 2026-10-13 to 10-15). A payment also runs the agent at once through `after()` |
```

§10.4, replace the sentence "The cron route first issues due recurring invoices (§9.1), then runs these steps for each user with rules enabled:" with:

```markdown
The cron route first issues due recurring invoices (§9.1) and reconciles settlements and pending
transactions, then runs these steps for each user with rules enabled, in random order and at most
three wallets at once (below Textile's four outstanding RFQs); no new wallet starts after 180 s:
```

§12, add rows after "Unknown x402 settlement outcome":

```markdown
| Primary RPC (forno) failing | Screens read balances through a second free RPC (`CELO_RPC_FALLBACK_URL`, default dRPC); money paths wait for the primary, so nothing is signed from a lagging node |
| A cron tick reports errors | The tick logs `CRON TICK HAD ERRORS`; the GitHub workflow's run fails and GitHub emails the owner; cron-job.org emails on a failed call |
```

- [ ] **Step 2: Full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green; `git status --short` shows only the user's `.env.example`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-08-cobro-design.md
git commit -m "docs: scheduler, cron fan-out and RPC fallback in the spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ship and switch the trigger (with the user)

This task changes production. Ask before each step marked **(ask)**.

- [ ] **Step 1 (ask): Merge, gate, push**

```bash
git checkout main && git merge --no-ff plan-3b-infra -m "Merge branch 'plan-3b-infra': cron-job.org trigger, fair cron fan-out, multicall, request-scoped reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm test && npm run typecheck && npm run lint && npm run build
git push origin main
```

Wait until the newest Production deployment in `vercel ls cobro-agent` is `Ready`. Then probe:
- `POST /api/cron/treasury` without auth → 401.
- `POST /api/cron/treasury?mode=async` without auth → 401.
- `gh workflow run treasury-cron.yml`, then `gh run watch <id> --exit-status` → exit 0. The log shows `"ok":true`.

- [ ] **Step 2 (ask): A cron secret the user can paste**

Vercel stores `CRON_SECRET` as a hidden secret, so it cannot be read back. Rotate it so the user can paste the new value into cron-job.org; the value never prints. The user runs:

```
! S=$(openssl rand -hex 32) && printf %s "$S" | gh secret set CRON_SECRET && vercel env rm CRON_SECRET production --yes && printf %s "$S" | vercel env add CRON_SECRET production --sensitive --yes && printf %s "$S" | pbcopy && unset S
```

Then redeploy the latest production deployment (`vercel redeploy <url>`) and wait for `Ready`. Re-run `gh workflow run treasury-cron.yml`; it must exit 0, which shows GitHub and Vercel share the new secret.

- [ ] **Step 3 (user): Create the cron-job.org job**

At https://console.cron-job.org (free sign-up with the user's email):
- **URL:** `https://cobro-agent.vercel.app/api/cron/treasury?mode=async`
- **Schedule:** every 5 minutes.
- **Advanced → Request method:** `POST`.
- **Advanced → Headers:** `Authorization` = `Bearer ` followed by the clipboard value from Step 2.
- **Notifications:** on failure on; "after N failures" = 1.
- **Save**, then "Test run". Expect HTTP **202** and body `{"accepted":true}`.

- [ ] **Step 4: Verify the trigger runs the agent**

Two cron-job.org runs later, check:
- The cron-job.org history shows 202s.
- `vercel logs cobro-agent.vercel.app` (or the dashboard's Logs tab) shows `Cron tick: {…}` lines about 5 minutes apart, with no `CRON TICK FAILED`.

- [ ] **Step 5: Record**

Append the outcome lines to `.superpowers/sdd/2026-10-16-plan-3b-infra/progress.md`, and update the auto-memory note on Plan 3 status.
