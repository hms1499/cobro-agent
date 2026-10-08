import { defineConfig } from "drizzle-kit";

// `generate` needs no database; `npm run db:migrate` applies the files with scripts/db-migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
