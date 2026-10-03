import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClientSiteConfigSchema } from "@querymodule/core/config";
import type { ApiErrorCode, RouteAccess, RouteDef } from "@querymodule/core/contracts";
import { ApiErrorSchema, CreateUserResponseSchema, ROUTES } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { ALL_ON, adminConfigApp, type Caller, withSiteConfig } from "../helpers/admin-config";
import { createTestApp } from "../helpers/test-app";

/*
 * Spec 10.3 route x caller matrix, M1 exit row extended to the admin routes (D-A30, Task 29).
 * Every operation in the committed openapi.json is called by every caller: anonymous, user,
 * trainingOfficer, implementer, admin, and a user who still holds an admin-issued temporary
 * password (D-A26). The implementer is config only (checker ruling 09-29-26, ADR-0011 item 6).
 * A second run on config/test/flags-off.json expects 404 notFound on every admin route.
 * SEC-005, SEC-006, SEC-010, SEC-014.
 */

const FLAGS_OFF = resolve(import.meta.dirname, "../../../config/test/flags-off.json");
const MARK = "ZZMATRIXAGENCY";

interface Operation {
  key: string;
  id: string;
  method: string;
  /** OpenAPI path template. */
  path: string;
  feature: string | undefined;
  access: RouteAccess;
}

const openapi = JSON.parse(
  readFileSync(new URL("../../openapi.json", import.meta.url), "utf8"),
) as {
  paths: Record<string, Record<string, { operationId: string; "x-feature"?: string }>>;
};
const OPERATIONS: Operation[] = Object.entries(openapi.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => {
    const route = ROUTES.find((r) => r.id === op.operationId);
    if (!route) throw new Error(`openapi operation ${op.operationId} is not in ROUTES`);
    return {
      key: `${method.toUpperCase()} ${path}`,
      id: op.operationId,
      method: method.toUpperCase(),
      path,
      feature: op["x-feature"],
      access: route.access,
    };
  }),
);

type Who = Caller | "mustChangePassword";
type Expected = { status: number; code?: ApiErrorCode } | "ok";

/** Session-access routes the config-only implementer may call (checker ruling 09-29-26). */
const IMPLEMENTER_SESSION_ROUTES = new Set(["getConfig"]);

/** Whether a signed-in role passes the route's access rule; derived from the contract access. */
function allowed(role: Exclude<Caller, "anonymous">, access: RouteAccess, id: string): boolean {
  switch (access) {
    case "public":
    case "sessionOwn":
      return true;
    case "session":
      return role !== "implementer" || IMPLEMENTER_SESSION_ROUTES.has(id);
    case "configEditor":
      return role === "admin" || role === "implementer";
    case "admin":
      return role === "admin";
    case "policy":
      throw new Error(`no policy route expected yet (${id}); extend the matrix`);
  }
}

/** The expected answer for `who` on an operation; never a hand-typed per-route literal. */
function expectedFor(
  who: Who,
  op: Pick<Operation, "access" | "id" | "feature">,
  flagsOn: boolean,
): Expected {
  if (op.feature !== undefined && !flagsOn) return { status: 404, code: "notFound" };
  if (op.access === "public") return "ok";
  if (who === "anonymous") return { status: 401, code: "unauthenticated" };
  if (who === "mustChangePassword") return { status: 403, code: "passwordChangeRequired" };
  return allowed(who, op.access, op.id) ? "ok" : { status: 403, code: "forbidden" };
}

/** Per-run values a request needs: an exported document, a target user and its session. */
interface Fixture {
  doc: unknown;
  targetId: string;
  targetSessionId: string;
}

interface Call {
  params?: Record<string, string>;
  body?: (f: Fixture) => unknown;
  headers?: Record<string, string>;
  /** The status an allowed caller gets, in the table's order on one fresh app. */
  ok: number;
  /** The error code an allowed caller's non-2xx ok status must carry (#505 T29 Q1). */
  okCode?: string;
}

