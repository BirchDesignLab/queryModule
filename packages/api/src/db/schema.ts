import { sql } from "drizzle-orm";
import {
  blob,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  defaultView: text(),
  locale: text(),
  updatedAt: ms().notNull(),
});

// query_request: insert-once, one row per plan part; trigger in 0004_query_triggers.sql (spec 5.5)
export const queryRequest = sqliteTable(
  "query_request",
  {
    correlationId: text().notNull(),
    partId: integer().notNull(),
    userId: text().notNull(),
    parentPartId: integer(),
    origin: text({ enum: ["primary", "alsoRun"] }).notNull(),
    queryType: text().notNull(),
    typeValues: text({ mode: "json" }).notNull(),
    // null for a skipped part (no values persisted); sealed under the request's values DEK
    valuesCiphertext: blob({ mode: "buffer" }),
    valuesIv: blob({ mode: "buffer" }),
    valuesTag: blob({ mode: "buffer" }),
    plateOnly: integer().notNull(),
    selectedSourceIds: text({ mode: "json" }).notNull(),
    droppedSourceIds: text({ mode: "json" }).notNull(),
    // AuditValidationError[] for a skipped part
    skippedReason: text({ mode: "json" }),
    configHash: text().notNull(),
    // part 0 only
    idempotencyKey: text(),
    submittedAt: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.correlationId, t.partId] }),
    uniqueIndex("query_request_idempotency_idx")
      .on(t.userId, t.idempotencyKey)
      .where(sql`part_id = 0`),
    index("query_request_user_submitted_idx").on(t.userId, t.submittedAt),
  ],
);

// source_result: status is write-once from pending and rows are never deleted (0004, FR-063)
export const sourceResult = sqliteTable(
  "source_result",
  {
    resultId: text().primaryKey(),
    correlationId: text().notNull(),
    partId: integer().notNull(),
    sourceId: text().notNull(),
    userId: text().notNull(),
    status: text({
      enum: [
        "pending",
        "returned",
        "failed",
        "timedOut",
        "credentialsMissing",
        "credentialsRejected",
        "interrupted",
      ],
    }).notNull(),
    credentialUserId: text(),
    delegationId: text(),
    adapterKind: text().notNull(),
    // sealed under the request's payload DEK
    payloadCiphertext: blob({ mode: "buffer" }),
    payloadIv: blob({ mode: "buffer" }),
    payloadTag: blob({ mode: "buffer" }),
    errorCode: text(),
    createdAt: integer().notNull(),
    receivedAt: integer(),
    timedOutAt: integer(),
  },
  (t) => [
    uniqueIndex("source_result_part_source_idx").on(t.correlationId, t.partId, t.sourceId),
    foreignKey({
      columns: [t.correlationId, t.partId],
      foreignColumns: [queryRequest.correlationId, queryRequest.partId],
    }),
    index("source_result_user_created_idx").on(t.userId, t.createdAt),
    index("source_result_credential_created_idx").on(t.credentialUserId, t.createdAt),
    index("source_result_status_idx").on(t.status),
    // spec 5.5 status enum, so an out-of-enum status cannot pass the write-once trigger as terminal
    check(
      "source_result_status_check",
      sql`${t.status} IN ('pending', 'returned', 'failed', 'timedOut', 'credentialsMissing', 'credentialsRejected', 'interrupted')`,
    ),
  ],
);

// request_key: one DEK per (request, scope) wrapped under DATA_KEY (SEC-006). No trigger:
// lost-data-key.ts and purge.ts (M3) crypto-shred by deleting rows. The scope CHECK matches
// REQUEST_KEY_SCOPES and the scopes lost-key.ts audits.
export const requestKey = sqliteTable(
  "request_key",
  {
    correlationId: text().notNull(),
    scope: text({ enum: ["values", "payload"] }).notNull(),
    wrappedDek: blob({ mode: "buffer" }).notNull(),
    iv: blob({ mode: "buffer" }).notNull(),
    authTag: blob({ mode: "buffer" }).notNull(),
    keyVersion: integer().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.correlationId, t.scope] }),
    check("request_key_scope_check", sql`${t.scope} IN ('values', 'payload')`),
  ],
);
