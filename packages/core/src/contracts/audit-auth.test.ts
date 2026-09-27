import { describe, expect, it } from "vitest";
import { AUDIT_DETAILS_SCHEMAS, AuditEventSchema, SYSTEM_ACTOR } from "./audit";

/** Synthetic fixtures (spec 5.4 fixture policy): documentation IP range, example.test email. */
const IP = "203.0.113.9";
const CID = "0199a0b0-0000-7000-8000-000000000001";
const USER_ACTOR = { id: "u1", email: "officer@example.test", role: "user" } as const;

describe("SEC-010 auth audit details", () => {
  it("loginSucceeded requires method, sessionId, clientIp", () => {
    const s = AUDIT_DETAILS_SCHEMAS.loginSucceeded;
    expect(s.safeParse({ method: "password", sessionId: "s1", clientIp: IP }).success).toBe(true);
    expect(s.safeParse({ method: "magic", sessionId: "s1", clientIp: "x" }).success).toBe(false);
    expect(
      s.safeParse({ method: "password", sessionId: "s1", clientIp: "x", password: "p" }).success,
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
    expect(AUDIT_DETAILS_SCHEMAS.logout.safeParse({ sessionId: "s1" }).success).toBe(true);
    expect(AUDIT_DETAILS_SCHEMAS.logout.safeParse({}).success).toBe(false);
  });
  it("roleChanged pins via to grant-role", () => {
    const s = AUDIT_DETAILS_SCHEMAS.roleChanged;
    expect(
      s.safeParse({ targetUserId: "u", role: "admin", change: "granted", via: "grant-role" })
        .success,
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
  it("user and session ids are bounded ids", () => {
    const long = "a".repeat(65);
    expect(AUDIT_DETAILS_SCHEMAS.logout.safeParse({ sessionId: "has space" }).success).toBe(false);
    expect(AUDIT_DETAILS_SCHEMAS.logout.safeParse({ sessionId: long }).success).toBe(false);
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
        sessionId: "s1",
        clientIp,
      }).success;
    for (const v of [IP, "2001:db8::1", "::ffff:203.0.113.9", "local", "unknown"]) {
      expect(ok(v)).toBe(true);
    }
    for (const v of ["", "a b", "203.0.113.9\n", "x".repeat(65)]) expect(ok(v)).toBe(false);
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
      ["loginSucceeded", { method: "password", sessionId: "s1", clientIp: IP }],
      ["logout", { sessionId: "s1" }],
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
      details: { sessionId: "s1" },
    };
    expect(AuditEventSchema.safeParse({ ...base, correlationId: CID }).success).toBe(true);
    expect(AuditEventSchema.safeParse({ ...base, partId: 0 }).success).toBe(false);
    expect(AuditEventSchema.safeParse({ ...base, credentialUserId: "u1" }).success).toBe(false);
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
      details: { method: "password", sessionId: "s1", clientIp: IP },
    };
    expect(AuditEventSchema.safeParse(e).success).toBe(false);
  });
});
