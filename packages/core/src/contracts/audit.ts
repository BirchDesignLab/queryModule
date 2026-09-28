import { z } from "zod";
import {
  LoginFailedDetailsSchema,
  LoginSucceededDetailsSchema,
  LogoutDetailsSchema,
  RoleChangedDetailsSchema,
} from "./audit-auth";
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
  SemverSchema,
  Sha256HexSchema,
  TypeValuesSchema,
  Uuid7Schema,
} from "./primitives";
import { AdapterErrorCodeSchema, SourceStatusSchema } from "./source-status";

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
  "loginSucceeded",
  "loginFailed",
  "logout",
  "roleChanged",
  "configLoaded",
  "retentionPurged",
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
      /** Spec 4.7: a terminal SourceStatus other than interrupted (that one has its own type). */
      status: SourceStatusSchema.exclude(["pending", "interrupted"]),
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
  loginSucceeded: LoginSucceededDetailsSchema,
  loginFailed: LoginFailedDetailsSchema,
  logout: LogoutDetailsSchema,
  roleChanged: RoleChangedDetailsSchema,
  /** Spec 4.7 admin and ops table, spec 5.8 step 7: one row per successful config load. One overlay level (spec 4.1). */
  configLoaded: z.strictObject({
    siteId: BoundedIdSchema,
    configHash: Sha256HexSchema,
    configSchemaVersion: z.int().min(1),
    coreVersion: SemverSchema,
    extendsChain: z.array(BoundedIdSchema).max(1),
  }),
  /**
   * Spec 4.7: one row per purged scope. olderThan is the retention cutoff, and null exactly when
   * the purge is a lost-data-key shred (reason keyLost). SEC-021.
   */
  retentionPurged: z
    .strictObject({
      scope: z.enum(["payload", "values"]),
      reason: z.enum(["retention", "keyLost"]),
      olderThan: EpochMsSchema.nullable(),
      requestCount: z.int().min(0),
      keysDeleted: z.int().min(0),
    })
    .superRefine((d, ctx) => {
      if ((d.reason === "keyLost") !== (d.olderThan === null)) {
        ctx.addIssue({
          code: "custom",
          path: ["olderThan"],
          message: "olderThan is null exactly when reason is keyLost",
        });
      }
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
/**
 * Request-level query types (submitted, acknowledged, partSkipped): a submit has no single
 * credential owner, so credentialUserId stays in the type as never and any value is rejected.
 * Owner searches on audit_event(credential_user_id, at) then match exactly the per-source rows
 * (sourceDispatched, sourceResponded, and interrupted, which copies the pending row's owner).
 * SEC-011 (#98 C-M8, D-A1).
 */
const requestEnvelope = { ...queryEnvelope, credentialUserId: z.never().optional() };
const requestPartEnvelope = { ...partEnvelope, credentialUserId: z.never().optional() };
/**
 * Auth types (spec 5.6): no query part and no state credential. partId and credentialUserId stay
 * in the type as never, so a consumer reads them off any AuditEvent, and any value is rejected.
 */
const authEnvelope = {
  correlationId: envelope.correlationId,
  partId: z.never().optional(),
  actor: envelope.actor,
  credentialUserId: z.never().optional(),
  identitySource: envelope.identitySource,
  hostSubject: envelope.hostSubject,
};
/**
 * System types (configLoaded, retentionPurged; spec 4.7): no request, part or state credential.
 * The three columns stay in the type as never, and the row is written by SYSTEM_ACTOR only.
 */
const systemEnvelope = {
  correlationId: z.never().optional(),
  partId: z.never().optional(),
  actor: envelope.actor,
  credentialUserId: z.never().optional(),
  identitySource: envelope.identitySource,
  hostSubject: envelope.hostSubject,
};

export const AuditEventSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("submitted"),
      ...requestPartEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.submitted,
    }),
    z.strictObject({
      type: z.literal("acknowledged"),
      ...requestEnvelope,
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
    // interrupted keeps an optional owner: the startup sweep (M1 P3) copies source_result.credential_user_id.
    z.strictObject({
      type: z.literal("interrupted"),
      ...partEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.interrupted,
    }),
    z.strictObject({
      type: z.literal("partSkipped"),
      ...requestPartEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.partSkipped,
    }),
    z.strictObject({
      type: z.literal("loginSucceeded"),
      ...authEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.loginSucceeded,
    }),
    z.strictObject({
      type: z.literal("loginFailed"),
      ...authEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.loginFailed,
    }),
    z.strictObject({
      type: z.literal("logout"),
      ...authEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.logout,
    }),
    z.strictObject({
      type: z.literal("roleChanged"),
      ...authEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.roleChanged,
    }),
    z.strictObject({
      type: z.literal("configLoaded"),
      ...systemEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.configLoaded,
    }),
    z.strictObject({
      type: z.literal("retentionPurged"),
      ...systemEnvelope,
      details: AUDIT_DETAILS_SCHEMAS.retentionPurged,
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
    // Spec 4.7 (D-A2): system types are written by the system actor only.
    const systemType = e.type === "configLoaded" || e.type === "retentionPurged";
    if (systemType && !systemRole) {
      ctx.addIssue({ code: "custom", path: ["actor"], message: "written by the system actor" });
    }
    // Auth and system types have neither envelope column; the checks below are query-only.
    if (
      systemType ||
      e.type === "loginSucceeded" ||
      e.type === "loginFailed" ||
      e.type === "logout" ||
      e.type === "roleChanged"
    ) {
      return;
    }
    // SEC-011 (#98): one row names one credential owner; the envelope column equals details.
    if (
      "credentialOwnerUserId" in e.details &&
      (e.credentialUserId ?? null) !== e.details.credentialOwnerUserId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["credentialUserId"],
        message: "envelope credentialUserId must equal details.credentialOwnerUserId",
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
