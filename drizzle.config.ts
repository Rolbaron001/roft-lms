import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Migrations run as the database owner, never as the application role.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? "",
  },
  verbose: true,
  strict: true,
});
