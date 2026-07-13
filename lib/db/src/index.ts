import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Outside production, prefer DEV_DATABASE_URL when set (e.g. a Railway-hosted
// dev database on Replit, where DATABASE_URL is reserved/runtime-managed by the
// platform). In production, always use DATABASE_URL so a stray DEV_DATABASE_URL
// can never point the prod app at the dev database.
const connectionString =
  process.env.NODE_ENV === "production"
    ? process.env.DATABASE_URL
    : process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or DEV_DATABASE_URL) must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
