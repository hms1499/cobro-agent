const LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;

/** Call times per user, per server instance (best effort; a cold start resets it). */
const calls = new Map<string, number[]>();

/** True when this user may make one more Groq call now; records the call. */
export function allowGroqCall(userId: string, now: number): boolean {
  const recent = (calls.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= LIMIT) {
    calls.set(userId, recent);
    return false;
  }
  recent.push(now);
  calls.set(userId, recent);
  return true;
}
