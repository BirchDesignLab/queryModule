import { describe, expect, it } from "vitest";
import {
  AdminConfigResponseSchema,
  AdminUserSchema,
  AdminUserSessionSchema,
  ConfigDocumentSchema,
  ConfigVersionSchema,
  CreateUserBodySchema,
  CreateUserResponseSchema,
  PublishConfigBodySchema,
  PutDraftBodySchema,
  SetRoleBodySchema,
  ValidateConfigResponseSchema,
} from "./admin";
import { findRoute, ROUTES } from "./routes";

/** Synthetic ids and hashes (spec 5.4 fixture policy). */
const VID = "0199a0b0-0000-7000-8000-0000000000c1";
const SID = "0199a0b0-0000-7000-8000-0000000000e1";
const HASH = "0123456789abcdef".repeat(4);
const doc = { siteConfig: { schemaVersion: 1 }, locales: { en: { "field.plate": "Plate" } } };
const version = {
  id: VID,
  version: 2,
  status: "draft",
  configHash: null,
  baseVersion: 1,
  createdBy: "impl1",
  createdAt: 1_790_000_000_000,
  publishedBy: null,
  publishedAt: null,
  rollbackOf: null,
} as const;
const adminUser = {
  id: "u2",
  email: "impl@example.test",
  name: "Demo Implementer",
  role: "user",
  disabled: false,
  mustChangePassword: true,
  createdAt: 1_790_000_000_000,
  signInCount: 3,
  lastSignInAt: 1_790_000_500_000,
  distinctIps: 2,
} as const;

describe("ADR-0011 admin config contracts (BR-001, FR-060)", () => {
  it("a config document is SiteConfig JSON, a locale overlay and an optional mock file", () => {
    expect(ConfigDocumentSchema.safeParse(doc).success).toBe(true);
    expect(ConfigDocumentSchema.safeParse({ ...doc, mock: { siteId: "default" } }).success).toBe(
      true,
    );
    expect(ConfigDocumentSchema.safeParse({ ...doc, extra: 1 }).success).toBe(false);
    expect(
      ConfigDocumentSchema.safeParse({ ...doc, locales: { "not a locale": {} } }).success,
    ).toBe(false);
  });

  it("a draft has no hash until published; a published version has one", () => {
    expect(ConfigVersionSchema.safeParse(version).success).toBe(true);
    expect(
      ConfigVersionSchema.safeParse({
        ...version,
        status: "published",
        configHash: HASH,
        publishedBy: "admin1",
        publishedAt: 1_790_000_000_001,
      }).success,
    ).toBe(true);
    expect(ConfigVersionSchema.safeParse({ ...version, status: "live" }).success).toBe(false);
    expect(ConfigVersionSchema.safeParse({ ...version, version: 0 }).success).toBe(false);
  });

  it("GET config returns the live version with its document and the draft or null", () => {
    const live = { ...version, version: 1, status: "published", configHash: HASH, document: doc };
    expect(
      AdminConfigResponseSchema.safeParse({ siteId: "default", live, draft: null }).success,
    ).toBe(true);
    expect(
      AdminConfigResponseSchema.safeParse({
        siteId: "default",
        live,
        draft: { ...version, document: doc },
      }).success,
    ).toBe(true);
  });

  it("a draft save names its base version (optimistic lock, ADR-0011 item 5)", () => {
    expect(PutDraftBodySchema.safeParse({ baseVersion: 1, document: doc }).success).toBe(true);
    expect(PutDraftBodySchema.safeParse({ document: doc }).success).toBe(false);
    expect(PublishConfigBodySchema.safeParse({ draftVersion: 2 }).success).toBe(true);
    expect(PublishConfigBodySchema.safeParse({ draftVersion: 0 }).success).toBe(false);
  });

  it("validation answers diagnostics by JSON pointer", () => {
    const d = { level: "error", path: "/queryTypes/0", key: "config.unknownField", params: {} };
    expect(ValidateConfigResponseSchema.safeParse({ errors: [d], warnings: [] }).success).toBe(
      true,
    );
  });
});

