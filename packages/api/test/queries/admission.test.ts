import { ApiErrorSchema, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { requireSession } from "../../src/http/session";
import type { AppEnv } from "../../src/http/types";
import {
  admitSubmit,
  MAX_VALUE_BYTES,
  QUERY_LIMIT,
  replayResponse,
} from "../../src/queries/admission";
import { createTestApp, type TestApp } from "../helpers/test-app";

const PASSWORD = "correct-horse-battery-1";
const KEY = "admission-key-0000000001";
const CID = "01890a5d-ac96-774b-bcce-b302099a8057";
const CID_SKIP = "01890a5d-ac96-774b-bcce-b302099a8059";
const ACK_AT = 1_790_000_000_123;

/** The assembled app plus a stub POST /api/v1/queries that answers 299 for `admit`. */
async function stubApp(): Promise<{
  t: TestApp;
  userId: string;
  post: (o?: Post) => Promise<Response>;
}> {
  const t = await createTestApp();
  const sub = new Hono<AppEnv>();
  sub.post("/", requireSession(t.deps.identity), async (c) => {
    const a = await admitSubmit(c, t.deps);
    if (a.kind === "reject") return a.response;
    if (a.kind === "replay") return c.json(a.body, 202);
    expect(a.idempotencyKey).toBe(c.req.header("idempotency-key"));
    expect(typeof a.receivedAt).toBe("number");
    expect(typeof a.receivedMono).toBe("number");
    return new Response(JSON.stringify({ raw: a.raw }), { status: 299 });
  });
  // Mount before the first request: Hono builds its matcher on first match.
  t.app.route("/api/v1/queries", sub);
  const userId = await t.createUser("dispatcher@example.test", PASSWORD);
  const cookie = await t.cookieFor("dispatcher@example.test", PASSWORD);
  const post = (o: Post = {}) =>
    t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie: o.cookie ?? cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        ...(o.key === null ? {} : { "idempotency-key": o.key ?? KEY }),
      },
      body: o.rawBody ?? JSON.stringify("body" in o ? o.body : { values: { plate: "ZZ-0001" } }),
    });
  return { t, userId, post };
}
interface Post {
  key?: string | null;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
}

async function errorOf(r: Response) {
  return ApiErrorSchema.parse(await r.json()).error;
}

interface SeedPart {
  partId: number;
  queryType: string;
  selected: string[];
  dropped: string[];
  results: string[];
  skipped?: boolean;
}

async function seed(
  db: Db,
  o: { userId: string; cid: string; key: string; parts: SeedPart[]; ack: boolean },
): Promise<void> {
  // Plain INSERTs: 0005 refuses REPLACE on query_request and source_result.
  for (const p of o.parts) {
    await db.$client.execute({
      sql: `INSERT INTO query_request (correlation_id, part_id, user_id, parent_part_id, origin, query_type,
        type_values, plate_only, selected_source_ids, dropped_source_ids, skipped_reason, config_hash,
        idempotency_key, submitted_at) VALUES (?, ?, ?, ?, ?, ?, '{}', 0, ?, ?, ?, 'h1', ?, 1)`,
      args: [
        o.cid,
        p.partId,
        o.userId,
        p.partId === 0 ? null : 0,
        p.partId === 0 ? "primary" : "alsoRun",
        p.queryType,
        JSON.stringify(p.selected),
        JSON.stringify(p.dropped),
        p.skipped ? JSON.stringify([{ key: "validation.required" }]) : null,
        p.partId === 0 ? o.key : null,
      ],
    });
    // Reverse insert order, so the replay must order sources by the part's selection.
    for (const [i, sourceId] of [...p.results].reverse().entries()) {
      await db.$client.execute({
        sql: `INSERT INTO source_result (result_id, correlation_id, part_id, source_id, user_id, status,
          adapter_kind, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 'mock', 1)`,
        args: [`${o.cid.slice(0, -4)}${p.partId}${i}00`, o.cid, p.partId, sourceId, o.userId],
      });
    }
  }
  if (o.ack) {
    await db.$client.execute({
      sql: `INSERT INTO audit_event (type, at, correlation_id, actor_user_id, actor_role, identity_source,
        details) VALUES ('acknowledged', ?, ?, ?, 'user', 'local', ?)`,
      args: [
        ACK_AT + 5,
        o.cid,
        o.userId,
        JSON.stringify({ acknowledgedAt: ACK_AT, ackLatencyMs: 3, partCount: o.parts.length }),
      ],
    });
  }
}

const TWO_SOURCES: SeedPart = {
  partId: 0,
  queryType: "VEH",
  selected: ["stateSource", "nationalSource"],
  dropped: [],
  results: ["stateSource", "nationalSource"],
};

