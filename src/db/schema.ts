import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 24 }).notNull(),
    email: varchar("email", { length: 255 }),
    passwordHash: text("password_hash"),
    isGuest: boolean("is_guest").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    check("users_username_len", sql`char_length(${t.username}) >= 2`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const playerProfiles = pgTable("player_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 24 }).notNull(),
  avatarUrl: text("avatar_url"),
  favouritePosition: varchar("favourite_position", { length: 8 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playerCosmetics = pgTable("player_cosmetics", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  gender: varchar("gender", { length: 1 }).notNull().default("m"),
  hair: integer("hair").notNull().default(0),
  hairColor: integer("hair_color").notNull().default(0),
  skin: integer("skin").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playerSettings = pgTable("player_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("friend_pair_idx").on(t.requesterId, t.addresseeId),
    index("friend_addressee_idx").on(t.addresseeId),
    check("friend_not_self", sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

export const playerStatistics = pgTable(
  "player_statistics",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    matches: integer("matches").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    goals: integer("goals").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    tackles: integer("tackles").notNull().default(0),
    playtimeSeconds: integer("playtime_seconds").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("stats_non_negative", sql`${t.matches} >= 0 and ${t.goals} >= 0`)],
);

export const matchHistory = pgTable(
  "match_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomCode: varchar("room_code", { length: 8 }).notNull(),
    mode: varchar("mode", { length: 16 }).notNull(),
    stadium: varchar("stadium", { length: 24 }).notNull(),
    teamAName: varchar("team_a_name", { length: 24 }).notNull(),
    teamBName: varchar("team_b_name", { length: 24 }).notNull(),
    scoreA: integer("score_a").notNull(),
    scoreB: integer("score_b").notNull(),
    possessionA: integer("possession_a").notNull().default(50),
    durationSeconds: integer("duration_seconds").notNull(),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("match_played_idx").on(t.playedAt), check("score_non_negative", sql`${t.scoreA} >= 0 and ${t.scoreB} >= 0`)],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id").notNull().references(() => matchHistory.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    displayName: varchar("display_name", { length: 24 }).notNull(),
    team: integer("team").notNull(),
    position: varchar("position", { length: 8 }).notNull(),
    goals: integer("goals").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    tackles: integer("tackles").notNull().default(0),
    passes: integer("passes").notNull().default(0),
    passesCompleted: integer("passes_completed").notNull().default(0),
    yellowCards: integer("yellow_cards").notNull().default(0),
    redCard: boolean("red_card").notNull().default(false),
  },
  (t) => [index("mp_match_idx").on(t.matchId), index("mp_user_idx").on(t.userId), check("mp_team", sql`${t.team} in (0, 1)`)],
);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 24 }).notNull(),
  primaryColor: varchar("primary_color", { length: 9 }).notNull().default("#e63946"),
  secondaryColor: varchar("secondary_color", { length: 9 }).notNull().default("#ffffff"),
  pattern: varchar("pattern", { length: 8 }).notNull().default("solid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tournamentRecords = pgTable(
  "tournament_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 48 }).notNull(),
    placement: integer("placement"),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tr_user_idx").on(t.userId)],
);

export { primaryKey };
