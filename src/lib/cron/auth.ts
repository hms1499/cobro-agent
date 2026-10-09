import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time check of `Authorization: Bearer <secret>`; hashing first makes the lengths equal. */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
