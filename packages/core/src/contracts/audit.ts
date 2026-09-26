import { z } from "zod";
import { IdentitySourceSchema, RoleSchema } from "./identity";
import { AdapterErrorCodeSchema } from "./source-status";

const Id = z.string().min(1);
const PartId = z.int().min(0);
const EpochMs = z.int().min(0);
const DurationMs = z.number().min(0);
/** role:"type" field values only (spec 4.1 Type fields). */
const TypeValues = z.record(z.string(), z.string());

/** ValidationError restricted for audit: params limited to field keys, label keys and positions. */
export const AuditValidationErrorSchema = z.strictObject({
  key: z.string().min(1),
  params: z
    .strictObject({
      field: z.string().min(1).optional(),
      labelKey: z.string().min(1).optional(),
      position: z.int().min(0).optional(),
    })
    .optional(),
});

export const AUDIT_EVENT_TYPES = [
  "submitted",
  "acknowledged",
  "sourceDispatched",
  "sourceResponded",
  "interrupted",
  "partSkipped",
] as const;
export const AuditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

/**
 * Details: identifiers, metadata and role:"type" values only. Never other field values,
 * payload text, credentials, secrets, adapter error text or user free text. Additive only.
 */
export const AUDIT_DETAILS_SCHEMAS = {
  submitted: z.strictObject({
    partId: PartId,
    parentPartId: PartId.nullable(),
    origin: z.enum(["primary", "alsoRun"]),
    queryType: Id,
    typeValues: TypeValues,
    selectedSourceIds: z.array(Id),
    dispatchedSourceIds: z.array(Id),
    droppedSourceIds: z.array(Id),
    plateOnly: z.boolean(),
    configHash: Id,
    fieldMapApplied: z.record(z.string(), z.string()).optional(),
  }),
  acknowledged: z.strictObject({
    acknowledgedAt: EpochMs,
    ackLatencyMs: DurationMs,
    partCount: z.int().min(1),
  }),
  sourceDispatched: z.strictObject({
    partId: PartId,
    sourceId: Id,
    resultId: Id,
    credentialOwnerUserId: Id.nullable(),
    delegationId: Id.nullable(),
    adapterKind: Id,
  }),
  sourceResponded: z.strictObject({
    partId: PartId,
    sourceId: Id,
    resultId: Id,
    status: z.enum(["returned", "failed", "timedOut", "credentialsMissing", "credentialsRejected"]),
    latencyMs: DurationMs,
    credentialOwnerUserId: Id.nullable(),
    delegationId: Id.nullable(),
    adapterKind: Id,
    errorCode: AdapterErrorCodeSchema.optional(),
  }),
  interrupted: z.strictObject({
    partId: PartId,
    sourceId: Id,
    resultId: Id,
    reason: z.literal("processRestart"),
  }),
  partSkipped: z.strictObject({
    partId: PartId,
    parentPartId: PartId.nullable(),
    queryType: Id,
    typeValues: TypeValues,
    reasons: z.array(AuditValidationErrorSchema).min(1),
  }),
} as const;

export type AuditDetails<T extends AuditEventType> = z.infer<(typeof AUDIT_DETAILS_SCHEMAS)[T]>;

export function parseAuditDetails<T extends AuditEventType>(
  type: T,
  details: unknown,
): AuditDetails<T> {
  return AUDIT_DETAILS_SCHEMAS[type].parse(details) as AuditDetails<T>;
}

export const AuditActorSchema = z.strictObject({
  id: Id,
  email: z.string().nullable(),
  role: z.union([RoleSchema, z.literal("system")]),
});
export type AuditActor = z.infer<typeof AuditActorSchema>;

export const SYSTEM_ACTOR: AuditActor = { id: "system", email: null, role: "system" };

const envelope = {
  correlationId: Id.optional(),
  partId: PartId.optional(),
  actor: AuditActorSchema,
  credentialUserId: Id.optional(),
  identitySource: IdentitySourceSchema,
  hostSubject: Id.optional(),
};

export const AuditEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("submitted"),
    ...envelope,
    details: AUDIT_DETAILS_SCHEMAS.submitted,
  }),
  z.strictObject({
    type: z.literal("acknowledged"),
    ...envelope,
    details: AUDIT_DETAILS_SCHEMAS.acknowledged,
  }),
  z.strictObject({
    type: z.literal("sourceDispatched"),
    ...envelope,
    details: AUDIT_DETAILS_SCHEMAS.sourceDispatched,
  }),
  z.strictObject({
    type: z.literal("sourceResponded"),
    ...envelope,
    details: AUDIT_DETAILS_SCHEMAS.sourceResponded,
  }),
  z.strictObject({
    type: z.literal("interrupted"),
    ...envelope,
    details: AUDIT_DETAILS_SCHEMAS.interrupted,
  }),
  z.strictObject({
    type: z.literal("partSkipped"),
    ...envelope,
    details: AUDIT_DETAILS_SCHEMAS.partSkipped,
  }),
]);
export type AuditEvent = z.infer<typeof AuditEventSchema>;
