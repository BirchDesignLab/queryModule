import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AUDIT_DETAILS_SCHEMAS,
  AUDIT_EVENT_TYPES,
  AuditEventSchema,
  type AuditEventType,
  parseAuditDetails,
  SYSTEM_ACTOR,
} from "./audit";
import { isTerminalSourceStatus, SOURCE_STATUSES } from "./source-status";

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
    configHash: "abc123",
  },
  acknowledged: { acknowledgedAt: 1790000000000, ackLatencyMs: 42, partCount: 2 },
  sourceDispatched: {
    partId: 0,
    sourceId: "stateSource",
    resultId: "r1",
    credentialOwnerUserId: null,
    delegationId: null,
    adapterKind: "mock",
  },
  sourceResponded: {
    partId: 0,
    sourceId: "stateSource",
    resultId: "r1",
    status: "returned",
    latencyMs: 120,
    credentialOwnerUserId: null,
    delegationId: null,
    adapterKind: "mock",
  },
  interrupted: { partId: 0, sourceId: "stateSource", resultId: "r1", reason: "processRestart" },
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
        reasons: [{ key: "validation.tooLong", params: { value: "SMITH" } }],
      }),
    ).toThrow();
  });
});

describe("SEC-011 SEC-012 audit envelope", () => {
  it("parses an event with a user actor and one with the system actor", () => {
    const user = {
      type: "submitted",
      correlationId: "0199a0b0-0000-7000-8000-000000000001",
      partId: 0,
      actor: { id: "u1", email: "officer@example.test", role: "user" },
      identitySource: "local",
      details: samples.submitted,
    };
    expect(AuditEventSchema.parse(user)).toEqual(user);
    const system = {
      type: "interrupted",
      correlationId: "c1",
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

describe("SEC-011 T4-C actor and identity source agree (spec 4.7)", () => {
  const base = { type: "interrupted", partId: 0, details: samples.interrupted } as const;
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
  };
  const asEvent = (details: { partId: number }) => ({
    type: "submitted",
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
    const event = { type, actor: USER_ACTOR, identitySource: "local", details };
    it(`${type}: rejects a missing envelope partId`, () => {
      expect(AuditEventSchema.safeParse(event).success).toBe(false);
    });
    it(`${type}: rejects a mismatched envelope partId`, () => {
      expect(AuditEventSchema.safeParse({ ...event, partId: details.partId + 5 }).success).toBe(
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
      actor: USER_ACTOR,
      identitySource: "local",
      details: samples.acknowledged,
    };
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
  });
});
