import { defineConfig } from "drizzle-kit";

// Migrations are generated here and applied explicitly with `wrangler d1 migrations apply`.
// Never push schema changes automatically in production.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
