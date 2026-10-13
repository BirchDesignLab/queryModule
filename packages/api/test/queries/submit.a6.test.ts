import {
  ApiErrorSchema,
  type AuditEvent,
  parseAuditDetails,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvent, queryRequest } from "../../src/db/schema";
import type { Tx } from "../../src/db/tx";
import { createTestApp, type TestApp } from "../helpers/test-app";

/**
 * Story A6, API half (spec 5.2 steps 3 and 4, FR-043, FR-064, SEC-012): the 202 acknowledgment
 * carries the correlation id and acknowledgedAt only once transaction T1 has committed, and
 * acknowledgedAt is the acknowledged audit row's. Mock data only (generator scenario ZZ-0001).
 */
const PASSWORD = "correct-horse-battery-1";
const EMAIL = "dispatcher@example.test";
const PLATE = "ZZ-0001";

async function setup(): Promise<{ t: TestApp; post: () => Promise<Response> }> {
  const t = await createTestApp();
  await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const { configHash } = (await (
    await t.request("/api/v1/config", { headers: { cookie } })
  ).json()) as { configHash: string };
  const post = () =>
    t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        queryType: "VEH",
        values: { plate: PLATE },
        sourceIds: ["stateSource"],
        mode: "plateOnly",
        configHash,
      }),
    });
  return { t, post };
}

describe("[A6] submit acknowledgment carries the correlation id (FR-043, FR-064)", () => {
  it("[A6] the 202 carries correlationId and acknowledgedAt, and acknowledgedAt is the acknowledged audit row's", async () => {
    const { t, post } = await setup();
    const r = await post();
    expect(r.status).toBe(202);
    const ack = SubmitQueryResponseSchema.parse(await r.json());
    // committed: the part row and the acknowledged row are readable once the 202 is out
    const [part] = await t.deps.db
      .select({ correlationId: queryRequest.correlationId })
      .from(queryRequest)
      .where(eq(queryRequest.correlationId, ack.correlationId));
    expect(part?.correlationId).toBe(ack.correlationId);
    const [row] = await t.deps.db
      .select({ details: auditEvent.details })
      .from(auditEvent)
      .where(
        and(eq(auditEvent.correlationId, ack.correlationId), eq(auditEvent.type, "acknowledged")),
      );
    if (!row) throw new Error("acknowledged audit row missing");
    expect(parseAuditDetails("acknowledged", row.details).acknowledgedAt).toBe(ack.acknowledgedAt);
  });

  it("[A6] an audit stub that throws gives 500 and no 202: no correlationId, nothing committed (SEC-012)", async () => {
    const { t, post } = await setup();
    const record = t.deps.audit.record.bind(t.deps.audit);
    const seen: string[] = [];
    t.deps.audit.record = async (tx: Tx, e: AuditEvent) => {
      seen.push(e.type);
      if (e.type === "acknowledged") throw new Error("audit down");
      return record(tx, e);
    };
    const r = await post();
    expect(r.status).toBe(500);
    const body = (await r.json()) as Record<string, unknown>;
    expect(ApiErrorSchema.parse(body).error.code).toBe("internal");
    expect(body).not.toHaveProperty("correlationId");
    expect(body).not.toHaveProperty("acknowledgedAt");
    expect(seen).toContain("acknowledged");
    const count = async (sql: string) =>
      Number((await t.deps.db.$client.execute(sql)).rows[0]?.n ?? -1);
    expect(await count("SELECT COUNT(*) AS n FROM query_request")).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_event WHERE correlation_id IS NOT NULL"),
    ).toBe(0);
    for (const line of t.logLines) expect(line).not.toContain(PLATE);
  });
});
