import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Priority: APP_DATABASE_URL (manually set, clean) > POSTGRES_URL > DATABASE_URL.
// APP_DATABASE_URL lets us override the Neon-managed DATABASE_URL (which carries
// channel_binding=require and can fail on Vercel's serverless runtime).
const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  "postgres://placeholder:placeholder@localhost:5432/placeholder";

const globalForDb = globalThis as unknown as { _pg?: ReturnType<typeof postgres> };
const client = globalForDb._pg ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb._pg = client;

export const db = drizzle(client, { schema });
export { schema };

