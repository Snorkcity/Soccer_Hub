import { pgTable, serial, text, boolean, integer, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

// Real user accounts (replaces the single shared club password).
// - Superadmins ("god access") see and manage everything, including users.
// - Everyone else gets per-league access rows: admin (can write) or viewer.
export const usersTable = pgTable("users", {
  id:           serial("id").primaryKey(),
  email:        text("email").notNull(),
  name:         text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isSuperadmin: boolean("is_superadmin").default(false).notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
  lastLoginAt:  timestamp("last_login_at"),
  // When a "possible shared login" alert email was last sent about this
  // account — persists the alert cooldown across restarts.
  sharedAlertAt: timestamp("shared_alert_at"),
}, (t) => [
  uniqueIndex("users_email_unique").on(t.email),
]);

// Per-league modules a user may use (read AND write within that league).
// "session-planner" covers the Session Planner AND Session Library;
// "assistant" is the Coach Assistant — both are paid add-ons (per coach).
export const LEAGUE_MODULES = [
  "season-stats",
  "gps",
  "testing",
  "match-prep",
  "reflections",
  "data-entry",
  "session-planner",
  "assistant",
] as const;
export type LeagueModule = (typeof LEAGUE_MODULES)[number];

export const userLeagueAccessTable = pgTable("user_league_access", {
  id:       serial("id").primaryKey(),
  userId:   integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  role:     text("role").notNull(), // legacy "admin" | "viewer" — superseded by modules
  modules:  jsonb("modules").$type<string[]>().notNull().default([]),
  // The user's own club in this league — Team/Player insights centre on it.
  // NULL = fall back to the league's default focus club (leagues.focus_club).
  club:     text("club"),
}, (t) => [
  uniqueIndex("user_league_access_unique").on(t.userId, t.leagueId),
]);

// One-time password reset tokens. We store only the sha256 hash of the token;
// the raw token exists only in the email link. Expires after 1 hour, single use.
export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt:    timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("password_reset_tokens_hash_unique").on(t.tokenHash),
]);

// Lightweight per-account activity log for spotting shared logins. One row per
// (user, device) per hour at most — written by the session middleware's
// throttled last-seen stamp. Rows older than 90 days are pruned automatically.
export const userActivityTable = pgTable("user_activity", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // sha256(userAgent + ip) prefix — cheap "same device" key for throttling/grouping
  deviceHash: text("device_hash").notNull(),
  userAgent:  text("user_agent").notNull(),
  ip:         text("ip").notNull(),
  seenAt:     timestamp("seen_at").defaultNow().notNull(),
}, (t) => [
  index("user_activity_user_seen_idx").on(t.userId, t.seenAt),
]);
export type UserActivity = typeof userActivityTable.$inferSelect;

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UserLeagueAccess = typeof userLeagueAccessTable.$inferSelect;