/**
 * One request per operation, run in this order. Each succeeds for an allowed caller, so an
 * allowed row proves the handler ran (not just that the guard let it through).
 */
const CALLS: Record<string, Call> = {
  getHealth: { ok: 200 },
  getMeta: { ok: 200 },
  getLocale: { params: { locale: "en" }, ok: 200 },
  getConfig: { ok: 200 },
  getMePreferences: { ok: 200 },
  putMePreferences: {
    body: () => ({ themeMode: null, personaOverride: null, layout: null }),
    ok: 200,
  },
  // No Idempotency-Key: an allowed caller gets 400 validationFailed, so no query is recorded.
  submitQuery: { body: () => ({}), ok: 400, okCode: "validationFailed" },
  getAdminConfig: { ok: 200 },
  putAdminConfigDraft: { body: (f) => ({ baseVersion: 1, document: f.doc }), ok: 200 },
  validateAdminConfig: { body: (f) => ({ document: f.doc }), ok: 200 },
  publishAdminConfig: { body: () => ({ draftVersion: 2 }), ok: 200 },
  listAdminConfigVersions: { ok: 200 },
  rollbackAdminConfig: { params: { version: "1" }, ok: 200 },
  exportAdminConfigVersion: { params: { version: "1" }, ok: 200 },
  listAdminUsers: { ok: 200 },
  createAdminUser: {
    body: () => ({ email: "made@example.test", name: "Made", role: "user" }),
    ok: 201,
  },
  setAdminUserRole: {
    params: { id: "target" },
    body: () => ({ role: "trainingOfficer" }),
    ok: 200,
  },
  listAdminUserSessions: { params: { id: "target" }, ok: 200 },
  revokeAdminSession: { params: { sessionId: "targetSession" }, ok: 204 },
  disableAdminUser: { params: { id: "target" }, ok: 200 },
};

function pathOf(op: Operation, call: Call, f: Fixture): string {
  return op.path.replace(/\{([A-Za-z]+)\}/g, (_m, name: string) => {
    const v = call.params?.[name];
    if (v === "target") return f.targetId;
    if (v === "targetSession") return f.targetSessionId;
    if (v === undefined) throw new Error(`no ${name} for ${op.id}`);
    return v;
  });
}

const ROLE_CALLERS = ["anonymous", "user", "trainingOfficer", "implementer", "admin"] as const;

