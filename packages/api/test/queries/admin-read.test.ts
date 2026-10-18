import { resolve } from "node:path";
import type { Role } from "@querymodule/core/contracts";
import {
  type AdminQueryDetail,
  AdminQueryDetailSchema,
  ApiErrorSchema,
  CreateUserResponseSchema,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { sourceResult } from "../../src/db/schema";
import { withTransaction } from "../../src/db/tx";
import { uuidv7 } from "../../src/ids";
import { grantRole } from "../../src/ops/grant-role";
import { recordAdminViewed } from "../../src/queries/admin-read";
import type { Principal } from "../../src/seams";
import { manualTime } from "../helpers/manual-time";
import { openResults } from "../helpers/results";
import { createTestApp } from "../helpers/test-app";

/*
 * GET /api/v1/admin/queries/:correlationId, the admin read (spec 4.7 adminViewed, 5.1, 5.2 admin
 * basis, 5.5 purged; FR-063, SEC-012, SEC-014; #713, #561). Every read writes one adminViewed
 * (viewerBasis admin) that commits before any DEK is unwrapped; an audit failure fails closed.
 * Mock data only: ZZ-0001 is the shipped mock's scenario plate (spec 5.4, 10.8).
 */

// A pass-through spy on unwrapRequestKey: records each unwrap in `order`, so a test can check
// that nothing is unwrapped before adminViewed commits, or at all when it fails.
const seen = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock("../../src/keys/request-keys", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/keys/request-keys")>();
  return {
    ...m,
    unwrapRequestKey: (...a: Parameters<typeof m.unwrapRequestKey>) => {
      seen.order.push("unwrap");
      return m.unwrapRequestKey(...a);
    },
  };
});

const FLAGS_OFF = resolve(import.meta.dirname, "../../../config/test/flags-off.json");
const PASSWORD = "correct-horse-battery-1";
const PLATE = "ZZ-0001";
const UNKNOWN = "01890000-0000-7000-8000-000000000001";
const ROLES: readonly Role[] = ["admin", "implementer", "trainingOfficer"];

async function setup(o: { siteConfig?: string } = {}) {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
    ...(o.siteConfig ? { env: { SITE_CONFIG: o.siteConfig } } : {}),
  });
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const name of ["owner", "user", ...ROLES]) {
    const email = `${name.toLowerCase()}@example.test`;
    ids[name] = await t.createUser(email, PASSWORD);
    if ((ROLES as readonly string[]).includes(name))
      await grantRole(t.deps, { email, role: name as Role, change: "granted" });
    cookies[name] = await t.cookieFor(email, PASSWORD);
  }
  const { configHash } = t.deps.config.current();
  const r = await t.request("/api/v1/queries", {
    method: "POST",
    headers: {
      cookie: cookies.owner ?? "",
      "content-type": "application/json",
      "x-requested-with": "querymodule",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      queryType: "VEH",
      values: { plate: PLATE, state: "TX" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
      configHash,
    }),
  });
  expect(r.status).toBe(202);
  const { correlationId } = SubmitQueryResponseSchema.parse(await r.json());
  await time.run(10_000);
  await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  const get = (id: string, who?: string, query = "") =>
    t.request(`/api/v1/admin/queries/${id}${query}`, {
      headers: who === undefined ? {} : { cookie: cookies[who] ?? "" },
    });
  async function read(id: string, query = ""): Promise<AdminQueryDetail> {
    const res = await get(id, "admin", query);
    expect(res.status).toBe(200);
    return AdminQueryDetailSchema.parse(await res.json());
  }
  const viewed = () => t.auditRows("adminViewed");
  const principalOf = (name: string): Principal => ({
    userId: ids[name] ?? "",
    email: `${name.toLowerCase()}@example.test`,
    role: name === "admin" ? "admin" : "user",
    sessionId: uuidv7(t.clock.now()),
    identitySource: "local",
    authenticatedAt: t.clock.now(),
  });
  return { t, correlationId, cookies, ids, get, read, viewed, principalOf };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function errorCode(r: Response): Promise<string> {
  return ApiErrorSchema.parse(await r.json()).error.code;
}

/** One extra source_result row of the request's part 0 naming `credentialUserId` (mock ids). */
async function addCredentialRow(s: Setup, credentialUserId: string, delegationId: string | null) {
  const now = s.t.clock.now();
  await s.t.deps.db.insert(sourceResult).values({
    resultId: uuidv7(now),
    correlationId: s.correlationId,
    partId: 0,
    sourceId: delegationId === null ? "zzOwnCredential" : "zzDelegatedCredential",
    userId: s.ids.owner ?? "",
    status: "pending",
    credentialUserId,
    delegationId,
    adapterKind: "mock",
    createdAt: now,
  });
}

