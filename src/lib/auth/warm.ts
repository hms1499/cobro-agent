/**
 * Called when /signin opens: the freelancer then spends tens of seconds on their email and code, long
 * enough for an asleep Neon compute (Free plan: suspends after 5 idle minutes) to wake and for Para's
 * JWKS to be cached, so neither delay lands on the step after the code.
 */
export async function warmSignIn(deps: {
  pingDb: () => Promise<unknown>;
  reloadKeys: () => Promise<unknown>;
}): Promise<{ db: "ok" | "error"; keys: "ok" | "error" }> {
  const [db, keys] = await Promise.allSettled([deps.pingDb(), deps.reloadKeys()]);
  if (db.status === "rejected") console.error("Sign-in warm-up: database ping failed:", db.reason);
  if (keys.status === "rejected") console.error("Sign-in warm-up: Para keys failed:", keys.reason);
  return { db: db.status === "fulfilled" ? "ok" : "error", keys: keys.status === "fulfilled" ? "ok" : "error" };
}
