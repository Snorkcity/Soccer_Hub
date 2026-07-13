import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Prefer DEV_DATABASE_URL when set (e.g. a Railway-hosted dev database on
// Replit, where DATABASE_URL is reserved/runtime-managed by the platform).
// Falls back to DATABASE_URL for production (Railway internal) and any other
// environment.
const connectionString =
  process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or DEV_DATABASE_URL) must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