async function runMatrix(who: Who, flagsOn: boolean) {
  const a = await adminConfigApp({ siteConfig: flagsOn ? ALL_ON : FLAGS_OFF });
  const doc = flagsOn
    ? withSiteConfig(await a.exportVersion(1), (s) => {
        s.defaults = { ...(s.defaults as Record<string, string>), agency: MARK };
      })
    : {};
  const targetId = await a.t.createUser("target@example.test", "correct-horse-battery-1");
  await a.t.cookieFor("target@example.test", "correct-horse-battery-1");
  const s = await a.t.deps.db.$client.execute({
    sql: "SELECT id FROM session WHERE user_id = ?",
    args: [targetId],
  });
  const targetSessionId = s.rows[0]?.id;
  // #505 T29 Q2: a missing target session is a setup failure, not a confusing row failure.
  if (targetSessionId === undefined || targetSessionId === null)
    throw new Error("route-matrix setup: the target user has no session");
  const f: Fixture = { doc, targetId, targetSessionId: String(targetSessionId) };

  let send: (method: string, path: string, body?: unknown) => Promise<Response>;
  if (who === "mustChangePassword") {
    // An admin creates an admin: the flag, not the role, must answer every data route.
    const created = await a.call("admin", "POST", "/api/v1/admin/users", {
      email: "fresh@example.test",
      name: "Fresh",
      role: "admin",
    });
    const { temporaryPassword } = CreateUserResponseSchema.parse(await created.json());
    const cookie = await a.t.cookieFor("fresh@example.test", temporaryPassword);
    send = (method, path, body) =>
      a.t.request(path, {
        method,
        headers: {
          cookie,
          "x-requested-with": "querymodule",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  } else {
    send = (method, path, body) => a.call(who, method, path, body);
  }

  const failures: string[] = [];
  for (const [id, call] of Object.entries(CALLS)) {
    const op = OPERATIONS.find((o) => o.id === id);
    if (!op) throw new Error(`no openapi operation ${id}`);
    const r = await send(op.method, pathOf(op, call, f), call.body?.(f));
    const want = expectedFor(who, op, flagsOn);
    const status = want === "ok" ? call.ok : want.status;
    let got = `${r.status}`;
    const code = want === "ok" ? call.okCode : want.code;
    if (code !== undefined && r.status === status) {
      const parsed = ApiErrorSchema.safeParse(await r.json());
      got += ` ${parsed.success ? parsed.data.error.code : "unparsed"}`;
    }
    const wanted = code === undefined ? `${status}` : `${status} ${code}`;
    if (got !== wanted) failures.push(`${who} ${op.key}: want ${wanted}, got ${got}`);
  }
  // Better Auth's own session route stays open to every caller, a flagged one included.
  const session = await send("GET", "/api/v1/auth/get-session");
  if (session.status !== 200) failures.push(`${who} get-session: ${session.status}`);
  expect(failures).toEqual([]);
}

describe("spec 10.3 route by caller matrix (D-A30, admin routes from openapi.json)", () => {
  it("expected status is derived from the contract's access, not a hand-typed literal", () => {
    // critic:I1 (P1): a route whose access says sessionOwn must answer 401 to anonymous whatever
    // any per-route table claims; the expectation comes from the access value alone.
    const op = { id: "example", access: "sessionOwn" as const, feature: undefined };
    expect(expectedFor("anonymous", op, true)).toEqual({ status: 401, code: "unauthenticated" });
    expect(expectedFor("implementer", { ...op, access: "session" }, true)).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(expectedFor("admin", { ...op, access: "admin", feature: "adminUsers" }, false)).toEqual({
      status: 404,
      code: "notFound",
    });
  });

  it("covers every openapi.json operation, each one in ROUTES", () => {
    expect(Object.keys(CALLS).sort()).toEqual(OPERATIONS.map((o) => o.id).sort());
    expect(OPERATIONS.map((o) => o.id).sort()).toEqual(ROUTES.map((r: RouteDef) => r.id).sort());
    // Every admin route carries its feature flag, so the flags-off run covers all of them.
    for (const o of OPERATIONS.filter((x) => x.path.startsWith("/api/v1/admin/")))
      expect(o.feature, o.id).toMatch(/^admin(Config|Users)$/);
  });

  it.each([...ROLE_CALLERS, "mustChangePassword" as const])(
    "flags on: %s on every route",
    async (who) => {
      await runMatrix(who, true);
    },
    30_000,
  );

  it.each(ROLE_CALLERS)(
    "flags off: %s gets 404 notFound on every admin route",
    async (who) => {
      await runMatrix(who, false);
    },
    30_000,
  );

  it("GET /api/v1/config: 401 anonymous; with a session the body is the allowlist", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    const cookie = await t.cookieFor("dispatcher@example.test", "correct-horse-battery-1");
    const body = await (await t.request("/api/v1/config", { headers: { cookie } })).json();
    expect(ClientSiteConfigSchema.strict().safeParse(body).success).toBe(true);
  });
  it("missing X-Requested-With on a state-changing route is 403 forbidden", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/meta", { method: "POST" });
    expect(r.status).toBe(403);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("forbidden");
  });
  it("POST /api/v1/queries: signed in without X-Requested-With is 403 forbidden", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    const cookie = await t.cookieFor("dispatcher@example.test", "correct-horse-battery-1");
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: "{}",
    });
    expect(r.status).toBe(403);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("forbidden");
  });
});
