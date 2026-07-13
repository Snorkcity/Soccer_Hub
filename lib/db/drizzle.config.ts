import { defineConfig } from "drizzle-kit";
import path from "path";

// Outside production, prefer DEV_DATABASE_URL when set (e.g. a Railway-hosted
// dev database on Replit, where DATABASE_URL is reserved/runtime-managed). In
// production, always use DATABASE_URL.
const connectionString =
  process.env.NODE_ENV === "production"
    ? process.env.DATABASE_URL
    : process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or DEV_DATABASE_URL), ensure the database is provisioned",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