describe("FR-064 NFR-002 submit admission (spec 5.2 step 1)", () => {
  it("exports the spec limits", () => {
    expect(QUERY_LIMIT).toEqual({ limit: 30, windowMs: 60_000 });
    expect(MAX_VALUE_BYTES).toBe(4096);
  });

  it("400s a missing Idempotency-Key with validation.idempotencyKey", async () => {
    const { post } = await stubApp();
    const r = await post({ key: null });
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: "validation.idempotencyKey" }]);
  });

  it("400s a key that does not match IdempotencyKeySchema", async () => {
    const { post } = await stubApp();
    const r = await post({ key: "short" });
    expect(r.status).toBe(400);
    expect((await errorOf(r)).errors).toEqual([{ key: "validation.idempotencyKey" }]);
  });

  it("400s malformed JSON with validation.invalidBody", async () => {
    const { post } = await stubApp();
    const r = await post({ rawBody: "{not json" });
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: "validation.invalidBody" }]);
  });

  it("413s a value over 4096 UTF-8 bytes and admits one of exactly 4096", async () => {
    const { t, post } = await stubApp();
    const over = await post({ body: { values: { name: "a".repeat(4097) } } });
    expect(over.status).toBe(413);
    expect((await errorOf(over)).code).toBe("payloadTooLarge");
    const at = await post({ body: { values: { name: "a".repeat(4096) } } });
    expect(at.status).toBe(299);
    expect(t.logLines.join("\n")).not.toContain("aaaa");
  });

  it("counts bytes, not characters: 1500 three-byte characters (4500 bytes) is 413", async () => {
    const { post } = await stubApp();
    const r = await post({ body: { values: { name: "€".repeat(1500) } } });
    expect(r.status).toBe(413);
    expect((await errorOf(r)).code).toBe("payloadTooLarge");
  });

  it("reads only values string lengths: other shapes are admitted for later validation", async () => {
    const { post } = await stubApp();
    for (const body of [
      null,
      [],
      "text",
      { values: "x" },
      { values: null },
      { values: { n: 5, b: true } },
    ]) {
      const r = await post({ body });
      expect(r.status).toBe(299);
      expect(await r.json()).toEqual({ raw: body });
    }
  });

  it("429s the 31st request in a minute with Retry-After, and resets after the window", async () => {
    const { t, post } = await stubApp();
    for (let i = 0; i < QUERY_LIMIT.limit; i++) expect((await post()).status).toBe(299);
    const r = await post();
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("60");
    expect((await errorOf(r)).code).toBe("rateLimited");
    t.clock.advance(60_000);
    expect((await post()).status).toBe(299);
  });

  it("limits per user: another user's window is separate", async () => {
    const { t, post } = await stubApp();
    for (let i = 0; i <= QUERY_LIMIT.limit; i++) await post();
    expect((await post()).status).toBe(429);
    await t.createUser("records@example.test", PASSWORD);
    const cookie = await t.cookieFor("records@example.test", PASSWORD);
    expect((await post({ cookie })).status).toBe(299);
  });
});

describe("FR-064 SEC-014 replayResponse", () => {
  it("rebuilds the original 202 from part, source_result and acknowledged rows", async () => {
    const { t, userId } = await stubApp();
    await seed(t.deps.db, { userId, cid: CID, key: KEY, parts: [TWO_SOURCES], ack: true });
    const body = await replayResponse(t.deps.db, userId, KEY);
    expect(body).toEqual({
      correlationId: CID,
      acknowledgedAt: ACK_AT,
      parts: [
        {
          partId: 0,
          queryType: "VEH",
          status: "dispatched",
          sourceIds: ["stateSource", "nationalSource"],
          droppedSourceIds: [],
        },
      ],
    });
    expect(SubmitQueryResponseSchema.safeParse(body).success).toBe(true);
  });

  it("marks a part with skipped_reason skipped with no sources, and keeps dropped sources", async () => {
    const { t, userId } = await stubApp();
    await seed(t.deps.db, {
      userId,
      cid: CID_SKIP,
      key: KEY,
      ack: true,
      parts: [
        {
          partId: 0,
          queryType: "VEH",
          selected: ["stateSource", "nationalSource"],
          dropped: ["nationalSource"],
          results: ["stateSource"],
        },
        {
          partId: 1,
          queryType: "WNT",
          selected: ["stateSource"],
          dropped: [],
          results: [],
          skipped: true,
        },
      ],
    });
    expect(await replayResponse(t.deps.db, userId, KEY)).toEqual({
      correlationId: CID_SKIP,
      acknowledgedAt: ACK_AT,
      parts: [
        {
          partId: 0,
          queryType: "VEH",
          status: "dispatched",
          sourceIds: ["stateSource"],
          droppedSourceIds: ["nationalSource"],
        },
        { partId: 1, queryType: "WNT", status: "skipped", sourceIds: [], droppedSourceIds: [] },
      ],
    });
  });

  it("does not find another user's key", async () => {
    const { t, userId, post } = await stubApp();
    await seed(t.deps.db, { userId, cid: CID, key: KEY, parts: [TWO_SOURCES], ack: true });
    const otherId = await t.createUser("records@example.test", PASSWORD);
    expect(await replayResponse(t.deps.db, otherId, KEY)).toBeNull();
    const cookie = await t.cookieFor("records@example.test", PASSWORD);
    expect((await post({ cookie })).status).toBe(299);
  });

  it("throws when the acknowledged row is missing (never a partial 202)", async () => {
    const { t, userId } = await stubApp();
    await seed(t.deps.db, { userId, cid: CID, key: KEY, parts: [TWO_SOURCES], ack: false });
    await expect(replayResponse(t.deps.db, userId, KEY)).rejects.toThrow(
      "replay: acknowledged audit row missing",
    );
  });

  it("answers the original 202 on a repeated key, through the per-user limiter", async () => {
    const { t, userId, post } = await stubApp();
    await seed(t.deps.db, { userId, cid: CID, key: KEY, parts: [TWO_SOURCES], ack: true });
    const expected = await replayResponse(t.deps.db, userId, KEY);
    for (let i = 0; i < QUERY_LIMIT.limit; i++) {
      const r = await post({ body: { values: { plate: "ZZ-0002" } } });
      expect(r.status).toBe(202);
      expect(await r.json()).toEqual(expected);
    }
    expect((await post()).status).toBe(429);
  });
});
