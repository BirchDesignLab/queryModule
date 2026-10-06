import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ConfigLoadError, loadSiteConfig } from "../../src/config/load";
import { auditEvent, sourceResult } from "../../src/db/schema";
import { manualTime } from "../helpers/manual-time";
import { removeTempDirs } from "../helpers/temp-dirs";
import { createTestApp } from "../helpers/test-app";

// Spec 10.3 "Mock gate", 5.4 Kind (SEC-006, SEC-012): Source.kind is required with no default; a
// mock kind needs ALLOW_MOCK_SOURCES=true; the resolved kind is recorded on source_result and in
// sourceResponded. The startup refusals (a mock source from the file, and from a stored document,
// on a deploy without ALLOW_MOCK_SOURCES) are in test/startup.test.ts, which owns the startServer
// harness.
const bundled = resolve(import.meta.dirname, "../../../config");
const created: string[] = [];
afterAll(() => removeTempDirs(created.splice(0), "test/security/mock-gate"));

interface SiteJson {
  sources: { kind?: string }[];
}

/** A copy of the bundled config root whose default site's first source has no kind. */
function siteWithoutKind(): string {
  const d = mkdtempSync(join(tmpdir(), "qm-mockgate-"));
  created.push(d);
  for (const sub of ["sites", "locales", "mock"])
    cpSync(join(bundled, sub), join(d, sub), { recursive: true });
  const file = join(d, "sites/default.json");
  const site = JSON.parse(readFileSync(file, "utf8")) as SiteJson;
  delete site.sources[0]?.kind;
  writeFileSync(file, JSON.stringify(site));
  return file;
}

describe("spec 10.3 mock gate (SEC-006, spec 5.4 Kind)", () => {
  it("a source with no kind fails to load at the schema, not as an unknown kind", async () => {
    const file = siteWithoutKind();
    const e = await loadSiteConfig(file, { allowMockSources: true, now: Date.UTC(2026, 9, 5) })
      .then(() => undefined)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConfigLoadError);
    expect(e).toMatchObject({ file, path: "/sources/0/kind", reason: "config.schema" });
  });

  it("adapter_kind is mock on source_result and in sourceResponded", async () => {
    const time = manualTime();
    const t = await createTestApp({
      clock: time.clock,
      timers: time.timers,
      monotonic: time.monotonic,
      random: () => 0,
    });
    const email = "mockgate@example.test";
    const password = "correct-horse-battery-1";
    await t.createUser(email, password);
    const cookie = await t.cookieFor(email, password);
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        queryType: "VEH",
        values: { plate: "ZZ-0001", state: "TX" },
        sourceIds: ["stateSource", "nationalSource"],
        mode: "normal",
        configHash: t.deps.config.current().configHash,
      }),
    });
    expect(r.status).toBe(202);
    const { correlationId } = SubmitQueryResponseSchema.parse(await r.json());

    // T1 records the kind on the pending rows, before any adapter answers
    const pending = await t.deps.db
      .select({ sourceId: sourceResult.sourceId, adapterKind: sourceResult.adapterKind })
      .from(sourceResult)
      .where(eq(sourceResult.correlationId, correlationId))
      .orderBy(asc(sourceResult.sourceId));
    expect(pending).toEqual([
      { sourceId: "nationalSource", adapterKind: "mock" },
      { sourceId: "stateSource", adapterKind: "mock" },
    ]);

    await time.run(100);
    await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
    const responded = await t.deps.db
      .select({ details: auditEvent.details })
      .from(auditEvent)
      .where(
        and(eq(auditEvent.correlationId, correlationId), eq(auditEvent.type, "sourceResponded")),
      )
      .orderBy(asc(auditEvent.id));
    expect(responded.map((a) => (a.details as { adapterKind?: unknown }).adapterKind)).toEqual([
      "mock",
      "mock",
    ]);
    const settled = await t.deps.db
      .select({ status: sourceResult.status, adapterKind: sourceResult.adapterKind })
      .from(sourceResult)
      .where(eq(sourceResult.correlationId, correlationId));
    expect(settled).toEqual([
      { status: "returned", adapterKind: "mock" },
      { status: "returned", adapterKind: "mock" },
    ]);
    expect(t.fatals).toEqual([]);
  });
});
