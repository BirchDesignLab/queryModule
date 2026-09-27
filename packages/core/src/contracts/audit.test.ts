import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AUDIT_DETAILS_SCHEMAS,
  AUDIT_EVENT_TYPES,
  AuditActorSchema,
  AuditEventSchema,
  type AuditEventType,
  parseAuditDetails,
  SYSTEM_ACTOR,
} from "./audit";
import { MAX_ALSO_RUN } from "./primitives";
import { isTerminalSourceStatus, SOURCE_STATUSES } from "./source-status";

/** Synthetic UUIDv7 and SHA-256 fixtures (spec 5.4 fixture policy; ADR-0005). */
const CID = "0199a0b0-0000-7000-8000-000000000001";
const RID = "0199a0b0-0000-7000-8000-0000000000a1";
const DID = "0199a0b0-0000-7000-8000-0000000000d1";
const HASH = "0123456789abcdef".repeat(4);

const samples = {
  submitted: {
    partId: 0,
    parentPartId: null,
    origin: "primary",
    queryType: "VEH",
    typeValues: {},
    selectedSourceIds: ["stateSource", "nationalSource"],
    dispatchedSourceIds: ["stateSource"],
    droppedSourceIds: ["nationalSource"],
    plateOnly: true,
    configHash: HASH,
  },
  acknowledged: { acknowledgedAt: 1790000000000, ackLatencyMs: 42, partCount: 2 },
  sourceDispatched: {
    partId: 0,
    sourceId: "stateSource",
    resultId: RID,
    credentialOwnerUserId: null,
    delegationId: null,
    adapterKind: "mock",
  },
  sourceResponded: {
    partId: 0,
    sourceId: "stateSource",
    resultId: RID,
    status: "returned",
    latencyMs: 120,
    credentialOwnerUserId: null,
    delegationId: null,
    adapterKind: "mock",
  },
  interrupted: { partId: 0, sourceId: "stateSource", resultId: RID, reason: "processRestart" },
  partSkipped: {
    partId: 1,
    parentPartId: 0,
    queryType: "WNT",
    typeValues: {},
    reasons: [
      { key: "plan.nestedNoSources" },
      { key: "validation.required", params: { field: "last", position: 1 } },
    ],
  },
} as const;

