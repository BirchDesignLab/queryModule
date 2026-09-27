import { z } from "zod";
import { IdentitySourceSchema, RoleSchema } from "./identity";
import {
  BoundedIdSchema,
  DurationMsSchema,
  EpochMsSchema,
  FieldKeySchema,
  HostSubjectSchema,
  MAX_ALSO_RUN,
  MessageKeySchema,
  NestedPartIdSchema,
  ParentPartIdSchema,
  PartIdSchema,
  Sha256HexSchema,
  TypeValuesSchema,
  Uuid7Schema,
} from "./primitives";
import { AdapterErrorCodeSchema } from "./source-status";

/** alsoRun fieldMap as applied: target field key to source field key (spec 4.6). */
const FieldMapApplied = z.record(FieldKeySchema, FieldKeySchema);

/** ValidationError restricted for audit: params limited to field keys, label keys and positions. */
export const AuditValidationErrorSchema = z.strictObject({
  key: MessageKeySchema,
  params: z
    .strictObject({
      field: FieldKeySchema.optional(),
      labelKey: MessageKeySchema.optional(),
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

/** SEC-011, spec 5.2 step 3: a delegation snapshot always names the officer as credential owner. */
function delegationNeedsOwner(
  d: { credentialOwnerUserId: string | null; delegationId: string | null },
  ctx: z.RefinementCtx,
): void {
  if (d.delegationId !== null && d.credentialOwnerUserId === null) {
    ctx.addIssue({
      code: "custom",
      path: ["credentialOwnerUserId"],
      message: "delegated credentials need the credential owner",
    });
  }
}

/**
 * Details: identifiers, metadata and role:"type" values only. Never other field values,
 * payload text, credentials, secrets, adapter error text or user free text. Additive only.
 */
export const AUDIT_DETAILS_SCHEMAS = {
  submitted: z
    .strictObject({
      partId: PartIdSchema,
      parentPartId: ParentPartIdSchema.nullable(),
      origin: z.enum(["primary", "alsoRun"]),
      queryType: BoundedIdSchema,
      typeValues: TypeValuesSchema,
      selectedSourceIds: z.array(BoundedIdSchema),
      dispatchedSourceIds: z.array(BoundedIdSchema),
      droppedSourceIds: z.array(BoundedIdSchema),
      plateOnly: z.boolean(),
      configHash: Sha256HexSchema,
      fieldMapApplied: FieldMapApplied.optional(),
    })
    /**
     * Spec 4.7: parentPartId is null for primary; alsoRun also carries fieldMapApplied.
     * Spec 5.2: part 0 is the primary; a nested part is its alsoRun index plus 1.
     * Spec 4.6 step 3: sources are dropped only by plate-only narrowing.
     */
    .superRefine((d, ctx) => {
      const primary = d.origin === "primary";
      if (primary !== (d.parentPartId === null)) {
        ctx.addIssue({
          code: "custom",
          path: ["parentPartId"],
          message: primary ? "primary part has no parent" : "alsoRun part needs a parent",
        });
      }
      if (primary !== (d.partId === 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["partId"],
          message: primary ? "primary part is part 0" : "alsoRun part is never part 0",
        });
      }
      if (primary === (d.fieldMapApplied !== undefined)) {
        ctx.addIssue({
          code: "custom",
          path: ["fieldMapApplied"],
          message: primary
            ? "primary part has no fieldMapApplied"
            : "alsoRun part needs fieldMapApplied",
        });
      }
      if (d.droppedSourceIds.length > 0 && !d.plateOnly) {
        ctx.addIssue({
          code: "custom",
          path: ["droppedSourceIds"],
          message: "sources are dropped only by plate-only narrowing",
        });
      }
    }),
  acknowledged: z.strictObject({
    acknowledgedAt: EpochMsSchema,
    ackLatencyMs: DurationMsSchema,
    partCount: z
      .int()
      .min(1)
      .max(MAX_ALSO_RUN + 1),
  }),
  sourceDispatched: z
    .strictObject({
      partId: PartIdSchema,
      sourceId: BoundedIdSchema,
      resultId: Uuid7Schema,
      credentialOwnerUserId: BoundedIdSchema.nullable(),
      delegationId: Uuid7Schema.nullable(),
      adapterKind: BoundedIdSchema,
    })
    .superRefine(delegationNeedsOwner),
  sourceResponded: z
    .strictObject({
      partId: PartIdSchema,
      sourceId: BoundedIdSchema,
      resultId: Uuid7Schema,
      status: z.enum([
        "returned",
        "failed",
        "timedOut",
        "credentialsMissing",
        "credentialsRejected",
      ]),
      latencyMs: DurationMsSchema,
      credentialOwnerUserId: BoundedIdSchema.nullable(),
      delegationId: Uuid7Schema.nullable(),
      adapterKind: BoundedIdSchema,
      errorCode: AdapterErrorCodeSchema.optional(),
    })
    .superRefine((d, ctx) => {
      delegationNeedsOwner(d, ctx);
      // Spec 5.4: a thrown SourceError code is the outcome of the same name (anything else is
      // failed). Spec 5.2 step 5: credentialsMissing and timedOut carry no adapter error.
      if (d.errorCode !== undefined && d.errorCode !== d.status) {
        ctx.addIssue({
          code: "custom",
          path: ["errorCode"],
          message: "errorCode must equal a failed or credentialsRejected status",
        });
      }
    }),
  interrupted: z.strictObject({
    partId: PartIdSchema,
    sourceId: BoundedIdSchema,
    resultId: Uuid7Schema,
    reason: z.literal("processRestart"),
  }),
  /** Spec 4.6 step 5: only nested parts are skipped; a primary error is a PlanError (400). */
  partSkipped: z.strictObject({
    partId: NestedPartIdSchema,
    parentPartId: ParentPartIdSchema,
    queryType: BoundedIdSchema,
    typeValues: TypeValuesSchema,
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
  id: BoundedIdSchema,
  email: z.email().max(254).nullable(),
  role: z.union([RoleSchema, z.literal("system")]),
});
export type AuditActor = z.infer<typeof AuditActorSchema>;

export const SYSTEM_ACTOR: AuditActor = { id: "system", email: null, role: "system" };

/** Base envelope (spec 4.7). correlationId stays optional for later non-query types (auth rows). */
const envelope = {
  correlationId: Uuid7Schema.optional(),
  partId: PartIdSchema.optional(),
  actor: AuditActorSchema,
  credentialUserId: BoundedIdSchema.optional(),
  identitySource: IdentitySourceSchema,
  hostSubject: HostSubjectSchema.optional(),
};
/** Query types: every row carries the submit's correlation id (SEC-014; spec 4.6, 5.2 step 1). */
const queryEnvelope = { ...envelope, correlationId: Uuid7Schema };
/** Part-scoped types: envelope partId is required and equals details.partId (ADR-0003). */
const partEnvelope = { ...queryEnvelope, partId: PartIdSchema };

export const AuditEventSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("submitted"),
      ...partEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.submitted,
    }),
    z.strictObject({
      type: z.literal("acknowledged"),
      ...queryEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.acknowledged,
    }),
    z.strictObject({
      type: z.literal("sourceDispatched"),
      ...partEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.sourceDispatched,
    }),
    z.strictObject({
      type: z.literal("sourceResponded"),
      ...partEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.sourceResponded,
    }),
    z.strictObject({
      type: z.literal("interrupted"),
      ...partEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.interrupted,
    }),
    z.strictObject({
      type: z.literal("partSkipped"),
      ...partEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.partSkipped,
    }),
  ])
  .superRefine((e, ctx) => {
    // Spec 4.7: system rows carry exactly SYSTEM_ACTOR and identity_source system, and only they do.
    const systemRole = e.actor.role === "system";
    if (systemRole !== (e.identitySource === "system")) {
      ctx.addIssue({
        code: "custom",
        path: ["identitySource"],
        message: "actor role system and identitySource system go together",
      });
    }
    if (systemRole && (e.actor.id !== SYSTEM_ACTOR.id || e.actor.email !== SYSTEM_ACTOR.email)) {
      ctx.addIssue({
        code: "custom",
        path: ["actor"],
        message: "system actor must equal SYSTEM_ACTOR",
      });
    }
    // Spec 4.7 (host subject for embedded mode) and 5.6: only host principals carry one.
    if (e.hostSubject !== undefined && e.identitySource !== "host") {
      ctx.addIssue({
        code: "custom",
        path: ["hostSubject"],
        message: "hostSubject needs identitySource host",
      });
    }
    // ADR-0003: envelope partId equals details.partId for part-scoped types.
    if ("partId" in e.details && e.partId !== e.details.partId) {
      ctx.addIssue({
        code: "custom",
        path: ["partId"],
        message: "envelope partId must equal details.partId",
      });
    }
  });
export type AuditEvent = z.infer<typeof AuditEventSchema>;
