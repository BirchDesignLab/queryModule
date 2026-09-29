import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AUDIT_DETAILS_SCHEMAS, AuditEventSchema, SYSTEM_ACTOR } from "./audit";
import * as contracts from "./index";

/** Synthetic fixtures (spec 5.4 fixture policy): documentation IP range, example.test email. */
const IP = "203.0.113.9";
const CID = "0199a0b0-0000-7000-8000-000000000001";
/** Session row id: Better Auth generateId is uuidv7 (plan Task 14), never the session token. */
const SID = "0199a0b0-0000-7000-8000-0000000000e1";
const USER_ACTOR = { id: "u1", email: "officer@example.test", role: "user" } as const;

describe("SEC-010 auth audit details", () => {
  it("loginSucceeded requires method, sessionId, clientIp", () => {
    const s = AUDIT_DETAILS_SCHEMAS.loginSucceeded;
    expect(s.safeParse({ method: "password", sessionId: SID, clientIp: IP }).success).toBe(true);
    expect(s.safeParse({ method: "magic", sessionId: SID, clientIp: "x" }).success).toBe(false);
    expect(
      s.safeParse({ method: "password", sessionId: SID, clientIp: "x", password: "p" }).success,
    ).toBe(false);
  });
  it("loginFailed allows lockoutUntil only as epoch ms", () => {
    const s = AUDIT_DETAILS_SCHEMAS.loginFailed;
    expect(
      s.safeParse({ targetUserId: null, reason: "unknownAccount", clientIp: "x" }).success,
    ).toBe(true);
    expect(
      s.safeParse({ targetUserId: "u", reason: "badPassword", clientIp: "x", lockoutUntil: 1 })
        .success,
    ).toBe(true);
    expect(
      s.safeParse({ targetUserId: "u", reason: "badPassword", clientIp: "x", lockoutUntil: "soon" })
        .success,
    ).toBe(false);
    expect(s.safeParse({ targetUserId: "u", reason: "typo", clientIp: "x" }).success).toBe(false);
  });
  it("logout requires sessionId", () => {
    expect(AUDIT_DETAILS_SCHEMAS.logout.safeParse({ sessionId: SID }).success).toBe(true);
    expect(AUDIT_DETAILS_SCHEMAS.logout.safeParse({}).success).toBe(false);
  });
  it("roleChanged pins via to grant-role or the admin console (ADR-0011 item 8)", () => {
    const s = AUDIT_DETAILS_SCHEMAS.roleChanged;
    expect(
      s.safeParse({ targetUserId: "u", role: "admin", change: "granted", via: "grant-role" })
        .success,
    ).toBe(true);
    expect(
      s.safeParse({
        targetUserId: "u",
        role: "implementer",
        change: "granted",
        via: "adminConsole",
      }).success,
    ).toBe(true);
    expect(
      s.safeParse({ targetUserId: "u", role: "admin", change: "granted", via: "api" }).success,
    ).toBe(false);
    expect(
      s.safeParse({ targetUserId: "u", role: "root", change: "granted", via: "grant-role" })
        .success,
    ).toBe(false);
  });
});

describe("SEC-010 ADR-0005 auth audit ids, times and client IP are bounded", () => {
  it("sessionId is the UUIDv7 session row id, so a session token never fits", () => {
    const token = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";
    for (const sessionId of ["s1", token, CID.toUpperCase()]) {
      expect(AUDIT_DETAILS_SCHEMAS.logout.safeParse({ sessionId }).success).toBe(false);
      expect(
        AUDIT_DETAILS_SCHEMAS.loginSucceeded.safeParse({
          method: "password",
          sessionId,
          clientIp: IP,
        }).success,
      ).toBe(false);
    }
  });
  it("user ids are bounded ids", () => {
    const long = "a".repeat(65);
    expect(
      AUDIT_DETAILS_SCHEMAS.loginFailed.safeParse({
        targetUserId: "has space",
        reason: "badPassword",
        clientIp: IP,
      }).success,
    ).toBe(false);
    expect(
      AUDIT_DETAILS_SCHEMAS.roleChanged.safeParse({
        targetUserId: long,
        role: "admin",
        change: "revoked",
        via: "grant-role",
      }).success,
    ).toBe(false);
  });
  it("lockoutUntil is a non-negative integer", () => {
    const s = AUDIT_DETAILS_SCHEMAS.loginFailed;
    const d = { targetUserId: "u", reason: "lockedOut", clientIp: IP } as const;
    expect(s.safeParse({ ...d, lockoutUntil: -1 }).success).toBe(false);
    expect(s.safeParse({ ...d, lockoutUntil: 1.5 }).success).toBe(false);
  });
  it("clientIp accepts IPv4, IPv6 and the local and unknown fallbacks, and nothing unbounded", () => {
    const ok = (clientIp: string) =>
      AUDIT_DETAILS_SCHEMAS.loginSucceeded.safeParse({
        method: "password",
        sessionId: SID,
        clientIp,
      }).success;
    for (const v of [IP, "2001:db8::1", "::ffff:203.0.113.9", "local", "unknown"]) {
      expect(ok(v)).toBe(true);
    }
    for (const v of ["fe80::1%eth0", "::1"]) expect(ok(v)).toBe(true);
    // 64-character boundary, and the longest real value: IPv4-mapped IPv6 plus a 15-char zone (61).
    const longest = "0000:0000:0000:0000:0000:ffff:255.255.255.255%abcdefghijklmno";
    expect(longest).toHaveLength(61);
    for (const v of ["x".repeat(64), longest]) expect(ok(v)).toBe(true);
    for (const v of ["", "a b", "203.0.113.9\n", "x".repeat(65)]) expect(ok(v)).toBe(false);
  });
  it("clientIp rejects header punctuation (review C-M1, spec 4.7 identifiers only)", () => {
    const ok = (clientIp: string) =>
      AUDIT_DETAILS_SCHEMAS.logout
        .extend({ clientIp: AUDIT_DETAILS_SCHEMAS.loginSucceeded.shape.clientIp })
        .safeParse({ sessionId: SID, clientIp }).success;
    for (const v of ["<x>", "pw=a;b", 'a"b', "a'b", "a/b", "a,b", "203.0.113.9?x"]) {
      expect(ok(v)).toBe(false);
    }
  });
});

