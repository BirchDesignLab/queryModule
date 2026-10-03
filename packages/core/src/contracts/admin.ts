import { z } from "zod";
import { DiagnosticSchema } from "../config/diagnostic";
import { LOCALE_PATTERN } from "../config/schema";
import { RoleSchema } from "./identity";
import { BoundedIdSchema, EpochMsSchema, Sha256HexSchema, Uuid7Schema } from "./primitives";

/*
 * Admin console contracts (ADR-0011, Track A P3 Task 24). Every shape here carries identifiers,
 * metadata and config documents only: never a password hash, session token or query value. The
 * one-time password appears in CreateUserResponseSchema and nowhere else (ADR-0011 item 8).
 */

const JsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * ADR-0011 item 2: one version's document. siteConfig is raw SiteConfig JSON (a draft may be
 * invalid; the spec 5.8 chain validates it on validate and publish); locales is the label overlay
 * over the bundled locale files; mock is present only where ALLOW_MOCK_SOURCES is true.
 */
export const ConfigDocumentSchema = z.strictObject({
  siteConfig: JsonObjectSchema,
  locales: z.record(z.string().regex(LOCALE_PATTERN), z.record(z.string(), z.string())),
  mock: JsonObjectSchema.optional(),
});
export type ConfigDocument = z.infer<typeof ConfigDocumentSchema>;

export const CONFIG_VERSION_STATUSES = ["draft", "published", "superseded"] as const;

/** ADR-0011 item 1: a site_config_version row without its document. */
export const ConfigVersionSchema = z.strictObject({
  id: Uuid7Schema,
  version: z.int().min(1),
  status: z.enum(CONFIG_VERSION_STATUSES),
  /** Set once the version validates at publish; a draft has none. */
  configHash: Sha256HexSchema.nullable(),
  baseVersion: z.int().min(1).nullable(),
  createdBy: BoundedIdSchema,
  createdAt: EpochMsSchema,
  publishedBy: BoundedIdSchema.nullable(),
  publishedAt: EpochMsSchema.nullable(),
  rollbackOf: z.int().min(1).nullable(),
});
export type ConfigVersion = z.infer<typeof ConfigVersionSchema>;

const VersionWithDocumentSchema = ConfigVersionSchema.extend({ document: ConfigDocumentSchema });

/**
 * GET /api/v1/admin/config: the live version and the site's one shared draft (ADR-0011 item 5).
 * live is never null: an empty store seeds version 1 from the site file at startup (item 1).
 */
export const AdminConfigResponseSchema = z.strictObject({
  siteId: BoundedIdSchema,
  live: VersionWithDocumentSchema,
  draft: VersionWithDocumentSchema.nullable(),
});

/**
 * PUT /api/v1/admin/config/draft. baseVersion is the live version the draft starts from; a stale
 * base answers 409 draftConflict. A full document can pass the 32 KiB API body cap, so Task 27
 * gives this route and validate their own larger cap.
 */
export const PutDraftBodySchema = z.strictObject({
  baseVersion: z.int().min(1),
  document: ConfigDocumentSchema,
});

export const ValidateConfigBodySchema = z.strictObject({ document: ConfigDocumentSchema });
/** Spec 5.8 chain diagnostics, each at its JSON pointer (ADR-0011 item 5). */
export const ValidateConfigResponseSchema = z.strictObject({
  errors: z.array(DiagnosticSchema),
  warnings: z.array(DiagnosticSchema),
});

/**
 * A publish refused on validation answers 400 validationFailed with errors[] (each a message key
 * and its path, never a value); the builder validates first and shows the full diagnostics at
 * their controls (Task 33).
 */
export const PublishConfigBodySchema = z.strictObject({ draftVersion: z.int().min(1) });

/**
 * Rollback publishes an older document as a new version and leaves the draft as it is; its base
 * is then stale, so its next save or publish answers 409 draftConflict. Lists are capped, not
 * paged, in M1 (paging is deferred).
 */
export const ConfigVersionListSchema = z.strictObject({
  versions: z.array(ConfigVersionSchema).max(1000),
});

export const VersionParamsSchema = z.strictObject({
  version: z.coerce.number().int().min(1),
});

/** ADR-0011 item 8: a user as the admin sees it. No password, hash or token. */
export const AdminUserSchema = z.strictObject({
  id: BoundedIdSchema,
  email: z.email().max(254),
  name: z.string().min(1).max(128),
  role: RoleSchema,
  disabled: z.boolean(),
  /** A created user must change the temporary password at first sign-in. */
  mustChangePassword: z.boolean(),
  createdAt: EpochMsSchema,
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListSchema = z.strictObject({ users: z.array(AdminUserSchema).max(1000) });

/** The server generates the temporary password; an admin never chooses one. */
export const CreateUserBodySchema = z.strictObject({
  email: z.email().max(254),
  name: z.string().min(1).max(128),
  role: RoleSchema,
});

/** The only response that carries the one-time password; it is never logged or shown again. */
export const CreateUserResponseSchema = z.strictObject({
  user: AdminUserSchema,
  temporaryPassword: z.string().min(16).max(128),
});

export const SetRoleBodySchema = z.strictObject({ role: RoleSchema });

export const DisableUserResponseSchema = z.strictObject({
  user: AdminUserSchema,
  sessionsRevoked: z.int().min(0),
});

export const UserParamsSchema = z.strictObject({ id: BoundedIdSchema });

/** A session row as the admin sees it: the row id (UUIDv7), never the token (spec 5.6). */
export const AdminUserSessionSchema = z.strictObject({
  id: Uuid7Schema,
  createdAt: EpochMsSchema,
  expiresAt: EpochMsSchema,
  userAgent: z.string().max(256).nullable(),
  /** The caller's own session, so the console can mark it before a revoke. */
  current: z.boolean(),
});

export const AdminUserSessionListSchema = z.strictObject({
  sessions: z.array(AdminUserSessionSchema).max(100),
});

export const SessionParamsSchema = z.strictObject({ sessionId: Uuid7Schema });
