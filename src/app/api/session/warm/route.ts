import { sql } from "drizzle-orm";
import { warmSignIn } from "@/lib/auth/warm";
import { getDb } from "@/lib/db/client";
import { paraSessionKeys } from "@/lib/users/para";

/** POST from /signin on open; never blocks sign-in (src/lib/auth/warm.ts). POST so crawlers and link prefetch skip it. */
export async function POST() {
  await warmSignIn({ pingDb: () => getDb().execute(sql`select 1`), reloadKeys: () => paraSessionKeys().reload() });
  return new Response(null, { status: 204 });
}
