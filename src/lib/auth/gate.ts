/** Where to return after sign-in. Only app paths, so ?next= can never send someone off-site. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.includes("\\")) return "/app";
  if (next === "/app" || next.startsWith("/app/") || next.startsWith("/app?")) return next;
  return "/app";
}

/** Proxy check: a cookie's presence only; requireUser() verifies it inside the page. */
export function signInRedirect(pathname: string, search: string, hasSession: boolean): string | null {
  if (hasSession || !(pathname === "/app" || pathname.startsWith("/app/"))) return null;
  return `/signin?next=${encodeURIComponent(pathname + search)}`;
}
