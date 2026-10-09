import { NextResponse, type NextRequest } from "next/server";
import { signInRedirect } from "@/lib/auth/gate";
import { SESSION_COOKIE } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const target = signInRedirect(request.nextUrl.pathname, request.nextUrl.search, request.cookies.has(SESSION_COOKIE));
  return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
}

export const config = { matcher: ["/app", "/app/:path*"] };
