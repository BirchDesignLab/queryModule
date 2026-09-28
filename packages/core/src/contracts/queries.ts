import { z } from "zod";
import { MAX_SOURCES_PER_SUBMIT } from "../config/validate-rules";
import {
  BoundedIdSchema,
  EpochMsSchema,
  FieldKeySchema,
  MAX_ALSO_RUN,
  PartIdSchema,
  Sha256HexSchema,
  Uuid7Schema,
} from "./primitives";

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
