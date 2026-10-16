import { describe, expect, it, vi } from "vitest";
import type { ParaSession } from "./para-jwt";
import { startSession, type StartSessionDeps } from "./start-session";

const PARA: ParaSession = { paraUserId: "para-1", email: "ana@example.com", expiresAt: 4_102_444_800 };

function deps(over: Partial<StartSessionDeps> = {}) {
  const tasks: (() => Promise<void>)[] = [];
  const d: StartSessionDeps = {
    verify: vi.fn(async () => PARA),
    upsertUser: vi.fn(async () => ({ id: "user-1" })),
    provisionWallet: vi.fn(async () => undefined),
    schedule: (task) => tasks.push(task),
    signSession: vi.fn(async (userId: string) => `signed:${userId}`),
    hasCurrency: vi.fn(async () => false),
    ...over,
  };
  return { d, tasks };
}

describe("startSession", () => {
  it("refuses a body without a token and touches nothing", async () => {
    const { d, tasks } = deps();
    expect(await startSession({}, d)).toEqual({ ok: false, status: 400, error: "token_required" });
    expect(d.verify).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(0);
  });

  it("refuses a token Para does not vouch for, before creating anything", async () => {
    const { d, tasks } = deps({ verify: vi.fn(async () => Promise.reject(new Error("bad signature"))) });
    expect(await startSession({ token: "x" }, d)).toEqual({ ok: false, status: 401, error: "invalid_session" });
    expect(d.upsertUser).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(0);
  });

  it("signs the session in without waiting for the treasury wallet", async () => {
    const { d, tasks } = deps({ provisionWallet: vi.fn(() => new Promise<never>(() => {})) });
    const result = await startSession({ token: "x" }, d);
    expect(result).toEqual({ ok: true, sessionToken: "signed:user-1", next: "/app/onboarding" });
    expect(d.provisionWallet).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    void tasks[0]();
    expect(d.provisionWallet).toHaveBeenCalledWith("user-1");
  });

  it("sends a freelancer who finished onboarding straight to the app", async () => {
    const { d } = deps({ hasCurrency: vi.fn(async () => true) });
    expect(await startSession({ token: "x" }, d)).toMatchObject({ ok: true, next: "/app" });
  });

  it("logs a failed background wallet setup instead of throwing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, tasks } = deps({ provisionWallet: vi.fn(async () => Promise.reject(new Error("para down"))) });
    await startSession({ token: "x" }, d);
    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith("Treasury wallet setup failed:", "para down");
    errors.mockRestore();
  });
});
