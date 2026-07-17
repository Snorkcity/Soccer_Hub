import { boolean, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { practicesTable } from "./practices";

/**
 * Session planning (slice 2): a training session assembled from library
 * practices. One row per session; one session_practices row per part slot.
 */
export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default(""),
  sessionDate: text("session_date"), // e.g. "9.07.2026" — coach's format, free text
  team: text("team"),
  sessionNumber: text("session_number"), // e.g. "S30"
  theme: text("theme"),
  cycleCode: text("cycle_code"), // e.g. "4-11-S3"
  location: text("location"),
  timeSlot: text("time_slot"), // e.g. "5.30-7.00pm"
  comments: text("comments"),
  /** One player per line: "1 | GK | Matilde | Ankle" (num | pos | name | note) */
  squadText: text("squad_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const SESSION_PARTS = ["warmup", "activation", "introduction", "main", "endgame"] as const;
export type SessionPart = (typeof SESSION_PARTS)[number];

export const sessionPracticesTable = pgTable(
  "session_practices",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    part: text("part").notNull(), // one of SESSION_PARTS
    practiceId: integer("practice_id").references(() => practicesTable.id, { onDelete: "set null" }),
    rules: text("rules"),
    tasks: text("tasks"), // "Coaching messages" / "Tasks" column
    progressions: text("progressions"),
    coachingPoints: text("coaching_points"),
    players: text("players"),
    size: text("size"),
    timing: text("timing"),
    scoring: text("scoring"),
    intensity: text("intensity"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("session_practices_session_part_uq").on(t.sessionId, t.part)],
);
