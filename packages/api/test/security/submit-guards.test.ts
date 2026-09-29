import { ApiErrorSchema, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { queryRequest, requestKey } from "../../src/db/schema";
import { openPartValues, unwrapRequestKey } from "../../src/keys/request-keys";
import { TEST_SECRETS } from "../helpers/fixture";
import { createTestApp, type TestApp } from "../helpers/test-app";

// Spec 10.3 submit guards and the M1 exit security row (spec 12.7): SEC-006, SEC-014.
const PASSWORD = "correct-horse-battery-1";
const EMAIL = "dispatcher@example.test";
const PLATE = "ZZ-0001";

interface PostOpts {
  key?: string;
  headers?: Record<string, string>;
  rawBody?: string;
  cookie?: string | null;
}

async function setup() {
  const t = await createTestApp();
  await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const { configHash } = (await (
    await t.request("/api/v1/config", { headers: { cookie } })
  ).json()) as { configHash: string };
  const body = (over: Record<string, unknown> = {}) => ({
    queryType: "VEH",
    values: { plate: PLATE },
    sourceIds: ["stateSource", "nationalSource"],
    mode: "plateOnly",
    configHash,
    ...over,
  });
  const post = (b: Record<string, unknown>, o: PostOpts = {}) =>
    t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        ...(o.cookie === null ? {} : { cookie: o.cookie ?? cookie }),
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": o.key ?? crypto.randomUUID(),
        ...o.headers,
      },
      body: o.rawBody ?? JSON.stringify(b),
    });
  return { t, body, post, configHash };
}

async function counts(t: TestApp) {
  const n = async (sql: string) => Number((await t.deps.db.$client.execute(sql)).rows[0]?.n ?? -1);
  return {
    queryRequest: await n("SELECT COUNT(*) AS n FROM query_request"),
    sourceResult: await n("SELECT COUNT(*) AS n FROM source_result"),
    requestKey: await n("SELECT COUNT(*) AS n FROM request_key"),
    queryAudit: await n("SELECT COUNT(*) AS n FROM audit_event WHERE correlation_id IS NOT NULL"),
  };
}
const NONE = { queryRequest: 0, sourceResult: 0, requestKey: 0, queryAudit: 0 };

async function errorOf(r: Response) {
  return ApiErrorSchema.parse(await r.json()).error;
}

describe("POST /api/v1/queries guards (spec 10.3, SEC-006, SEC-014)", () => {
  it("a configHash mismatch is 409 with the current hash and writes nothing", async () => {
    const { t, post, body, configHash } = await setup();
    const r = await post(body({ configHash: "0".repeat(64) }));
    expect(r.status).toBe(409);
    const e = await errorOf(r);
    expect(e.code).toBe("configHashMismatch");
    expect(e.params).toEqual({ currentConfigHash: configHash });
    expect(await counts(t)).toEqual(NONE);
  });

  it("an unknown field key is 400 validation.unknownField and writes nothing", async () => {
    const { t, post, body } = await setup();
    const r = await post(body({ values: { plate: PLATE, colour: "ZZ" }, mode: "normal" }));
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toContainEqual({
      key: "validation.unknownField",
      params: { field: "colour" },
    });
    expect(await counts(t)).toEqual(NONE);
  });

  it("a posted mode that differs from the server's is 400 validation.modeMismatch", async () => {
    const { t, post, body } = await setup();
    const r = await post(body({ mode: "normal" }));
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: "validation.modeMismatch" }]);
    expect(await counts(t)).toEqual(NONE);
  });

  it("a hidden field's value (VEH plateType while State is TX) is absent from the stored values", async () => {
    const { t, post, body } = await setup();
    const r = await post(body({ values: { plate: PLATE, plateType: "PC" }, mode: "normal" }));
    expect(r.status).toBe(202);
    const { correlationId } = SubmitQueryResponseSchema.parse(await r.json());
    const [keyRow] = await t.deps.db
      .select()
      .from(requestKey)
      .where(eq(requestKey.correlationId, correlationId))
      .then((rows) => rows.filter((k) => k.scope === "values"));
    const [part] = await t.deps.db
      .select()
      .from(queryRequest)
      .where(eq(queryRequest.correlationId, correlationId));
    if (!keyRow || !part?.valuesCiphertext || !part.valuesIv || !part.valuesTag)
      throw new Error("sealed values missing");
    const values = openPartValues(
      unwrapRequestKey(TEST_SECRETS.dataKey, keyRow),
      correlationId,
      0,
      {
        ciphertext: part.valuesCiphertext,
        iv: part.valuesIv,
        tag: part.valuesTag,
      },
    );
    expect(values).toEqual({ plate: PLATE, state: "TX" });
    expect(values).not.toHaveProperty("plateType");
  });

  it("a replayed Idempotency-Key returns the original 202 and writes no new rows", async () => {
    const { t, post, body } = await setup();
    const key = crypto.randomUUID();
    const live = await post(body(), { key });
    expect(live.status).toBe(202);
    const liveText = await live.text();
    const before = await counts(t);
    expect(before).toEqual({ queryRequest: 1, sourceResult: 1, requestKey: 2, queryAudit: 3 });
    const replay = await post(body(), { key });
    expect(replay.status).toBe(202);
    expect(await replay.text()).toBe(liveText);
    expect(await counts(t)).toEqual(before);
  });

  it("no X-Requested-With is 403 forbidden and writes nothing", async () => {
    const { t, post, body } = await setup();
    const r = await post(body(), { headers: { "x-requested-with": "" } });
    expect(r.status).toBe(403);
    expect((await errorOf(r)).code).toBe("forbidden");
    expect(await counts(t)).toEqual(NONE);
  });

  it("no session is 401 unauthenticated and writes nothing", async () => {
    const { t, post, body } = await setup();
    const r = await post(body(), { cookie: null });
    expect(r.status).toBe(401);
    expect((await errorOf(r)).code).toBe("unauthenticated");
    expect(await counts(t)).toEqual(NONE);
  });

  it("a body over 32 KB is 413 payloadTooLarge and writes nothing", async () => {
    const { t, post, body } = await setup();
    const r = await post(body(), {
      rawBody: JSON.stringify({ ...body(), pad: "x".repeat(32 * 1024) }),
    });
    expect(r.status).toBe(413);
    expect((await errorOf(r)).code).toBe("payloadTooLarge");
    expect(await counts(t)).toEqual(NONE);
  });

  it("a value over 4 KB is 413 payloadTooLarge and writes nothing", async () => {
    const { t, post, body } = await setup();
    const r = await post(body({ values: { plate: "Z".repeat(4097) } }));
    expect(r.status).toBe(413);
    expect((await errorOf(r)).code).toBe("payloadTooLarge");
    expect(await counts(t)).toEqual(NONE);
  });
});
