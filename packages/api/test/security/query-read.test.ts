import { ApiErrorSchema, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { seal } from "../../src/keys/aead";
import { payloadAad, type RequestKeyRow, unwrapRequestKey } from "../../src/keys/request-keys";
import { grantRole } from "../../src/ops/grant-role";
import { captureLogger, TEST_SECRETS } from "../helpers/fixture";
import { manualTime } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

/*
 * GET /api/v1/queries/:correlationId behind the access policy (spec 5.2, SEC-014; #561): only the
 * owner reads; anyone else, an admin included, gets the same 404 notFound as an unknown id, never
 * 403. A decrypt failure is 500 internal with no value or payload in the body or any log line
 * (spec 5.9). Mock data only: ZZ-0001 is the shipped mock's scenario value (spec 5.4, 10.8).
 */
const PASSWORD = "correct-horse-battery-1";
const PLATE = "ZZ-0001";
const UNKNOWN = "01890000-0000-7000-8000-000000000001";

async function setup() {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  const cookies: Record<string, string> = {};
  for (const name of ["owner", "other", "admin"]) {
    const email = `${name}@example.test`;
    await t.createUser(email, PASSWORD);
    if (name === "admin") await grantRole(t.deps, { email, role: "admin", change: "granted" });
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
  const get = (id: string, who?: string) =>
    t.request(`/api/v1/queries/${id}`, {
      headers: who === undefined ? {} : { cookie: cookies[who] ?? "" },
    });
  return { t, correlationId, get };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/**
 * Reads as the owner after `corrupt` and expects 500 internal, one error line naming the class and
 * the id only, and no value or payload in the body or any log line (spec 5.9).
 */
async function expectInternal(s: Setup, errorName: string, corrupt: () => Promise<void>) {
  const { t, correlationId, get } = s;
  // records each call's raw fields, before the root logger's redaction
  const log = captureLogger();
  t.deps.logger = { ...log, addRedactKeys: () => undefined, child: () => t.deps.logger };
  await corrupt();
  const r = await get(correlationId, "owner");
  expect(r.status).toBe(500);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const text = await r.text();
  expect(ApiErrorSchema.parse(JSON.parse(text)).error.code).toBe("internal");
  expect(log.entries.filter((e) => e.level === "error")).toEqual([
    { level: "error", msg: "query read failed", f: { correlationId, error: { name: errorName } } },
  ]);
  const logged = JSON.stringify(log.entries) + t.logLines.join("\n");
  for (const secret of [PLATE, "STOLEN", "TESTERSON"]) {
    expect(text).not.toContain(secret);
    expect(logged).not.toContain(secret);
  }
}

/** Replaces the stateSource payload with `plaintext` sealed under the request's real payload DEK. */
async function resealPayload(s: Setup, plaintext: string) {
  const db = s.t.deps.db.$client;
  const key = (
    await db.execute({
      sql: "SELECT * FROM request_key WHERE correlation_id = ? AND scope = 'payload'",
      args: [s.correlationId],
    })
  ).rows[0];
  const row = (
    await db.execute({
      sql: "SELECT result_id FROM source_result WHERE correlation_id = ? AND source_id = 'stateSource'",
      args: [s.correlationId],
    })
  ).rows[0];
  if (!key || !row) throw new Error("setup: payload key or stateSource row missing");
  const keyRow: RequestKeyRow = {
    correlationId: s.correlationId,
    scope: "payload",
    wrappedDek: Buffer.from(key.wrapped_dek as ArrayBuffer),
    iv: Buffer.from(key.iv as ArrayBuffer),
    authTag: Buffer.from(key.auth_tag as ArrayBuffer),
    keyVersion: Number(key.key_version),
    createdAt: Number(key.created_at),
  };
  const dek = unwrapRequestKey(TEST_SECRETS.dataKey, keyRow);
  const sealed = seal(dek, Buffer.from(plaintext, "utf8"), payloadAad(String(row.result_id)));
  dek.fill(0);
  await db.execute("DROP TRIGGER source_result_write_once");
  await db.execute({
    sql: "UPDATE source_result SET payload_ciphertext = ?, payload_iv = ?, payload_tag = ? WHERE result_id = ?",
    args: [sealed.ciphertext, sealed.iv, sealed.tag, String(row.result_id)],
  });
}

/** The error body without its per-request requestId, for comparing two 404s. */
async function errorBody(r: Response) {
  const { requestId: _r, ...rest } = ApiErrorSchema.parse(await r.json()).error;
  return rest;
}

describe("GET /api/v1/queries/:correlationId access (spec 5.2, SEC-014; #561)", () => {
  it("another user and an admin get the same 404 notFound as an unknown id, never 403", async () => {
    const { correlationId, get } = await setup();
    const unknown = await get(UNKNOWN, "other");
    expect(unknown.status).toBe(404);
    const want = await errorBody(unknown);
    expect(want).toEqual({ code: "notFound" });
    for (const who of ["other", "admin"]) {
      const r = await get(correlationId, who);
      expect(r.status, who).toBe(404);
      expect(await errorBody(r), who).toEqual(want);
    }
    const malformed = await get("not-a-uuid", "owner");
    expect(malformed.status).toBe(404);
    expect(await errorBody(malformed)).toEqual(want);
    expect((await get(correlationId, "owner")).status).toBe(200);
  });

  it("no session is 401 unauthenticated", async () => {
    const { correlationId, get } = await setup();
    const r = await get(correlationId);
    expect(r.status).toBe(401);
    expect(await errorBody(r)).toEqual({ code: "unauthenticated" });
  });

  it("every answer carries Cache-Control: no-store", async () => {
    const { correlationId, get } = await setup();
    for (const [id, who] of [
      [correlationId, "owner"],
      [correlationId, "other"],
      [UNKNOWN, "owner"],
      [correlationId, undefined],
    ] as const) {
      const r = await get(id, who);
      expect(r.headers.get("cache-control"), `${who} ${r.status}`).toBe("no-store");
    }
  });

  it("a tampered payload ciphertext is 500 internal with no value or payload logged", async () => {
    const s = await setup();
    await expectInternal(s, "AeadError", async () => {
      // source_result is write-once (0004); the trigger goes so the test can corrupt the row
      await s.t.deps.db.$client.execute("DROP TRIGGER source_result_write_once");
      await s.t.deps.db.$client.execute({
        sql: "UPDATE source_result SET payload_ciphertext = zeroblob(length(payload_ciphertext)) WHERE correlation_id = ? AND source_id = 'stateSource'",
        args: [s.correlationId],
      });
    });
  });

  it("a part's sealed values missing their IV is 500 internal (QueryReadError)", async () => {
    const s = await setup();
    await expectInternal(s, "QueryReadError", async () => {
      // query_request is insert-once (0004); the trigger goes so the test can corrupt the row
      await s.t.deps.db.$client.execute("DROP TRIGGER query_request_no_update");
      await s.t.deps.db.$client.execute({
        sql: "UPDATE query_request SET values_iv = NULL WHERE correlation_id = ? AND part_id = 0",
        args: [s.correlationId],
      });
    });
  });

  it.each([
    ["is not JSON", `not json ${PLATE}`, "QueryReadError"],
    ["is not a JSON object", JSON.stringify([PLATE, "STOLEN"]), "ZodError"],
  ])("a payload that opens but %s is 500 internal", async (_label, plaintext, errorName) => {
    const s = await setup();
    await expectInternal(s, errorName, () => resealPayload(s, plaintext));
  });
});
