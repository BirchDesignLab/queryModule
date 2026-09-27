import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const ms = () => integer({ mode: "timestamp_ms" });

// Better Auth tables (spec 5.5), owned by Better Auth, extended with spec columns
export const user = sqliteTable(
  "user",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: integer({ mode: "boolean" }).notNull().default(false),
    image: text(),
    createdAt: ms().notNull(),
    updatedAt: ms().notNull(),
    role: text({ enum: ["user", "trainingOfficer", "admin"] })
      .notNull()
      .default("user"),
    disabledAt: integer(),
    identitySource: text({ enum: ["local", "host"] })
      .notNull()
      .default("local"),
    hostIssuer: text(),
    hostSubject: text(),
  },
  (t) => [uniqueIndex("user_host_identity_uq").on(t.hostIssuer, t.hostSubject)],
);

export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: ms().notNull(),
    token: text().notNull().unique(),
    createdAt: ms().notNull(),
    updatedAt: ms().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stepUpAt: integer(),
    hostTokenExp: integer(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable("account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: ms(),
  refreshTokenExpiresAt: ms(),
  scope: text(),
  password: text(),
  createdAt: ms().notNull(),
  updatedAt: ms().notNull(),
});

export const verification = sqliteTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: ms().notNull(),
  createdAt: ms(),
  updatedAt: ms(),
});

export const authSchema = { user, session, account, verification };

// audit_event: append-only; triggers in 0001_audit_triggers.sql (spec 5.5)
export const auditEvent = sqliteTable(
  "audit_event",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    type: text().notNull(),
    at: integer().notNull(),
    correlationId: text(),
    partId: integer(),
    actorUserId: text().notNull(),
    actorEmail: text(),
    actorRole: text().notNull(),
    credentialUserId: text(),
    identitySource: text({ enum: ["local", "host", "system"] }).notNull(),
    hostSubject: text(),
    details: text({ mode: "json" }).notNull(),
  },
  (t) => [
    index("audit_event_at_idx").on(t.at),
    index("audit_event_actor_at_idx").on(t.actorUserId, t.at),
    index("audit_event_credential_at_idx").on(t.credentialUserId, t.at),
    index("audit_event_correlation_idx").on(t.correlationId),
    index("audit_event_type_at_idx").on(t.type, t.at),
  ],
);

export const keyCanary = sqliteTable("key_canary", {
  keyName: text({ enum: ["credential", "data"] }).primaryKey(),
  ciphertext: blob({ mode: "buffer" }).notNull(),
  iv: blob({ mode: "buffer" }).notNull(),
  authTag: blob({ mode: "buffer" }).notNull(),
  keyVersion: integer().notNull(),
  createdAt: integer().notNull(),
});

export const rateLimit = sqliteTable("rate_limit", {
  key: text().primaryKey(),
  windowStart: integer().notNull(),
  count: integer().notNull(),
  lockedUntil: integer(),
});

// user_preference: not audited (spec 5.5); Task 36 mounts its route
export const userPreference = sqliteTable("user_preference", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  themeMode: text({ enum: ["day", "night", "redShift", "auto"] }),
  personaOverride: text(),
  layout: text({ mode: "json" }),
  updatedAt: ms().notNull(),
});
