import { resetSessionResponse } from "@/lib/auth/reset";

/** requireUser() sends here when the session cookie names no user. */
export function GET(request: Request) {
  return resetSessionResponse(request.url);
}