describe("GET /api/v1/admin/queries/:correlationId (FR-063, spec 5.1, 5.2; #713)", () => {
  it("an admin reads another user's settled ZZ-0001 request with values and payloads; one adminViewed", async () => {
    const s = await setup();
    const detail = await s.read(s.correlationId, "?includeHidden=true");
    expect(detail.correlationId).toBe(s.correlationId);
    const part = detail.parts[0];
    expect(part).toMatchObject({ partId: 0, purged: false, values: { plate: PLATE, state: "TX" } });
    expect(part?.sources.map((x) => [x.sourceId, x.status, x.purged, x.hidden])).toEqual([
      ["stateSource", "returned", false, false],
      ["nationalSource", "returned", false, false],
    ]);
    const opened = await openResults(s.t, s.correlationId);
    for (const src of part?.sources ?? [])
      expect(src.payload).toEqual(opened.find((o) => o.sourceId === src.sourceId)?.payload);
    expect(part?.sources[0]?.payload).toMatchObject({ plate: PLATE, status: "STOLEN" });

    const rows = await s.viewed();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(s.ids.admin);
    expect(rows[0]?.details).toEqual({
      correlationId: s.correlationId,
      viewerBasis: "admin",
      includeHidden: true,
    });
    const env = await s.t.deps.db.$client.execute(
      "SELECT correlation_id, actor_role, credential_user_id FROM audit_event WHERE type = 'adminViewed'",
    );
    expect(env.rows.map((x) => [x.correlation_id, x.actor_role, x.credential_user_id])).toEqual([
      [s.correlationId, "admin", null],
    ]);
  });

  it("includeHidden is recorded as sent: false and absent both record false", async () => {
    const s = await setup();
    await s.read(s.correlationId, "?includeHidden=false");
    await s.read(s.correlationId);
    expect((await s.viewed()).map((v) => v.details.includeHidden)).toEqual([false, false]);
  });

  it("adminViewed commits before any DEK is unwrapped", async () => {
    const s = await setup();
    // Mark at COMMIT, not at record: the audit write runs inside the transaction, so a mark at
    // record would still pass if the unwrap moved into the same transaction (#755 T5 Q1).
    const transaction = s.t.deps.db.transaction.bind(s.t.deps.db) as (
      ...a: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(s.t.deps.db, "transaction").mockImplementation((async (...a: unknown[]) => {
      const out = await transaction(...a);
      seen.order.push("committed");
      return out;
    }) as typeof s.t.deps.db.transaction);
    seen.order.length = 0;
    await s.read(s.correlationId);
    const committed = seen.order.indexOf("committed");
    const firstUnwrap = seen.order.indexOf("unwrap");
    expect(committed).toBeGreaterThanOrEqual(0);
    expect(firstUnwrap).toBeGreaterThan(committed);
  });

  it("an unknown id is 404 and a malformed id 400, each with no row", async () => {
    const s = await setup();
    const unknown = await s.get(UNKNOWN, "admin");
    expect(unknown.status).toBe(404);
    expect(await errorCode(unknown)).toBe("notFound");
    const malformed = await s.get("not-a-uuid", "admin");
    expect(malformed.status).toBe(400);
    expect(await errorCode(malformed)).toBe("validationFailed");
    expect(await s.viewed()).toEqual([]);
  });

  it.each(["?includeHidden=yes", "?includeHidden=", "?zzUnknown=1"])(
    "%s is 400 validationFailed with no row",
    async (query) => {
      const s = await setup();
      const r = await s.get(s.correlationId, "admin", query);
      expect(r.status).toBe(400);
      expect(await errorCode(r)).toBe("validationFailed");
      expect(await s.viewed()).toEqual([]);
    },
  );

  it("an audit write that fails answers 500 internal, unwraps nothing, returns nothing", async () => {
    const s = await setup();
    const record = s.t.deps.audit.record.bind(s.t.deps.audit);
    vi.spyOn(s.t.deps.audit, "record").mockImplementation((tx, e) =>
      e.type === "adminViewed" ? Promise.reject(new Error("audit down")) : record(tx, e),
    );
    seen.order.length = 0;
    const r = await s.get(s.correlationId, "admin");
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = await r.text();
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["error"]);
    expect(ApiErrorSchema.parse(JSON.parse(text)).error.code).toBe("internal");
    expect(text).not.toContain(PLATE);
    expect(seen.order).toEqual([]);
    expect(await s.viewed()).toEqual([]);
    const failed = s.t.logLines.filter((l) => l.includes("admin query read failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain('"stage":"audit"');
    expect(failed[0]).not.toContain("audit down");
  });

  it("with the request_key rows deleted the read is 200 purged: true and still writes one row", async () => {
    const s = await setup();
    await s.t.deps.db.$client.execute("DELETE FROM request_key");
    const part = (await s.read(s.correlationId)).parts[0];
    expect(part?.purged).toBe(true);
    expect(part).not.toHaveProperty("values");
    for (const src of part?.sources ?? []) {
      expect(src).toMatchObject({ status: "returned", purged: true, hidden: false });
      expect(src).not.toHaveProperty("payload");
    }
    expect(await s.viewed()).toHaveLength(1);
  });

  it("the owner's GET /api/v1/queries/:id still writes no adminViewed", async () => {
    const s = await setup();
    const r = await s.t.request(`/api/v1/queries/${s.correlationId}`, {
      headers: { cookie: s.cookies.owner ?? "" },
    });
    expect(r.status).toBe(200);
    expect(await s.viewed()).toEqual([]);
  });

  it("no log line carries a value or a payload", async () => {
    const s = await setup();
    await s.read(s.correlationId, "?includeHidden=true");
    const logs = s.t.logLines.join("\n");
    expect(logs).toContain("/api/v1/admin/queries/");
    for (const v of [PLATE, "STOLEN", "TESTERSON"]) expect(logs.includes(v), v).toBe(false);
  });

  it("a host admin's adminViewed carries identitySource host and its hostSubject", async () => {
    const s = await setup();
    const resolveGated = s.t.deps.identity.resolveGated.bind(s.t.deps.identity);
    vi.spyOn(s.t.deps.identity, "resolveGated").mockImplementation(async (req) => {
      const g = await resolveGated(req);
      return (
        g && {
          ...g,
          principal: { ...g.principal, identitySource: "host", hostSubject: "zz-host-subject-01" },
        }
      );
    });
    await s.read(s.correlationId);
    const rows = await s.t.deps.db.$client.execute(
      "SELECT identity_source, host_subject FROM audit_event WHERE type = 'adminViewed'",
    );
    expect(rows.rows.map((x) => [x.identity_source, x.host_subject])).toEqual([
      ["host", "zz-host-subject-01"],
    ]);
  });
});

describe("ADR-0011 item 6 GET /api/v1/admin/queries/:correlationId access", () => {
  it("implementer, trainingOfficer, user and the owner 403 forbidden; anonymous 401; no row", async () => {
    const s = await setup();
    const want = {
      implementer: [403, "forbidden"],
      trainingOfficer: [403, "forbidden"],
      user: [403, "forbidden"],
      owner: [403, "forbidden"],
    } as const;
    for (const [who, [status, code]] of Object.entries(want)) {
      const r = await s.get(s.correlationId, who);
      expect(r.status, who).toBe(status);
      expect(r.headers.get("cache-control"), who).toBe("no-store");
      expect(await errorCode(r), who).toBe(code);
    }
    const anon = await s.get(s.correlationId);
    expect(anon.status).toBe(401);
    expect(await errorCode(anon)).toBe("unauthenticated");
    expect(await s.viewed()).toEqual([]);
  }, 30_000);

  it("a user who still holds a temporary password gets 403 passwordChangeRequired", async () => {
    const s = await setup();
    const created = await s.t.request("/api/v1/admin/users", {
      method: "POST",
      headers: {
        cookie: s.cookies.admin ?? "",
        "content-type": "application/json",
        "x-requested-with": "querymodule",
      },
      body: JSON.stringify({ email: "fresh-query@example.test", name: "Fresh", role: "admin" }),
    });
    const { temporaryPassword } = CreateUserResponseSchema.parse(await created.json());
    const cookie = await s.t.cookieFor("fresh-query@example.test", temporaryPassword);
    const r = await s.t.request(`/api/v1/admin/queries/${s.correlationId}`, {
      headers: { cookie },
    });
    expect(r.status).toBe(403);
    expect(await errorCode(r)).toBe("passwordChangeRequired");
    expect(await s.viewed()).toEqual([]);
  });

  it("adminAudit off: an admin and anonymous get 404 notFound", async () => {
    const s = await setup({ siteConfig: FLAGS_OFF });
    for (const who of ["admin", undefined]) {
      const r = await s.get(s.correlationId, who);
      expect(r.status, who).toBe(404);
      expect(await errorCode(r), who).toBe("notFound");
    }
    expect(await s.viewed()).toEqual([]);
  });
});

describe("recordAdminViewed with basis credentialOwner (#561 binding box)", () => {
  const credentialView = (s: Setup, name: string) =>
    withTransaction(s.t.deps.db, (tx) =>
      recordAdminViewed(
        tx,
        s.t.deps,
        s.principalOf(name),
        s.correlationId,
        false,
        "credentialOwner",
      ),
    );

  it("throws and writes nothing for a principal that holds no credential row of the request", async () => {
    const s = await setup();
    await expect(credentialView(s, "user")).rejects.toThrow();
    expect(await s.viewed()).toEqual([]);
  });

  it("throws and writes nothing for an own-credential row (delegation_id null)", async () => {
    const s = await setup();
    await addCredentialRow(s, s.ids.user ?? "", null);
    await expect(credentialView(s, "user")).rejects.toThrow();
    expect(await s.viewed()).toEqual([]);
  });

  it("writes one row for a delegated row", async () => {
    const s = await setup();
    await addCredentialRow(s, s.ids.user ?? "", "zz-delegation-01");
    await credentialView(s, "user");
    const rows = await s.viewed();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(s.ids.user);
    expect(rows[0]?.details).toEqual({
      correlationId: s.correlationId,
      viewerBasis: "credentialOwner",
      includeHidden: false,
    });
  });
});
