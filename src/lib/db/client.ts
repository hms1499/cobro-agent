import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import * as schema from "./schema";

/** Driver-neutral handle: Neon in the app, PGlite in tests. Transactions are PgDatabase too. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | undefined;

export function getDb(): Db {
  if (!cached) {
    const url = requireValue(parseServerEnv().DATABASE_URL, "DATABASE_URL");
    cached = drizzle({ client: new Pool({ connectionString: url }), schema }) as unknown as Db;
  }
  return cached;
}
