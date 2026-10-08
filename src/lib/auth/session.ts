import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "cobro_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ISSUER = "cobro";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Our own session, issued after Para's JWT is verified once in POST /api/session. */
export async function signSession(userId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + SESSION_TTL_SECONDS)
    .sign(key(secret));
}

export async function verifySession(
  token: string,
  secret: string,
  nowSeconds?: number,
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      algorithms: ["HS256"],
      currentDate: nowSeconds === undefined ? undefined : new Date(nowSeconds * 1000),
    });
    return payload.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
