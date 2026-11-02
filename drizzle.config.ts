import type { Config } from "drizzle-kit";
export default {
  schema: ["./src/db/schema.ts", "./src/db/project-import-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.POSTGRES_URL || process.env.DATABASE_URL || "" },
} satisfies Config;

