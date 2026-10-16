import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./session";

/**
 * A signed session whose user is gone (or a cookie that no longer verifies) would bounce between /app
 * and /signin, because the proxy sends signed-in visitors of /signin into the app. Clearing it ends that.
 */
export function resetSessionResponse(requestUrl: string): NextResponse {
  const response = NextResponse.redirect(new URL("/signin", requestUrl));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
