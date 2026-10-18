import {
  AdminAuditPageSchema,
  type AuditReadRow,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditEvent, sourceResult } from "../../src/db/schema";
import { grantRole } from "../../src/ops/grant-role";
import { manualTime } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

/*
 * Story A9 (spec 10.2; SEC-010, SEC-011; spec 4.7): a submit's query audit rows, read field by
 * field from audit_event, then read back through GET /api/v1/admin/audit?correlationId= so every
 * field survives the read shape. Mock data only: ZZ-0001 is the shipped mock's scenario plate
 * (spec 5.4, 10.8).
 */

const PASSWORD = "correct-horse-battery-1";
const OFFICER = "dispatcher@example.test";
const ADMIN = "admin@example.test";
const PLATE = "ZZ-0001";

const isEpochMs = (v: unknown) => Number.isInteger(v) && (v as number) > 0;

async function setup() {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  const userId = await t.createUser(OFFICER, PASSWORD);
  const adminId = await t.createUser(ADMIN, PASSWORD);
  await grantRole(t.deps, { email: ADMIN, role: "admin", change: "granted" });
  const officer = await t.cookieFor(OFFICER, PASSWORD);
  const admin = await t.cookieFor(ADMIN, PASSWORD);
  const served = (await (
    await t.request("/api/v1/config", { headers: { cookie: officer } })
  ).json()) as { configHash: string };
  const submitAt = t.clock.now();
  const r = await t.request("/api/v1/queries", {
    method: "POST",
    headers: {
      cookie: officer,
      "content-type": "application/json",
      "x-requested-with": "querymodule",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      queryType: "VEH",
      values: { plate: PLATE },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "plateOnly",
      configHash: served.configHash,
    }),
  });
  expect(r.status).toBe(202);
  const ack = SubmitQueryResponseSchema.parse(await r.json());
  await time.run(10_000);
  await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  const rows = await t.deps.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.correlationId, ack.correlationId))
    .orderBy(asc(auditEvent.id));
  const results = await t.deps.db
    .select()
    .from(sourceResult)
    .where(eq(sourceResult.correlationId, ack.correlationId));
  return { t, userId, adminId, admin, served, submitAt, ack, rows, results };
}

describe("[A9] query audit rows field by field (spec 10.2, 4.7; SEC-010, SEC-011)", () => {
  it("[A9] submitted, acknowledged, sourceDispatched and sourceResponded carry every field", async () => {
    const { userId, served, submitAt, ack, rows, results } = await setup();
    expect(rows.map((a) => a.type)).toEqual([
      "submitted",
      "sourceDispatched",
      "acknowledged",
      "sourceResponded",
    ]);
    for (const a of rows) {
      // actor snapshot on every row: id, email, role (SEC-010)
      expect(a.actorUserId).toBe(userId);
      expect(a.actorEmail).toBe(OFFICER);
      expect(a.actorRole).toBe("user");
      expect(a.identitySource).toBe("local");
      expect(isEpochMs(a.at), a.type).toBe(true);
    }
    const byType = (type: string) => rows.find((a) => a.type === type);
    const result = results[0];
    expect(results).toHaveLength(1);

    const submitted = byType("submitted");
    expect(submitted?.partId).toBe(0);
    expect(submitted?.at).toBe(submitAt);
    expect(submitted?.details).toEqual({
      partId: 0,
      parentPartId: null,
      origin: "primary",
      queryType: "VEH",
      typeValues: {},
      selectedSourceIds: ["stateSource", "nationalSource"],
      dispatchedSourceIds: ["stateSource"],
      droppedSourceIds: ["nationalSource"],
      plateOnly: true,
      configHash: served.configHash,
    });

    const acknowledged = byType("acknowledged");
    expect(acknowledged?.partId).toBeNull();
    const ackDetails = acknowledged?.details as Record<string, unknown>;
    expect(ackDetails.acknowledgedAt).toBe(ack.acknowledgedAt);
    expect(isEpochMs(ackDetails.acknowledgedAt)).toBe(true);
    expect(Number.isInteger(ackDetails.ackLatencyMs)).toBe(true);
    expect(ackDetails.ackLatencyMs as number).toBeGreaterThanOrEqual(0);
    expect(ackDetails.partCount).toBe(1);

    const dispatched = byType("sourceDispatched");
    expect(dispatched?.partId).toBe(0);
    expect(dispatched?.credentialUserId).toBeNull();
    expect(dispatched?.details).toEqual({
      partId: 0,
      sourceId: "stateSource",
      resultId: result?.resultId,
      credentialOwnerUserId: null,
      delegationId: null,
      adapterKind: "mock",
    });

    const responded = byType("sourceResponded");
    expect(responded?.partId).toBe(0);
    expect(responded?.credentialUserId).toBeNull();
    const respDetails = responded?.details as Record<string, unknown>;
    expect(respDetails).toMatchObject({
      partId: 0,
      sourceId: "stateSource",
      resultId: result?.resultId,
      status: "returned",
      credentialOwnerUserId: null,
      delegationId: null,
      adapterKind: "mock",
    });
    expect(Number.isInteger(respDetails.latencyMs)).toBe(true);
    expect(respDetails.latencyMs as number).toBeGreaterThanOrEqual(0);
    expect(isEpochMs(responded?.at)).toBe(true);
    expect(responded?.at as number).toBeGreaterThanOrEqual(submitAt);

    // No query value in any row (spec 4.7, 5.9).
    expect(JSON.stringify(rows)).not.toContain(PLATE);
  });

  it("[A9] every field survives GET /api/v1/admin/audit?correlationId=", async () => {
    const { t, admin, submitAt, ack, rows } = await setup();
    const qs = new URLSearchParams({
      correlationId: ack.correlationId,
      from: String(submitAt - 1000),
      to: String(t.clock.now() + 1000),
    });
    const res = await t.request(`/api/v1/admin/audit?${qs}`, { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const page = AdminAuditPageSchema.parse(await res.json());
    expect(page.nextCursor).toBeNull();
    // Newest first through the route; the auditViewed row is written after the read.
    const read = [...page.events].reverse();
    expect(read.map((e) => e.id)).toEqual(rows.map((a) => a.id));
    rows.forEach((a, i) => {
      const e = read[i] as AuditReadRow;
      expect(e).toEqual({
        id: a.id,
        type: a.type,
        at: a.at,
        correlationId: ack.correlationId,
        ...(a.partId === null ? {} : { partId: a.partId }),
        actor: { id: a.actorUserId, email: a.actorEmail, role: a.actorRole },
        identitySource: a.identitySource,
        details: a.details,
      });
    });
  });
});
