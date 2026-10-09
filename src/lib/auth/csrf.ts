/**
 * Route Handlers get no CSRF protection from Next (only Server Actions do). A cross-site form can
 * post `text/plain` that still parses as JSON, so require `application/json`, which a cross-origin
 * page can only send after a CORS preflight we never answer, and refuse what the browser marks as
 * coming from another site.
 */
export function isTrustedJsonPost(request: Request): boolean {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return false;
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
