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
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCronTick(
      deps({ reconcileSettlements: async () => Promise.reject(new Error("rpc down")), reconcileWallets: async () => Promise.reject(new Error("db")) }),
    );
    expect(result.reconciled).toBe("error");
    expect(result.pending).toBe("error");
    expect(result.treasury).toEqual({ idle: 2 });
    errors.mockRestore();
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
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    let task: (() => Promise<void>) | undefined;
    const tick = vi.fn(async () => OK);
    const response = await handleCronRequest(post("?mode=async"), { secret: SECRET, tick, schedule: (t) => (task = t) });
    expect(response.status).toBe(202);
    expect(tick).not.toHaveBeenCalled();
    await task!();
    expect(tick).toHaveBeenCalledTimes(1);
    logs.mockRestore();
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
