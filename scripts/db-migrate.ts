import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { parseServerEnv, requireValue } from "@/lib/config/server";

async function main() {
  const pool = new Pool({ connectionString: requireValue(parseServerEnv().DATABASE_URL, "DATABASE_URL") });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("Migrations applied");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