describe("SEC-010 audit catalogue (spec 4.7 query events)", () => {
  it("lists exactly the six query event types frozen in M0 P0", () => {
    expect([...AUDIT_EVENT_TYPES]).toEqual([
      "submitted",
      "acknowledged",
      "sourceDispatched",
      "sourceResponded",
      "interrupted",
      "partSkipped",
    ]);
    expect(Object.keys(AUDIT_DETAILS_SCHEMAS).sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });

  for (const type of AUDIT_EVENT_TYPES) {
    it(`${type}: accepts the spec sample`, () => {
      expect(parseAuditDetails(type, samples[type])).toEqual(samples[type]);
    });
    it(`${type}: rejects field values smuggled in as extra keys`, () => {
      expect(() =>
        parseAuditDetails(type, { ...samples[type], values: { plate: "ZZ-0001" } }),
      ).toThrow();
    });
  }

  it("no details schema declares a key that could carry values, payloads or secrets", () => {
    const forbidden = ["values", "payload", "secret", "password", "credentials", "message", "text"];
    for (const schema of Object.values(AUDIT_DETAILS_SCHEMAS)) {
      for (const key of Object.keys(schema.shape)) expect(forbidden).not.toContain(key);
    }
  });

  it("submitted accepts fieldMapApplied for alsoRun parts", () => {
    const nested = {
      ...samples.submitted,
      partId: 1,
      parentPartId: 0,
      origin: "alsoRun",
      fieldMapApplied: { last: "last" },
    };
    expect(parseAuditDetails("submitted", nested)).toEqual(nested);
  });

  it("sourceResponded rejects pending and interrupted and non-enumerated error codes", () => {
    expect(() =>
      parseAuditDetails("sourceResponded", { ...samples.sourceResponded, status: "pending" }),
    ).toThrow();
    expect(() =>
      parseAuditDetails("sourceResponded", { ...samples.sourceResponded, status: "interrupted" }),
    ).toThrow();
    expect(() =>
      parseAuditDetails("sourceResponded", {
        ...samples.sourceResponded,
        status: "failed",
        errorCode: "ECONNRESET at host",
      }),
    ).toThrow();
    expect(
      parseAuditDetails("sourceResponded", {
        ...samples.sourceResponded,
        status: "failed",
        errorCode: "failed",
      }).errorCode,
    ).toBe("failed");
  });

  it("partSkipped reasons carry only field keys, label keys and positions", () => {
    expect(() =>
      parseAuditDetails("partSkipped", {
        ...samples.partSkipped,
        reasons: [{ key: "validation.tooLong", params: { value: "TESTERSON" } }],
      }),
    ).toThrow();
  });
});

describe("SEC-011 SEC-012 audit envelope", () => {
  it("parses an event with a user actor and one with the system actor", () => {
    const user = {
      type: "submitted",
      correlationId: CID,
      partId: 0,
      actor: { id: "u1", email: "officer@example.test", role: "user" },
      identitySource: "local",
      details: samples.submitted,
    };
    expect(AuditEventSchema.parse(user)).toEqual(user);
    const system = {
      type: "interrupted",
      correlationId: CID,
      partId: 0,
      actor: SYSTEM_ACTOR,
      identitySource: "system",
      details: samples.interrupted,
    };
    expect(AuditEventSchema.parse(system)).toEqual(system);
  });
  it("rejects a details body that belongs to a different type", () => {
    expect(
      AuditEventSchema.safeParse({
        type: "acknowledged",
        correlationId: CID,
        actor: SYSTEM_ACTOR,
        identitySource: "system",
        details: samples.interrupted,
      }).success,
    ).toBe(false);
  });
  it("rejects envelope keys the spec does not define (id and at are service-assigned)", () => {
    expect(
      AuditEventSchema.safeParse({
        type: "interrupted",
        id: 5,
        correlationId: CID,
        partId: 0,
        actor: SYSTEM_ACTOR,
        identitySource: "system",
        details: samples.interrupted,
      }).success,
    ).toBe(false);
  });
});

describe("FR-043 source status", () => {
  it("pending is the only non-terminal status", () => {
    expect(SOURCE_STATUSES.filter((s) => !isTerminalSourceStatus(s))).toEqual(["pending"]);
  });
});

const USER_ACTOR = { id: "u1", email: "officer@example.test", role: "user" } as const;
const primarySubmitted = samples.submitted;
const alsoRunSubmitted = {
  ...samples.submitted,
  partId: 1,
  parentPartId: 0,
  origin: "alsoRun",
  fieldMapApplied: { last: "last" },
} as const;

describe("AuditActor email is a bounded email or null (ADR-0005 amended 09-26-26)", () => {
  const actor = (email: string | null) => AuditActorSchema.safeParse({ ...USER_ACTOR, email });
  /** Synthetic address of exactly n characters on example.test (spec 5.4 fixture policy). */
  const addressOf = (n: number) => `${"a".repeat(n - "@example.test".length)}@example.test`;
  it("accepts a synthetic address, null and a 254-character address", () => {
    expect(actor("officer@example.test").success).toBe(true);
    expect(actor(null).success).toBe(true);
    expect(addressOf(254)).toHaveLength(254);
    expect(actor(addressOf(254)).success).toBe(true);
  });
  it("rejects a non-email string and a 255-character address", () => {
    expect(actor("not an email").success).toBe(false);
    expect(actor(addressOf(255)).success).toBe(false);
  });
});

describe("SEC-011 T4-C actor and identity source agree (spec 4.7)", () => {
  const base = {
    type: "interrupted",
    correlationId: CID,
    partId: 0,
    details: samples.interrupted,
  } as const;
  it("rejects the system actor with a non-system identity source", () => {
    expect(
      AuditEventSchema.safeParse({ ...base, actor: SYSTEM_ACTOR, identitySource: "local" }).success,
    ).toBe(false);
  });
  it("rejects a user actor with the system identity source", () => {
    expect(
      AuditEventSchema.safeParse({ ...base, actor: USER_ACTOR, identitySource: "system" }).success,
    ).toBe(false);
  });
  it("rejects a system-role actor with another id", () => {
    expect(
      AuditEventSchema.safeParse({
        ...base,
        actor: { ...SYSTEM_ACTOR, id: "sweeper" },
        identitySource: "system",
      }).success,
    ).toBe(false);
  });
  it("rejects a system-role actor with a non-null email", () => {
    expect(
      AuditEventSchema.safeParse({
        ...base,
        actor: { ...SYSTEM_ACTOR, email: "system@example.test" },
        identitySource: "system",
      }).success,
    ).toBe(false);
  });
  it("accepts SYSTEM_ACTOR with the system identity source", () => {
    expect(
      AuditEventSchema.safeParse({ ...base, actor: SYSTEM_ACTOR, identitySource: "system" })
        .success,
    ).toBe(true);
  });
});

describe("SEC-010 T4-D submitted origin invariants (spec 4.7)", () => {
  it("every details schema is still a ZodObject after refinement (Interfaces contract)", () => {
    const typed: { [T in AuditEventType]: z.ZodObject } = AUDIT_DETAILS_SCHEMAS;
    for (const schema of Object.values(typed)) expect(schema).toBeInstanceOf(z.ZodObject);
  });
  const valid = { primary: primarySubmitted, alsoRun: alsoRunSubmitted };
  const { fieldMapApplied: _omit, ...alsoRunNoMap } = alsoRunSubmitted;
  const violations = {
    "primary with a parentPartId": { ...primarySubmitted, parentPartId: 0 },
    "primary with fieldMapApplied": { ...primarySubmitted, fieldMapApplied: { last: "last" } },
    "alsoRun with a null parentPartId": { ...alsoRunSubmitted, parentPartId: null },
    "alsoRun without fieldMapApplied": alsoRunNoMap,
    "primary with a partId other than 0 (spec 5.2 line 747)": { ...primarySubmitted, partId: 2 },
    "alsoRun with partId 0 (spec 5.2 line 747)": { ...alsoRunSubmitted, partId: 0 },
    "alsoRun with a parent other than part 0 (spec 4.6 PlanPart)": {
      ...alsoRunSubmitted,
      parentPartId: 3,
    },
    "alsoRun with a partId over MAX_ALSO_RUN": { ...alsoRunSubmitted, partId: 5 },
  };
  const asEvent = (details: { partId: number }) => ({
    type: "submitted",
    correlationId: CID,
    partId: details.partId,
    actor: USER_ACTOR,
    identitySource: "local",
    details,
  });

  for (const [name, details] of Object.entries(valid)) {
    it(`accepts a valid ${name} part via parseAuditDetails and AuditEventSchema`, () => {
      expect(parseAuditDetails("submitted", details)).toEqual(details);
      expect(AuditEventSchema.safeParse(asEvent(details)).success).toBe(true);
    });
  }
  for (const [name, details] of Object.entries(violations)) {
    it(`rejects ${name} via parseAuditDetails and AuditEventSchema`, () => {
      expect(() => parseAuditDetails("submitted", details)).toThrow();
      expect(AuditEventSchema.safeParse(asEvent(details)).success).toBe(false);
    });
  }
});

describe("SEC-012 T4-E envelope partId matches details partId (ADR-0003)", () => {
  const partScoped = [
    "submitted",
    "sourceDispatched",
    "sourceResponded",
    "interrupted",
    "partSkipped",
  ] as const;
  for (const type of partScoped) {
    const details = samples[type];
    const event = { type, correlationId: CID, actor: USER_ACTOR, identitySource: "local", details };
    it(`${type}: rejects a missing envelope partId`, () => {
      expect(AuditEventSchema.safeParse(event).success).toBe(false);
    });
    it(`${type}: rejects a mismatched envelope partId`, () => {
      expect(AuditEventSchema.safeParse({ ...event, partId: details.partId + 1 }).success).toBe(
        false,
      );
    });
    it(`${type}: accepts a matching envelope partId`, () => {
      expect(AuditEventSchema.safeParse({ ...event, partId: details.partId }).success).toBe(true);
    });
  }
  it("acknowledged: envelope partId stays optional", () => {
    const event = {
      type: "acknowledged",
      correlationId: CID,
      actor: USER_ACTOR,
      identitySource: "local",
      details: samples.acknowledged,
    };
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
  });
});

describe("SEC-010 P2 to P4 audit id, key and code formats (ADR-0005, spec 5.5 line 854)", () => {
  const reject = (type: AuditEventType, details: unknown) =>
    expect(() => parseAuditDetails(type, details)).toThrow();

  it("resultId is a UUIDv7 on every result-scoped type", () => {
    for (const type of ["sourceDispatched", "sourceResponded", "interrupted"] as const) {
      reject(type, { ...samples[type], resultId: "r1" });
      reject(type, { ...samples[type], resultId: RID.toUpperCase() });
    }
  });
  it("delegationId is a UUIDv7 when present", () => {
    for (const type of ["sourceDispatched", "sourceResponded"] as const) {
      const delegated = { ...samples[type], credentialOwnerUserId: "u2", delegationId: DID };
      expect(parseAuditDetails(type, delegated)).toEqual(delegated);
      reject(type, { ...delegated, delegationId: "d1" });
    }
  });
  it("configHash is SHA-256 hex (spec 5.8 line 988)", () => {
    reject("submitted", { ...samples.submitted, configHash: "abc123" });
    reject("submitted", { ...samples.submitted, configHash: HASH.toUpperCase() });
  });
  it("typeValues map FieldKey to TypePicklistCode", () => {
    const ok = { ...samples.submitted, typeValues: { plateType: "PC", propertyType: "FIREARM" } };
    expect(parseAuditDetails("submitted", ok)).toEqual(ok);
    for (const typeValues of [
      { plateType: "PC LIGHT" },
      { plateType: "TESTERSON, T" },
      { plateType: "" },
      { "plate type": "PC" },
      { plate_type: "PC" },
    ]) {
      reject("submitted", { ...samples.submitted, typeValues });
      reject("partSkipped", { ...samples.partSkipped, typeValues });
    }
  });
  it("fieldMapApplied maps FieldKey to FieldKey", () => {
    const nested = {
      ...samples.submitted,
      partId: 1,
      parentPartId: 0,
      origin: "alsoRun",
      fieldMapApplied: { last: "last" },
    };
    reject("submitted", { ...nested, fieldMapApplied: { last: "ZZ-0001" } });
    reject("submitted", { ...nested, fieldMapApplied: { "last name": "last" } });
  });
  it("queryType, sourceId and adapterKind are bounded ids", () => {
    reject("submitted", { ...samples.submitted, queryType: "VEH PLATE" });
    reject("partSkipped", { ...samples.partSkipped, queryType: "x".repeat(65) });
    reject("submitted", { ...samples.submitted, selectedSourceIds: ["state source"] });
    reject("submitted", { ...samples.submitted, dispatchedSourceIds: [""] });
    reject("submitted", { ...samples.submitted, droppedSourceIds: ["a/b"] });
    for (const type of ["sourceDispatched", "sourceResponded", "interrupted"] as const) {
      reject(type, { ...samples[type], sourceId: "state source" });
    }
    for (const type of ["sourceDispatched", "sourceResponded"] as const) {
      reject(type, { ...samples[type], adapterKind: "x".repeat(65) });
      reject(type, { ...samples[type], credentialOwnerUserId: "officer one" });
    }
  });
  it("partSkipped reason params.field is a FieldKey", () => {
    reject("partSkipped", {
      ...samples.partSkipped,
      reasons: [{ key: "validation.required", params: { field: "ZZ-0001" } }],
    });
  });
  it("envelope correlationId, actor id, credentialUserId and hostSubject are bounded", () => {
    const event = {
      type: "interrupted",
      correlationId: CID,
      partId: 0,
      actor: USER_ACTOR,
      identitySource: "local",
      details: samples.interrupted,
    } as const;
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
    for (const bad of [
      { correlationId: "c1" },
      { actor: { ...USER_ACTOR, id: "officer one" } },
      { credentialUserId: "x".repeat(65) },
    ]) {
      expect(AuditEventSchema.safeParse({ ...event, ...bad }).success).toBe(false);
    }
    const host = { ...event, identitySource: "host", hostSubject: "host|0001" } as const;
    expect(AuditEventSchema.safeParse(host).success).toBe(true);
    expect(AuditEventSchema.safeParse({ ...host, hostSubject: "s".repeat(256) }).success).toBe(
      false,
    );
    expect(AuditEventSchema.safeParse({ ...host, hostSubject: "a\nb" }).success).toBe(false);
  });
});

/** One valid event per query type, with every envelope field the type requires. */
const events = {
  submitted: { partId: 0, details: samples.submitted },
  acknowledged: { details: samples.acknowledged },
  sourceDispatched: { partId: 0, details: samples.sourceDispatched },
  sourceResponded: { partId: 0, details: samples.sourceResponded },
  interrupted: { partId: 0, details: samples.interrupted },
  partSkipped: { partId: 1, details: samples.partSkipped },
} as const;
const eventOf = (type: AuditEventType, extra: object = {}) => ({
  type,
  correlationId: CID,
  actor: USER_ACTOR,
  identitySource: "local",
  ...events[type],
  ...extra,
});
const parses = (event: unknown) => AuditEventSchema.safeParse(event).success;

describe("SEC-014 I1 every query audit row carries the correlation id (spec 5.2 step 1)", () => {
  for (const type of AUDIT_EVENT_TYPES) {
    it(`${type}: accepts the event with a correlationId`, () => {
      expect(parses(eventOf(type))).toBe(true);
    });
    it(`${type}: rejects a missing correlationId`, () => {
      const { correlationId: _omit, ...event } = eventOf(type);
      expect(parses(event)).toBe(false);
    });
    it(`${type}: rejects a null correlationId`, () => {
      expect(parses(eventOf(type, { correlationId: null }))).toBe(false);
    });
  }
});

describe("SEC-011 I2 delegated credentials name the credential owner (spec 5.2 step 3)", () => {
  for (const type of ["sourceDispatched", "sourceResponded"] as const) {
    const base = samples[type];
    it(`${type}: rejects a delegationId without a credentialOwnerUserId`, () => {
      const bad = { ...base, credentialOwnerUserId: null, delegationId: DID };
      expect(() => parseAuditDetails(type, bad)).toThrow();
      expect(parses(eventOf(type, { details: bad }))).toBe(false);
    });
    it(`${type}: accepts a delegated credential with its owner`, () => {
      const ok = { ...base, credentialOwnerUserId: "u2", delegationId: DID };
      expect(parseAuditDetails(type, ok)).toEqual(ok);
    });
    it(`${type}: accepts the caller's own credential (owner set, no delegation)`, () => {
      const ok = { ...base, credentialOwnerUserId: "u1", delegationId: null };
      expect(parseAuditDetails(type, ok)).toEqual(ok);
    });
    it(`${type}: accepts no credential (both null)`, () => {
      expect(parseAuditDetails(type, base)).toEqual(base);
    });
  }
});

describe("SEC-010 I3 part topology (spec 5.2 line 747, spec 4.6)", () => {
  it("partSkipped is for nested parts only: partId 1 to MAX_ALSO_RUN, parent 0", () => {
    for (const partId of [1, MAX_ALSO_RUN]) {
      const ok = { ...samples.partSkipped, partId };
      expect(parseAuditDetails("partSkipped", ok)).toEqual(ok);
    }
    for (const bad of [
      { partId: 0 },
      { partId: MAX_ALSO_RUN + 1 },
      { parentPartId: null },
      { parentPartId: 2 },
    ]) {
      expect(() => parseAuditDetails("partSkipped", { ...samples.partSkipped, ...bad })).toThrow();
    }
  });
  it("acknowledged.partCount is 1 to MAX_ALSO_RUN + 1", () => {
    for (const partCount of [1, MAX_ALSO_RUN + 1]) {
      const ok = { ...samples.acknowledged, partCount };
      expect(parseAuditDetails("acknowledged", ok)).toEqual(ok);
    }
    for (const partCount of [0, MAX_ALSO_RUN + 2, 40]) {
      expect(() =>
        parseAuditDetails("acknowledged", { ...samples.acknowledged, partCount }),
      ).toThrow();
    }
  });
  it("part ids above MAX_ALSO_RUN are rejected on every part-scoped type", () => {
    for (const type of ["sourceDispatched", "sourceResponded", "interrupted"] as const) {
      expect(() => parseAuditDetails(type, { ...samples[type], partId: 999 })).toThrow();
      expect(() =>
        parseAuditDetails(type, { ...samples[type], partId: MAX_ALSO_RUN + 1 }),
      ).toThrow();
      const ok = { ...samples[type], partId: MAX_ALSO_RUN };
      expect(parseAuditDetails(type, ok)).toEqual(ok);
    }
  });
  it("acknowledged: an optional envelope partId follows the same range", () => {
    expect(parses(eventOf("acknowledged", { partId: 0 }))).toBe(true);
    expect(parses(eventOf("acknowledged", { partId: MAX_ALSO_RUN + 1 }))).toBe(false);
  });
});

describe("SEC-010 M7 further details invariants stated by the spec", () => {
  const responded = samples.sourceResponded;
  it("errorCode only with the status of the same name (spec 5.4 line 809, 5.7 line 958)", () => {
    for (const code of ["failed", "credentialsRejected"] as const) {
      const ok = { ...responded, status: code, errorCode: code };
      expect(parseAuditDetails("sourceResponded", ok)).toEqual(ok);
    }
    const noCode = { ...responded, status: "failed" };
    expect(parseAuditDetails("sourceResponded", noCode)).toEqual(noCode);
    for (const [status, errorCode] of [
      ["returned", "failed"],
      ["timedOut", "failed"],
      ["credentialsMissing", "credentialsRejected"],
      ["failed", "credentialsRejected"],
      ["credentialsRejected", "failed"],
    ]) {
      expect(() =>
        parseAuditDetails("sourceResponded", { ...responded, status, errorCode }),
      ).toThrow();
    }
  });
  it("droppedSourceIds only under plate-only narrowing (spec 4.6 step 3, line 539)", () => {
    const narrowed = samples.submitted;
    expect(parseAuditDetails("submitted", narrowed)).toEqual(narrowed);
    const normal = { ...narrowed, plateOnly: false, droppedSourceIds: [] };
    expect(parseAuditDetails("submitted", normal)).toEqual(normal);
    const plateNoDrops = { ...narrowed, droppedSourceIds: [] };
    expect(parseAuditDetails("submitted", plateNoDrops)).toEqual(plateNoDrops);
    expect(() => parseAuditDetails("submitted", { ...narrowed, plateOnly: false })).toThrow();
  });
  it("hostSubject only with identitySource host (spec 4.7 line 613, 5.6 line 911)", () => {
    expect(parses(eventOf("submitted", { identitySource: "host", hostSubject: "host|0001" }))).toBe(
      true,
    );
    expect(parses(eventOf("submitted", { hostSubject: "host|0001" }))).toBe(false);
    expect(
      parses(
        eventOf("interrupted", {
          actor: SYSTEM_ACTOR,
          identitySource: "system",
          hostSubject: "host|0001",
        }),
      ),
    ).toBe(false);
  });
});

describe("SEC-011 C-M1 envelope credentialUserId equals details credentialOwnerUserId (#98)", () => {
  for (const type of ["sourceDispatched", "sourceResponded"] as const) {
    const owned = { ...samples[type], credentialOwnerUserId: "u2", delegationId: DID };
    it(`${type}: accepts an envelope credentialUserId equal to the owner`, () => {
      expect(parses(eventOf(type, { credentialUserId: "u2", details: owned }))).toBe(true);
    });
    it(`${type}: accepts no credential in the envelope or details`, () => {
      expect(parses(eventOf(type))).toBe(true);
    });
    it(`${type}: rejects an envelope credentialUserId naming another user`, () => {
      expect(parses(eventOf(type, { credentialUserId: "u3", details: owned }))).toBe(false);
    });
    it(`${type}: rejects a missing envelope credentialUserId when details name an owner`, () => {
      expect(parses(eventOf(type, { details: owned }))).toBe(false);
    });
    it(`${type}: rejects an envelope credentialUserId when details name no owner`, () => {
      expect(parses(eventOf(type, { credentialUserId: "u1" }))).toBe(false);
    });
  }
});

describe("FR-043 C-M3 sourceResponded status follows SourceStatus (#98)", () => {
  const recorded = SOURCE_STATUSES.filter((s) => s !== "pending" && s !== "interrupted");
  it("accepts every terminal status other than interrupted", () => {
    for (const status of recorded) {
      const d = { ...samples.sourceResponded, status };
      expect(parseAuditDetails("sourceResponded", d)).toEqual(d);
    }
  });
  it("offers exactly SourceStatus minus pending and interrupted, in order", () => {
    expect(AUDIT_DETAILS_SCHEMAS.sourceResponded.shape.status.options).toEqual(recorded);
  });
});