describe("SEC-005 SEC-012 auth rows parse through AuditEventSchema (AuditService path)", () => {
  it("loginFailed with the system actor and no correlation id", () => {
    const e = {
      type: "loginFailed",
      actor: SYSTEM_ACTOR,
      identitySource: "system",
      details: { targetUserId: null, reason: "unknownAccount", clientIp: IP },
    };
    expect(AuditEventSchema.parse(e)).toEqual(e);
  });
  it("loginSucceeded and logout with the user as actor", () => {
    for (const [type, details] of [
      ["loginSucceeded", { method: "password", sessionId: SID, clientIp: IP }],
      ["logout", { sessionId: SID }],
    ] as const) {
      const e = { type, actor: USER_ACTOR, identitySource: "local", details };
      expect(AuditEventSchema.parse(e)).toEqual(e);
    }
  });
  it("roleChanged with the system actor", () => {
    const e = {
      type: "roleChanged",
      actor: SYSTEM_ACTOR,
      identitySource: "system",
      details: {
        targetUserId: "u2",
        role: "trainingOfficer",
        change: "granted",
        via: "grant-role",
      },
    };
    expect(AuditEventSchema.parse(e)).toEqual(e);
  });
  it("auth rows carry no partId or credentialUserId, and correlationId stays optional", () => {
    const base = {
      type: "logout",
      actor: USER_ACTOR,
      identitySource: "local",
      details: { sessionId: SID },
    };
    expect(AuditEventSchema.safeParse({ ...base, correlationId: CID }).success).toBe(true);
    expect(AuditEventSchema.safeParse({ ...base, partId: 0 }).success).toBe(false);
    expect(AuditEventSchema.safeParse({ ...base, credentialUserId: "u1" }).success).toBe(false);
  });
  it("loginFailed with a system-role actor and identitySource local is rejected", () => {
    const e = {
      type: "loginFailed",
      actor: SYSTEM_ACTOR,
      identitySource: "local",
      details: { targetUserId: null, reason: "unknownAccount", clientIp: IP },
    };
    expect(AuditEventSchema.safeParse(e).success).toBe(false);
  });
  it("Task 11 AuditService reads partId and credentialUserId off any parsed event", () => {
    const e = AuditEventSchema.parse({
      type: "logout",
      actor: USER_ACTOR,
      identitySource: "local",
      details: { sessionId: SID },
    });
    // Type-level: these reads must compile on the whole union (plan Task 11 insert).
    expect(e.partId ?? null).toBeNull();
    expect(e.credentialUserId ?? null).toBeNull();
  });
  it("AuditEventSchema converts to JSON Schema", () => {
    // Default options: z.undefined() would throw here, z.never() emits { not: {} } (ruling point 1).
    const json = z.toJSONSchema(AuditEventSchema) as { anyOf?: unknown[]; oneOf?: unknown[] };
    const variants = (json.anyOf ?? json.oneOf ?? []) as {
      properties?: Record<string, { const?: unknown; not?: unknown }>;
    }[];
    const login = variants.find((v) => v.properties?.type?.const === "loginSucceeded");
    expect(login?.properties?.partId).toEqual({ not: {} });
    expect(login?.properties?.credentialUserId).toEqual({ not: {} });
  });
  it("auth rows keep the actor and identity source invariant", () => {
    const e = {
      type: "roleChanged",
      actor: SYSTEM_ACTOR,
      identitySource: "local",
      details: { targetUserId: "u2", role: "admin", change: "granted", via: "grant-role" },
    };
    expect(AuditEventSchema.safeParse(e).success).toBe(false);
  });
  it("a details body from another auth type is rejected", () => {
    const e = {
      type: "logout",
      actor: USER_ACTOR,
      identitySource: "local",
      details: { method: "password", sessionId: SID, clientIp: IP },
    };
    expect(AuditEventSchema.safeParse(e).success).toBe(false);
  });
});

describe("SEC-010 auth contracts are exported from the package entry (Task 16 imports them)", () => {
  it("ClientIpSchema and the auth details schemas are reachable from ./index", () => {
    expect(contracts.ClientIpSchema.safeParse("203.0.113.9").success).toBe(true);
    expect(contracts.ClientIpSchema.safeParse("a, b").success).toBe(false);
    expect(contracts.CLIENT_IP_MAX_LENGTH).toBe(64);
    expect(contracts.LoginSucceededDetailsSchema).toBe(AUDIT_DETAILS_SCHEMAS.loginSucceeded);
    expect(contracts.LoginFailedDetailsSchema).toBe(AUDIT_DETAILS_SCHEMAS.loginFailed);
    expect(contracts.LogoutDetailsSchema).toBe(AUDIT_DETAILS_SCHEMAS.logout);
    expect(contracts.RoleChangedDetailsSchema).toBe(AUDIT_DETAILS_SCHEMAS.roleChanged);
  });
});
