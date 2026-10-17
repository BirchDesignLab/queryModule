import type { SiteConfig } from "@querymodule/core/config";
import {
  ApiErrorSchema,
  QueryDetailSchema,
  type QueryListResponse,
  QueryListResponseSchema,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryRequest } from "../../src/db/schema";
import { uuidv7 } from "../../src/ids";
import { captureLogger } from "../helpers/fixture";
import { manualTime } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

/*
 * GET /api/v1/queries, the caller's requests newest first, cursor paged (spec 5.1, 6.7; FR-043,
 * FR-065; #561, #589). Mock data only: ZZ-0001 is the shipped mock's scenario plate (spec 5.4,
 * 10.8).
 */

// A pass-through spy on unwrapRequestKey: the list opens nothing, so it must never unwrap a DEK.
const unwraps = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../src/keys/request-keys", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/keys/request-keys")>();
  return {
    ...m,
    unwrapRequestKey: (...a: Parameters<typeof m.unwrapRequestKey>) => {
      unwraps.n += 1;
      return m.unwrapRequestKey(...a);
    },
  };
});

const PASSWORD = "correct-horse-battery-1";
const PLATE = "ZZ-0001";

async function setup(o: { site?: (c: SiteConfig) => void } = {}) {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  if (o.site) {
    const siteConfig = structuredClone(t.deps.config.current().siteConfig);
    o.site(siteConfig);
    t.deps.config.swap({ ...t.deps.config.current(), siteConfig });
  }
  await t.createUser("reader-a@example.test", PASSWORD);
  await t.createUser("reader-b@example.test", PASSWORD);
  const cookieA = await t.cookieFor("reader-a@example.test", PASSWORD);
  const cookieB = await t.cookieFor("reader-b@example.test", PASSWORD);
  const { configHash } = t.deps.config.current();
  async function submit(
    cookie: string,
    query: Record<string, unknown> = {
      queryType: "VEH",
      values: { plate: PLATE, state: "TX" },
    },
  ): Promise<string> {
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        ...query,
        sourceIds: ["stateSource", "nationalSource"],
        mode: "normal",
        configHash,
      }),
    });
    expect(r.status).toBe(202);
    return SubmitQueryResponseSchema.parse(await r.json()).correlationId;
  }
  /** Lets every adapter answer and T2 commit (the mock's maximum latency is 800 ms). */
  async function settleAll() {
    await time.run(10_000);
    await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  }
  const get = (query: string, cookie = cookieA) =>
    t.request(`/api/v1/queries${query}`, { headers: { cookie } });
  async function list(query = "", cookie = cookieA): Promise<QueryListResponse> {
    const r = await get(query, cookie);
    expect(r.status).toBe(200);
    return QueryListResponseSchema.parse(await r.json());
  }
  return { t, time, cookieA, cookieB, submit, settleAll, get, list };
}

/** Three submits by A one second apart and one by B; returns A's ids oldest first. */
async function seeded() {
  const s = await setup();
  const a: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    a.push(await s.submit(s.cookieA));
    s.time.clock.advance(1000);
  }
  const b = await s.submit(s.cookieB);
  await s.settleAll();
  return { ...s, a, b };
}

beforeEach(() => {
  unwraps.n = 0;
});