describe("ADR-0011 admin user contracts (SEC-005, SEC-014)", () => {
  it("a user row carries no password, hash or token", () => {
    expect(AdminUserSchema.safeParse(adminUser).success).toBe(true);
    for (const leak of ["password", "passwordHash", "token"])
      expect(AdminUserSchema.safeParse({ ...adminUser, [leak]: "x" }).success, leak).toBe(false);
  });

  it("a user row carries sign-in stats as counts and a time, never an IP value (developer ruling 10-01-26)", () => {
    expect(AdminUserSchema.safeParse({ ...adminUser, lastSignInAt: null }).success).toBe(true);
    expect(AdminUserSchema.safeParse({ ...adminUser, signInCount: -1 }).success).toBe(false);
    expect(AdminUserSchema.safeParse({ ...adminUser, distinctIps: 1.5 }).success).toBe(false);
    expect(AdminUserSchema.safeParse({ ...adminUser, clientIp: "x" }).success).toBe(false);
    const { signInCount: _s, ...without } = adminUser;
    expect(AdminUserSchema.safeParse(without).success).toBe(false);
  });

  it("only the create response carries the one-time password (ADR-0011 item 8)", () => {
    expect(
      CreateUserResponseSchema.safeParse({
        user: adminUser,
        temporaryPassword: "a".repeat(24),
      }).success,
    ).toBe(true);
    expect(
      CreateUserBodySchema.safeParse({
        email: "impl@example.test",
        name: "Demo Implementer",
        role: "user",
      }).success,
    ).toBe(true);
    expect(
      CreateUserBodySchema.safeParse({
        email: "impl@example.test",
        name: "Demo Implementer",
        role: "user",
        password: "chosen-by-admin",
      }).success,
    ).toBe(false);
    expect(SetRoleBodySchema.safeParse({ role: "root" }).success).toBe(false);
  });

  it("a session row names the session id, never its token", () => {
    const s = { id: SID, createdAt: 1, expiresAt: 2, userAgent: null, current: true };
    const { current: _c, ...unmarked } = s;
    expect(AdminUserSessionSchema.safeParse(unmarked).success).toBe(false);
    expect(AdminUserSessionSchema.safeParse(s).success).toBe(true);
    expect(AdminUserSessionSchema.safeParse({ ...s, token: "x" }).success).toBe(false);
    expect(AdminUserSessionSchema.safeParse({ ...s, id: "not-a-uuid" }).success).toBe(false);
  });
});

describe("ADR-0011 admin routes (SEC-014)", () => {
  const admin = ROUTES.filter((r) => r.path.startsWith("/api/v1/admin/"));

  it("config routes are configEditor behind adminConfig; user and session routes admin behind adminUsers", () => {
    expect(admin).toHaveLength(13);
    for (const r of admin) {
      const config = r.path.startsWith("/api/v1/admin/config");
      expect(r.access, r.id).toBe(config ? "configEditor" : "admin");
      expect(r.feature, r.id).toBe(config ? "adminConfig" : "adminUsers");
      // Task 27 mounted the config routes and Task 28 the user routes: all live.
      expect(r.status, r.id).toBe("live");
      expect(r.since, r.id).toBe("m1");
      expect(r.responses[401], r.id).toBeDefined();
      expect(r.responses[403], r.id).toBeDefined();
    }
  });

  it("every write needs X-Requested-With; reads do not", () => {
    for (const r of admin) expect(r.requiresRequestedWith, r.id).toBe(r.method !== "get");
  });

  it("draft save and publish answer 409 draftConflict; role change and disable answer 409 lastAdmin", () => {
    for (const id of ["putAdminConfigDraft", "publishAdminConfig"] as const)
      expect(findRoute(id).responses[409]?.description).toContain("draftConflict");
    for (const id of ["setAdminUserRole", "disableAdminUser"] as const)
      expect(findRoute(id).responses[409]?.description).toContain("lastAdmin");
  });
});
