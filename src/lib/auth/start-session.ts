import type { ParaSession } from "./para-jwt";

export interface StartSessionDeps {
  verify(token: string): Promise<ParaSession>;
  upsertUser(session: ParaSession): Promise<{ id: string }>;
  /** Creates (or resumes) the treasury wallet; slow for a new user (Para creates it, then we wait until it is ready). */
  provisionWallet(userId: string): Promise<unknown>;
  /** Runs work after the response is sent (after() in the route). */
  schedule(task: () => Promise<void>): void;
  signSession(userId: string): Promise<string>;
  /** Whether onboarding is done (rules with a local currency exist), by Para user id so it runs alongside the upsert. */
  hasCurrency(paraUserId: string): Promise<boolean>;
}

export type StartSessionResult =
  | { ok: false; status: 400 | 401; error: "token_required" | "invalid_session" }
  | { ok: true; sessionToken: string; next: "/app" | "/app/onboarding" };

/**
 * Exchanges a Para session JWT for our session. The treasury wallet is set up after the response, so a
 * new freelancer reaches onboarding at once instead of waiting up to 30 s; the dashboard shows the
 * wallet's progress and offers "Finish setup" if it failed.
 */
export async function startSession(body: unknown, deps: StartSessionDeps): Promise<StartSessionResult> {
  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== "string") return { ok: false, status: 400, error: "token_required" };

  let session: ParaSession;
  try {
    session = await deps.verify(token);
  } catch {
    return { ok: false, status: 401, error: "invalid_session" };
  }

  // One round trip instead of two: both are keyed by the Para user id (a new user has no rules yet either way).
  const [user, onboarded] = await Promise.all([deps.upsertUser(session), deps.hasCurrency(session.paraUserId)]);
  deps.schedule(async () => {
    try {
      await deps.provisionWallet(user.id);
    } catch (error) {
      console.error("Treasury wallet setup failed:", error instanceof Error ? error.message : error);
    }
  });
  const sessionToken = await deps.signSession(user.id);
  return { ok: true, sessionToken, next: onboarded ? "/app" : "/app/onboarding" };
}
