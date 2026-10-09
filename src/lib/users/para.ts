import type { JWTVerifyGetKey } from "jose";
import { paraJwks } from "@/lib/auth/para-jwt";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { ParaRestClient } from "@/lib/signer/para-rest";

let keys: JWTVerifyGetKey | undefined;

/** Cached per instance so Para's JWKS is fetched once, not on every sign-in. */
export function paraSessionKeys(): JWTVerifyGetKey {
  keys ??= paraJwks(parseServerEnv().PARA_JWKS_URL);
  return keys;
}

export function paraRestClient(): ParaRestClient {
  const env = parseServerEnv();
  return new ParaRestClient({ apiKey: requireValue(env.PARA_API_KEY, "PARA_API_KEY"), baseUrl: env.PARA_REST_BASE_URL });
}
