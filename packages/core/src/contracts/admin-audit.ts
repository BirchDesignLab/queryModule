import { z } from "zod";
import { BoundedIdSchema, EpochMsSchema, Uuid7Schema } from "./primitives";

/**
 * Admin audit read routes (spec 5.1; SEC-012). Contract only until the handlers mount.
 * Stored rows written before M2 lack later fields, so responses use a tolerant read schema
 * (a strict response parse would 500 on an old row). Details hold identifiers and metadata
 * only, never query values or payloads (spec 5.5).
 */
const DAY_MS = 86_400_000;
export const MAX_AUDIT_WINDOW_DAYS = 31;
export const MAX_AUDIT_WINDOW_MS = MAX_AUDIT_WINDOW_DAYS * DAY_MS;
export const AUDIT_PAGE_MAX_LIMIT = 200;

const epochParam = z.coerce.number().int().min(0).pipe(EpochMsSchema);

const filterShape = {
  /** Matches the actor OR the credential owner (spec 5.1). */
  user: BoundedIdSchema.optional(),
  correlationId: Uuid7Schema.optional(),
  /** Free string, not the closed enum: a type added later must still be filterable. */
  type: BoundedIdSchema.optional(),
  /** Required window, inclusive epoch ms, at most 31 days. */
  from: epochParam,
  to: epochParam,
};

type Window = { from: number; to: number };
const windowOk = (q: Window) => q.to >= q.from && q.to - q.from <= MAX_AUDIT_WINDOW_MS;
const WINDOW_MESSAGE = `window must satisfy from <= to and span at most ${MAX_AUDIT_WINDOW_DAYS} days`;

export const AdminAuditExportQuerySchema = z
  .strictObject(filterShape)
  .refine(windowOk, { message: WINDOW_MESSAGE });

export const AdminAuditQuerySchema = z
  .strictObject({
    ...filterShape,
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX_LIMIT).optional(),
  })
  .refine(windowOk, { message: WINDOW_MESSAGE });

/**
 * One stored audit row as read back. Loose on purpose: `type` is any string (types added
 * later), details an object, unknown keys stripped, later-added optional fields absent.
 */
export const AuditReadRowSchema = z.object({
  id: z.int().min(1),
  type: z.string().min(1).max(64),
  at: EpochMsSchema,
  correlationId: Uuid7Schema.optional(),
  partId: z.int().min(0).optional(),
  actor: z.object({
    id: BoundedIdSchema,
    email: z.string().max(254).nullable(),
    role: z.string().min(1).max(32),
  }),
  credentialUserId: BoundedIdSchema.optional(),
  identitySource: z.string().min(1).max(16),
  hostSubject: z.string().max(255).optional(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditReadRow = z.infer<typeof AuditReadRowSchema>;

export const AdminAuditPageSchema = z.strictObject({
  events: z.array(AuditReadRowSchema).max(AUDIT_PAGE_MAX_LIMIT),
  nextCursor: z.string().min(1).max(256).nullable(),
});
export type AdminAuditPage = z.infer<typeof AdminAuditPageSchema>;

/** One NDJSON line of GET /admin/audit/export; the route has no JSON body schema. */
export const AuditExportLineSchema = AuditReadRowSchema;
