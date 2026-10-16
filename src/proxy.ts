import { NextResponse, type NextRequest } from "next/server";
import { signedInRedirect, signInRedirect } from "@/lib/auth/gate";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { parseServerEnv } from "@/lib/config/server";

export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (pathname === "/" || pathname === "/signin") {
    // Verified, not just present: a stale or forged cookie must not bounce a visitor away from sign-in.
    const secret = parseServerEnv().SESSION_SECRET;
    const session = token && secret ? await verifySession(token, secret) : null;
    const target = session ? signedInRedirect(pathname, searchParams.get("next")) : null;
    return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
  }

  const target = signInRedirect(pathname, search, token !== undefined);
  return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
}

export const config = { matcher: ["/", "/signin", "/app", "/app/:path*"] };
