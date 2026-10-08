import { paraJwks, verifyParaJwt } from "@/lib/auth/para-jwt";
import { parseServerEnv } from "@/lib/config/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") {
    return Response.json({ error: "token is required" }, { status: 400 });
  }
  try {
    const session = await verifyParaJwt(body.token, paraJwks(parseServerEnv().PARA_JWKS_URL));
    return Response.json({ session });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid token" }, { status: 401 });
  }
}
