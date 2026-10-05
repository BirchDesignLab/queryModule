import { z } from "zod";
import { MAX_SOURCES_PER_SUBMIT } from "../config/validate-rules";
import {
  BoundedIdSchema,
  EpochMsSchema,
  FieldKeySchema,
  MAX_ALSO_RUN,
  ParentPartIdSchema,
  PartIdSchema,
  Sha256HexSchema,
  TypeValuesSchema,
  Uuid7Schema,
} from "./primitives";
import { SourceStatusSchema } from "./source-status";

/**
 * POST /api/v1/queries (spec 5.1, 5.2; D-A3). Idempotency-Key: 16 to 128 url-safe characters,
 * so a crypto.randomUUID() value fits (FR-064, NFR-002).
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const IdempotencyKeySchema = z.string().regex(IDEMPOTENCY_KEY_PATTERN);

/** One submitted field value; the server rebuilds FormState from these (spec 5.2 step 2). */
export const SubmitValueSchema = z.union([z.string().max(4096), z.number(), z.boolean(), z.null()]);

export const SubmitQueryRequestSchema = z.strictObject({
  queryType: BoundedIdSchema,
  values: z.record(FieldKeySchema, SubmitValueSchema),
  sourceIds: z.array(BoundedIdSchema).min(1).max(MAX_SOURCES_PER_SUBMIT),
  mode: z.enum(["normal", "plateOnly"]),
  configHash: Sha256HexSchema,
});

/** FR-040, FR-041: one entry per planned part; nested parts may be skipped (spec 4.6 step 5). */
export const SubmitQueryPartSchema = z.strictObject({
  partId: PartIdSchema,
  queryType: BoundedIdSchema,
  status: z.enum(["dispatched", "skipped"]),
  sourceIds: z.array(BoundedIdSchema),
  droppedSourceIds: z.array(BoundedIdSchema),
});

/** The acknowledgment (spec 5.2 step 3): the correlation id and the plan it acknowledged. */
export const SubmitQueryResponseSchema = z.strictObject({
  correlationId: Uuid7Schema,
  acknowledgedAt: EpochMsSchema,
  parts: z
    .array(SubmitQueryPartSchema)
    .min(1)
    .max(MAX_ALSO_RUN + 1),
});

export type SubmitQueryRequest = z.infer<typeof SubmitQueryRequestSchema>;
export type SubmitQueryResponse = z.infer<typeof SubmitQueryResponseSchema>;

/**
 * GET /api/v1/queries, GET /api/v1/queries/:correlationId and the admin read (spec 5.1, 5.5;
 * FR-062, FR-063). Contract only until P1/P2 mounts the handlers. A shredded part or result
 * answers `purged: true` with no values or payload; error codes are enums, never free text.
 */
export const QueryParamsSchema = z.strictObject({ correlationId: Uuid7Schema });

/** Cursor is opaque to the client; newest first (spec 5.1). */
export const QUERY_LIST_MAX_LIMIT = 100;
export const ListQueriesQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(QUERY_LIST_MAX_LIMIT).optional(),
});

const sourceResultBase = {
  resultId: Uuid7Schema,
  sourceId: BoundedIdSchema,
  status: SourceStatusSchema,
  adapterKind: BoundedIdSchema,
  errorCode: BoundedIdSchema.nullable(),
  createdAt: EpochMsSchema,
  receivedAt: EpochMsSchema.nullable(),
  timedOutAt: EpochMsSchema.nullable(),
  purged: z.boolean(),
};
const sourceResultShape = {
  ...sourceResultBase,
  /** Present for a `returned`, unpurged result only. */
  payload: z.record(z.string(), z.unknown()).optional(),
};
export const QuerySourceResultSchema = z.strictObject(sourceResultShape);
/** List item result: status only, no payload (payloads are detail-route only, spec 5.1). */
export const QueryListSourceResultSchema = z.strictObject(sourceResultBase);
/** Admin read with includeHidden: each result also says whether its owner hid it (FR-063). */
export const AdminQuerySourceResultSchema = z.strictObject({
  ...sourceResultShape,
  hidden: z.boolean(),
});

function partBase<S extends z.ZodType>(sources: S) {
  return {
    partId: PartIdSchema,
    parentPartId: ParentPartIdSchema.nullable(),
    origin: z.enum(["primary", "alsoRun"]),
    queryType: BoundedIdSchema,
    typeValues: TypeValuesSchema,
    plateOnly: z.boolean(),
    skippedReason: BoundedIdSchema.nullable(),
    droppedSourceIds: z.array(BoundedIdSchema),
    purged: z.boolean(),
    sources: z.array(sources).max(MAX_SOURCES_PER_SUBMIT),
  };
}

function partSchema<S extends z.ZodType>(sources: S) {
  return z.strictObject({
    ...partBase(sources),
    /** Absent when the part's values were shredded. */
    values: z.record(FieldKeySchema, SubmitValueSchema).optional(),
  });
}

function detailSchema<P extends z.ZodType>(parts: P) {
  return z.strictObject({
    correlationId: Uuid7Schema,
    submittedAt: EpochMsSchema,
    configHash: Sha256HexSchema,
    parts: z
      .array(parts)
      .min(1)
      .max(MAX_ALSO_RUN + 1),
  });
}

export const QueryPartSchema = partSchema(QuerySourceResultSchema);
export const QueryDetailSchema = detailSchema(QueryPartSchema);
/** List item part: per-source status, no decrypted values or payloads (spec 5.1). */
export const QueryListPartSchema = z.strictObject(partBase(QueryListSourceResultSchema));
export const QueryListItemSchema = detailSchema(QueryListPartSchema);
export const QueryListResponseSchema = z.strictObject({
  requests: z.array(QueryListItemSchema).max(QUERY_LIST_MAX_LIMIT),
  nextCursor: z.string().min(1).max(256).nullable(),
});

export const AdminQueryQuerySchema = z.strictObject({
  includeHidden: z.enum(["true", "false"]).optional(),
});
export const AdminQueryDetailSchema = detailSchema(partSchema(AdminQuerySourceResultSchema));

export type QueryDetail = z.infer<typeof QueryDetailSchema>;
export type QueryListResponse = z.infer<typeof QueryListResponseSchema>;
export type AdminQueryDetail = z.infer<typeof AdminQueryDetailSchema>;
