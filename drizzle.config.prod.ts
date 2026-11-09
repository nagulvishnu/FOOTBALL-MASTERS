import { defineConfig } from "drizzle-kit";

// Production / Neon config: reads the connection string from the environment (never hardcoded).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