describe("GET /api/v1/queries, the caller's list (spec 5.1; #561, #589)", () => {
  it("lists only the caller's requests, newest first, with no-store", async () => {
    const { get, list, a, b, cookieB } = await seeded();
    const r = await get("");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const page = await list();
    expect(page.requests.map((q) => q.correlationId)).toEqual([...a].reverse());
    expect(page.nextCursor).toBeNull();
    expect(page.requests.map((q) => q.correlationId)).not.toContain(b);
    const other = await list("", cookieB);
    expect(other.requests.map((q) => q.correlationId)).toEqual([b]);
  });

  it("items carry parts with per-source status and typeValues, never values or payloads", async () => {
    const { list, t } = await seeded();
    const page = await list();
    for (const item of page.requests) {
      expect(item.configHash).toBe(t.deps.config.current().configHash);
      expect(item.parts).toHaveLength(1);
      const part = item.parts[0];
      expect(part).toMatchObject({
        partId: 0,
        parentPartId: null,
        origin: "primary",
        queryType: "VEH",
        plateOnly: false,
        skipReasons: [],
        droppedSourceIds: [],
        purged: false,
      });
      expect(part).toHaveProperty("typeValues");
      expect(part).not.toHaveProperty("values");
      expect(part?.sources.map((s) => [s.sourceId, s.status])).toEqual([
        ["stateSource", "returned"],
        ["nationalSource", "returned"],
      ]);
      for (const s of part?.sources ?? []) expect(s).not.toHaveProperty("payload");
    }
    const body = JSON.stringify(page);
    expect(body).not.toContain(PLATE);
    expect(body).not.toContain("STOLEN");
  });

  it("a caller with no requests gets an empty list", async () => {
    const { list } = await setup();
    expect(await list()).toEqual({ requests: [], nextCursor: null });
  });

  it("a skipped part carries its skipReasons (#576)", async () => {
    const s = await setup({
      site: (c) => {
        const dob = c.queryTypes.find((q) => q.code === "WNT")?.fields.find((f) => f.key === "dob");
        if (!dob) throw new Error("WNT dob missing");
        dob.required = true;
      },
    });
    await s.submit(s.cookieA, { queryType: "PER", values: { last: "TESTERSON" } });
    await s.settleAll();
    const parts = (await s.list()).requests[0]?.parts ?? [];
    expect(parts.map((p) => [p.partId, p.parentPartId, p.origin, p.queryType])).toEqual([
      [0, null, "primary", "PER"],
      [1, 0, "alsoRun", "WNT"],
    ]);
    expect(parts[1]).toMatchObject({
      skipReasons: [{ key: "validation.required", params: { field: "dob" } }],
      purged: false,
      sources: [],
    });
    expect(JSON.stringify(parts)).not.toContain("TESTERSON");
  });

  it("after the request keys are shredded the items answer purged: true", async () => {
    const { t, list } = await seeded();
    await t.deps.db.$client.execute("DELETE FROM request_key");
    for (const item of (await list()).requests) {
      expect(item.parts[0]?.purged).toBe(true);
      for (const src of item.parts[0]?.sources ?? []) expect(src.purged).toBe(true);
    }
  });

  it("each request_key scope purges on its own: payload only, then values only (AW2 review C-m2)", async () => {
    const { t, a, list } = await seeded();
    const shred = (correlationId: string, scope: "values" | "payload") =>
      t.deps.db.$client.execute({
        sql: "DELETE FROM request_key WHERE correlation_id = ? AND scope = ?",
        args: [correlationId, scope],
      });
    const [oldest, middle] = a;
    if (oldest === undefined || middle === undefined) throw new Error("seed");
    await shred(oldest, "payload");
    await shred(middle, "values");
    const items = (await list()).requests;
    const byId = (id: string) => items.find((i) => i.correlationId === id)?.parts[0];
    expect(byId(oldest)?.purged).toBe(false);
    for (const src of byId(oldest)?.sources ?? []) expect(src.purged).toBe(true);
    expect(byId(middle)?.purged).toBe(true);
    for (const src of byId(middle)?.sources ?? []) expect(src.purged).toBe(false);
  });

  it("each item's parts match the detail read without values and payloads (#623 Q1: one mapper)", async () => {
    const { t, a, b, list, get } = await seeded();
    const [oldest, middle] = a;
    if (oldest === undefined || middle === undefined) throw new Error("seed");
    await t.deps.db.$client.execute({
      sql: "DELETE FROM request_key WHERE correlation_id = ? AND scope = 'payload'",
      args: [oldest],
    });
    await t.deps.db.$client.execute({
      sql: "DELETE FROM request_key WHERE correlation_id = ? AND scope = 'values'",
      args: [middle],
    });
    const items = (await list()).requests;
    expect(items.map((i) => i.correlationId)).not.toContain(b);
    for (const item of items) {
      const r = await get(`/${item.correlationId}`);
      expect(r.status).toBe(200);
      const detail = QueryDetailSchema.parse(await r.json());
      const stripped = detail.parts.map(({ values: _v, sources, ...p }) => ({
        ...p,
        sources: sources.map(({ payload: _p, ...src }) => src),
      }));
      expect(item.parts).toEqual(stripped);
      expect(item.configHash).toBe(detail.configHash);
      expect(item.submittedAt).toBe(detail.submittedAt);
    }
  });

  it("limit defaults to 25 and limit=100 is accepted (AW2 review C-m3)", async () => {
    const s = await setup();
    for (let i = 0; i < 26; i += 1) {
      await s.submit(s.cookieA);
      s.time.clock.advance(1000);
    }
    await s.settleAll();
    const first = await s.list();
    expect(first.requests).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    const all = await s.list("?limit=100");
    expect(all.requests).toHaveLength(26);
    expect(all.nextCursor).toBeNull();
  });

  it("a stored row that does not parse is 500 internal, logging the error class only", async () => {
    const { t, get } = await seeded();
    const log = captureLogger();
    t.deps.logger = { ...log, addRedactKeys: () => undefined, child: () => t.deps.logger };
    // query_request is insert-once, so the bad row is a new request: dropped ids not a list
    const owner = await t.deps.db.$client.execute({
      sql: "SELECT id FROM user WHERE email = ?",
      args: ["reader-a@example.test"],
    });
    await t.deps.db.insert(queryRequest).values({
      correlationId: uuidv7(t.deps.clock.now()),
      partId: 0,
      userId: String(owner.rows[0]?.id),
      origin: "primary",
      queryType: "VEH",
      typeValues: {},
      plateOnly: 0,
      selectedSourceIds: [],
      droppedSourceIds: "x",
      configHash: "c".repeat(64),
      submittedAt: t.deps.clock.now(),
    });
    const r = await get("");
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
    expect(log.entries.filter((e) => e.level === "error")).toEqual([
      { level: "error", msg: "query list failed", f: { error: { name: "ZodError" } } },
    ]);
    expect(JSON.stringify(log.entries)).not.toContain(PLATE);
  });

  it("limit=2 pages to two, and nextCursor yields the third with nextCursor null", async () => {
    const { list, a } = await seeded();
    const first = await list("?limit=2");
    expect(first.requests.map((q) => q.correlationId)).toEqual([a[2], a[1]]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(`?limit=2&cursor=${first.nextCursor ?? ""}`);
    expect(second.requests.map((q) => q.correlationId)).toEqual([a[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it("requests submitted in the same millisecond page by correlation id, newest first", async () => {
    const s = await setup();
    const ids = [await s.submit(s.cookieA), await s.submit(s.cookieA), await s.submit(s.cookieA)];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: QueryListResponse = await s.list(
        `?limit=1${cursor === null ? "" : `&cursor=${cursor}`}`,
      );
      seen.push(...page.requests.map((q) => q.correlationId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([...ids].sort().reverse());
  });

  it.each([
    "?limit=101",
    "?limit=",
    "?limit=0",
    "?cursor=",
    "?cursor=not-a-cursor",
    "?cursor=a.b",
    `?cursor=${Buffer.from('{"submittedAt":-1,"correlationId":"x"}').toString("base64url")}`,
    "?other=1",
  ])("%s is 400 validationFailed", async (query) => {
    const { get } = await setup();
    const r = await get(query);
    expect(r.status).toBe(400);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("validationFailed");
  });

  it("the list never unwraps a DEK and writes no audit row", async () => {
    const { t, list, a } = await seeded();
    const audit = async () =>
      Number((await t.deps.db.$client.execute("SELECT COUNT(*) AS n FROM audit_event")).rows[0]?.n);
    const before = await audit();
    unwraps.n = 0;
    await list();
    expect(unwraps.n).toBe(0);
    expect(await audit()).toBe(before);
    // the spy is live: the detail read does unwrap
    const r = await t.request(`/api/v1/queries/${a[0]}`, {
      headers: { cookie: await t.cookieFor("reader-a@example.test", PASSWORD) },
    });
    expect(r.status).toBe(200);
    expect(unwraps.n).toBeGreaterThan(0);
  });
});
