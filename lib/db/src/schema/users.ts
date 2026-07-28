import { pgTable, serial, text, boolean, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
}, (t) => [
  uniqueIndex("users_email_unique").on(t.email),
]);

export const userLeagueAccessTable = pgTable("user_league_access", {
  id:       serial("id").primaryKey(),
  userId:   integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  role:     text("role").notNull(), // "admin" | "viewer"
}, (t) => [
  uniqueIndex("user_league_access_unique").on(t.userId, t.leagueId),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UserLeagueAccess = typeof userLeagueAccessTable.$inferSelect;
