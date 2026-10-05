import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ConfigDocument, type MockFile, MockFileSchema } from "@querymodule/core/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAdapter } from "../../src/adapters/mock";
import { createAdapterRegistry } from "../../src/adapters/registry";
import { type SourceAdapter, SourceError, type SourceRequest } from "../../src/adapters/types";
import { activate } from "../../src/admin/config/activate";
import {
  bootstrapDocument,
  configDirOf,
  type LoadedConfig,
  loadConfigDocument,
  loadSiteConfig,
} from "../../src/config/load";
import { systemTimers, type Timers } from "../../src/dispatch/timers";
import { uuidv7 } from "../../src/ids";
import { captureLogger } from "../helpers/fixture";
import { createTestApp } from "../helpers/test-app";

/*
 * Spec 5.4 (FR-043, FR-044; ADR-0011; #493): the mock adapter answers from the mock stored with
 * the pinned config snapshot, never from the image's mock file. Matching, latency and behaviours
 * per spec 5.4; a snapshot whose stored mock breaks the fixture policy fails closed.
 */

const BUNDLED = resolve(import.meta.dirname, "../../../config");
const DEFAULT_SITE = resolve(BUNDLED, "sites/default.json");
const DEFAULT_MOCK: MockFile = MockFileSchema.parse(
  JSON.parse(readFileSync(resolve(BUNDLED, "mock/default.json"), "utf8")),
);
const OPTS = { allowMockSources: true, now: Date.UTC(2026, 9, 5) };

function req(
  sourceId: string,
  queryType: string,
  values: SourceRequest["values"],
  types: SourceRequest["types"] = {},
): SourceRequest {
  return { correlationId: "corr-1", partId: 1, sourceId, queryType, values, types };
}

/** The promise's state after the timers advanced; never awaits an unsettled promise. */
function track<T>(p: Promise<T>) {
  const s: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    (v) => {
      s.settled = true;
      s.value = v;
    },
    (e: unknown) => {
      s.settled = true;
      s.error = e;
    },
  );
  return s;
}

const instantTimers: Timers = { ...systemTimers, sleep: async () => {} };

describe("createMockAdapter (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const adapter = (random = () => 0, mock: MockFile = DEFAULT_MOCK): SourceAdapter =>
    createMockAdapter({ mock, timers: systemTimers, random });

  it("ZZ-0001 on stateSource returns STOLEN after latencyMs[0]", async () => {
    const s = track(
      adapter().query(
        req("stateSource", "VEH", { plate: "ZZ-0001" }),
        null,
        new AbortController().signal,
      ),
    );
    await vi.advanceTimersByTimeAsync(49);
    expect(s.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.settled).toBe(true);
    expect(s.value).toMatchObject({ plate: "ZZ-0001", status: "STOLEN" });
  });

  it("latency is min + floor(random() * (max - min + 1)) ms", async () => {
    // stateSource latencyMs [50, 400]: 50 + floor(0.5 * 351) = 225.
    const s = track(
      adapter(() => 0.5).query(
        req("stateSource", "VEH", { plate: "ABC123" }),
        null,
        new AbortController().signal,
      ),
    );
    await vi.advanceTimersByTimeAsync(224);
    expect(s.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.settled).toBe(true);
    // random just under 1 gives max.
    const t = track(
      adapter(() => 0.999999).query(
        req("stateSource", "VEH", { plate: "ABC123" }),
        null,
        new AbortController().signal,
      ),
    );
    await vi.advanceTimersByTimeAsync(399);
    expect(t.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.settled).toBe(true);
  });

  it("ABC123 answers NO RECORD", async () => {
    const p = adapter().query(
      req("stateSource", "VEH", { plate: "ABC123" }),
      null,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toEqual({ status: "NO RECORD" });
  });

  it("an unmatched value answers the entry's default", async () => {
    const p = adapter().query(
      req("stateSource", "VEH", { plate: "ZZ-0002" }),
      null,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toEqual({ status: "NO RECORD" });
  });

  it("FAIL1 rejects with SourceError failed", async () => {
    const s = track(
      adapter().query(
        req("stateSource", "VEH", { plate: "FAIL1" }),
        null,
        new AbortController().signal,
      ),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(s.error).toBeInstanceOf(SourceError);
    expect((s.error as SourceError).code).toBe("failed");
  });

  it("credentialsRejected rejects with SourceError credentialsRejected", async () => {
    const mock = MockFileSchema.parse({
      siteId: "default",
      sources: {
        stateSource: {
          latencyMs: [0, 0],
          responses: [
            {
              queryType: "VEH",
              default: { status: "NO RECORD" },
              scenarios: [{ when: { plate: "DENY1" }, behavior: "credentialsRejected" }],
            },
          ],
        },
      },
    });
    const s = track(
      adapter(() => 0, mock).query(
        req("stateSource", "VEH", { plate: "DENY1" }),
        null,
        new AbortController().signal,
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(s.error).toBeInstanceOf(SourceError);
    expect((s.error as SourceError).code).toBe("credentialsRejected");
  });

  it("TIMEOUT on nationalSource never settles on its own and rejects AbortError on abort", async () => {
    const ac = new AbortController();
    const s = track(
      adapter().query(req("nationalSource", "VEH", { plate: "TIMEOUT" }), null, ac.signal),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.settled).toBe(true);
    expect((s.error as DOMException).name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an abort before the latency elapses rejects AbortError and clears its timer", async () => {
    const ac = new AbortController();
    const s = track(
      adapter().query(req("stateSource", "VEH", { plate: "ZZ-0001" }), null, ac.signal),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(1);
    ac.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect((s.error as DOMException).name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("WANTED on WNT answers WANTED; PER with last WANTED answers the PER default", async () => {
    const a = adapter();
    const wnt = a.query(
      req("nationalSource", "WNT", { last: "WANTED" }),
      null,
      new AbortController().signal,
    );
    const per = a.query(
      req("nationalSource", "PER", { last: "WANTED" }),
      null,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(wnt).resolves.toMatchObject({ status: "WANTED" });
    await expect(per).resolves.toEqual({ status: "NO RECORD" });
  });

  it("matches a when value against String() of a canonical number", async () => {
    const mock = MockFileSchema.parse({
      siteId: "default",
      sources: {
        s: {
          latencyMs: [0, 0],
          responses: [
            {
              queryType: "VEH",
              default: { status: "NO RECORD" },
              scenarios: [
                { when: { year: "1901", plate: "ZZ-0001" }, respond: { status: "BOTH" } },
                { when: { year: 1901 }, respond: { status: "YEAR" } },
              ],
            },
          ],
        },
      },
    });
    const p = adapter(() => 0, mock).query(
      req("s", "VEH", { year: 1901 }),
      null,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toEqual({ status: "YEAR" });
  });

  it("a types match beats a type-less entry; most matching types win; ties go by file order", async () => {
    const mock = MockFileSchema.parse({
      siteId: "default",
      sources: {
        s: {
          latencyMs: [0, 0],
          responses: [
            { queryType: "VEH", default: { status: "PLAIN" } },
            { queryType: "VEH", types: { plateType: "PC" }, default: { status: "PC" } },
            { queryType: "VEH", types: { plateColor: "RED" }, default: { status: "RED" } },
            {
              queryType: "VEH",
              types: { plateType: "PC", plateColor: "BLU" },
              default: { status: "PC-BLU" },
            },
            { queryType: "PER", default: { status: "PER" } },
          ],
        },
      },
    });
    const a = adapter(() => 0, mock);
    const ask = async (types: Record<string, string>) => {
      const p = a.query(
        req("s", "VEH", { plate: "ZZ-0001" }, types),
        null,
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(0);
      return p;
    };
    await expect(ask({})).resolves.toEqual({ status: "PLAIN" });
    await expect(ask({ plateType: "XX" })).resolves.toEqual({ status: "PLAIN" });
    await expect(ask({ plateType: "PC" })).resolves.toEqual({ status: "PC" });
    await expect(ask({ plateType: "PC", plateColor: "BLU" })).resolves.toEqual({
      status: "PC-BLU",
    });
    // PC and RED each match one type: the earlier entry wins.
    await expect(ask({ plateType: "PC", plateColor: "RED" })).resolves.toEqual({ status: "PC" });
  });

  it("returns a copy: changing an answer never changes the snapshot's mock", async () => {
    const a = adapter();
    const first = a.query(
      req("stateSource", "VEH", { plate: "ABC123" }),
      null,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(50);
    const v = await first;
    v.status = "CHANGED";
    const second = a.query(
      req("stateSource", "VEH", { plate: "ABC123" }),
      null,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(50);
    await expect(second).resolves.toEqual({ status: "NO RECORD" });
  });

  it("an unknown source or query type fails closed", async () => {
    const a = adapter();
    const s1 = track(
      a.query(req("nowhere", "VEH", { plate: "ABC123" }), null, new AbortController().signal),
    );
    const s2 = track(
      a.query(req("stateSource", "NOPE", { plate: "ABC123" }), null, new AbortController().signal),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect((s1.error as SourceError).code).toBe("failed");
    expect((s2.error as SourceError).code).toBe("failed");
  });
});

describe("mock factory on a snapshot", () => {
  it("loadSiteConfig and loadConfigDocument keep the mock on the snapshot", async () => {
    const fromFile = await loadSiteConfig(DEFAULT_SITE, OPTS);
    expect(fromFile.mock).toEqual(DEFAULT_MOCK);
    const { document } = await bootstrapDocument(DEFAULT_SITE, OPTS);
    const fromStore = await loadConfigDocument(document, {
      label: "test",
      configDir: configDirOf(DEFAULT_SITE),
      ...OPTS,
    });
    expect(fromStore.mock).toEqual(DEFAULT_MOCK);
  });

  it("a stored mock that breaks the fixture policy fails every mock call closed and logs no value", async () => {
    const { document } = await bootstrapDocument(DEFAULT_SITE, OPTS);
    const bad = structuredClone(document) as ConfigDocument & { mock: MockFile };
    const wnt = bad.mock.sources.nationalSource?.responses[3];
    const respond = wnt?.scenarios[0]?.respond as { subject: { last: string } };
    respond.subject.last = "SMITH";
    // Startup is not refused: the snapshot loads.
    const snapshot = await loadConfigDocument(bad, {
      label: "test",
      configDir: configDirOf(DEFAULT_SITE),
      ...OPTS,
    });
    const logger = captureLogger();
    const reg = createAdapterRegistry({
      allowMockSources: true,
      timers: instantTimers,
      random: () => 0,
      logger,
    });
    const a = reg.get("mock", snapshot);
    for (const r of [
      req("stateSource", "VEH", { plate: "ABC123" }),
      req("nationalSource", "WNT", { last: "WANTED" }),
    ]) {
      const e = await a.query(r, null, new AbortController().signal).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(SourceError);
      expect((e as SourceError).code).toBe("failed");
    }
    reg.get("mock", snapshot);
    expect(logger.entries).toEqual([
      {
        level: "error",
        msg: "mock fixture policy failed",
        f: {
          configHash: snapshot.configHash,
          count: 1,
          pointers: ["/sources/nationalSource/responses/3/scenarios/0/respond/subject/last"],
        },
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain("SMITH");
  });

  it("a timeout whose signal aborted before it began rejects AbortError at once", async () => {
    const ac = new AbortController();
    ac.abort();
    // instantTimers ignores the signal, so the timeout behaviour itself sees it aborted.
    const a = createMockAdapter({ mock: DEFAULT_MOCK, timers: instantTimers, random: () => 0 });
    const e = await a
      .query(req("nationalSource", "VEH", { plate: "TIMEOUT" }), null, ac.signal)
      .catch((x: unknown) => x);
    expect((e as DOMException).name).toBe("AbortError");
  });

  it("a mock-kind source on a snapshot without a mock fails closed, logged with ids only", async () => {
    const logger = captureLogger();
    const snapshot = {
      configHash: "h1",
      versionId: "01890a5d-ac96-774b-bcce-b302099a8001",
      mock: null,
    } as unknown as LoadedConfig;
    const reg = createAdapterRegistry({
      allowMockSources: true,
      timers: instantTimers,
      random: () => 0,
      logger,
    });
    const e = await reg
      .get("mock", snapshot)
      .query(req("stateSource", "VEH", { plate: "ABC123" }), null, new AbortController().signal)
      .catch((x: unknown) => x);
    expect((e as SourceError).code).toBe("failed");
    expect(logger.entries).toEqual([
      {
        level: "error",
        msg: "mock adapter has no mock",
        f: { configHash: "h1", versionId: "01890a5d-ac96-774b-bcce-b302099a8001" },
      },
    ]);
  });
});

describe("AW2 review C-m1, C-m2: the adapter serves only a checked private copy", () => {
  /** The default mock with one non-synthetic name in the WNT WANTED scenario. */
  function withSmith(mock: MockFile): MockFile {
    const wnt = mock.sources.nationalSource?.responses[3];
    const respond = wnt?.scenarios[0]?.respond as { subject: { last: string } };
    respond.subject.last = "SMITH";
    return mock;
  }
  const wanted = () => req("nationalSource", "WNT", { last: "WANTED" });

  it("C-m1: createMockAdapter itself fails closed on a mock that breaks the fixture policy", async () => {
    const a = createMockAdapter({
      mock: withSmith(structuredClone(DEFAULT_MOCK)),
      timers: instantTimers,
      random: () => 0,
    });
    const e = await a.query(wanted(), null, new AbortController().signal).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SourceError);
    expect((e as SourceError).code).toBe("failed");
  });

  it("C-m2: a change to the mock after createMockAdapter is never served", async () => {
    const mock = structuredClone(DEFAULT_MOCK);
    const a = createMockAdapter({ mock, timers: instantTimers, random: () => 0 });
    withSmith(mock);
    const v = await a.query(wanted(), null, new AbortController().signal);
    expect(JSON.stringify(v)).not.toContain("SMITH");
  });

  it("C-m2: a change to the snapshot's mock after the factory checked it is never served", async () => {
    const { document } = await bootstrapDocument(DEFAULT_SITE, OPTS);
    const snapshot = await loadConfigDocument(document, {
      label: "test",
      configDir: configDirOf(DEFAULT_SITE),
      ...OPTS,
    });
    const logger = captureLogger();
    const reg = createAdapterRegistry({
      allowMockSources: true,
      timers: instantTimers,
      random: () => 0,
      logger,
    });
    const a = reg.get("mock", snapshot);
    if (snapshot.mock !== null) withSmith(snapshot.mock);
    const v = await a.query(wanted(), null, new AbortController().signal);
    expect(JSON.stringify(v)).not.toContain("SMITH");
    expect(logger.entries).toEqual([]);
  });
});

describe("#493: the pinned snapshot's stored mock, never the image's file", () => {
  it("a mock-only publish answers from the new stored mock; the old snapshot keeps its own", async () => {
    const t = await createTestApp();
    const old = t.deps.config.current();
    const live = await t.deps.db.$client.execute(
      "SELECT document FROM site_config_version WHERE status = 'published'",
    );
    const doc = JSON.parse(String(live.rows[0]?.document)) as ConfigDocument & { mock: MockFile };
    const veh = doc.mock.sources.stateSource?.responses.find((r) => r.queryType === "VEH");
    const abc = veh?.scenarios.find((s) => s.when.plate === "ABC123");
    if (!abc) throw new Error("no ABC123 scenario");
    abc.respond = { status: "STOLEN" };
    await t.deps.db.$client.execute({
      sql: "INSERT INTO site_config_version (id, site_id, version, status, document, created_by, created_at, base_version) VALUES (?, 'default', 2, 'draft', ?, 'system', ?, 1)",
      args: [uuidv7(t.clock.now()), JSON.stringify(doc), t.clock.now()],
    });
    await activate(t.deps, 2);
    const next = t.deps.config.current();
    // Same site config, so the same configHash: versionId tells the snapshots apart.
    expect(next.configHash).toBe(old.configHash);
    expect(next.versionId).not.toBe(old.versionId);
    // The image's mock file still answers NO RECORD for ABC123.
    expect(
      DEFAULT_MOCK.sources.stateSource?.responses
        .find((r) => r.queryType === "VEH")
        ?.scenarios.find((s) => s.when.plate === "ABC123")?.respond,
    ).toEqual({ status: "NO RECORD" });
    const reg = createAdapterRegistry({
      allowMockSources: true,
      timers: instantTimers,
      random: () => 0,
      logger: captureLogger(),
    });
    const ask = (snapshot: LoadedConfig) =>
      reg
        .get("mock", snapshot)
        .query(req("stateSource", "VEH", { plate: "ABC123" }), null, new AbortController().signal);
    await expect(ask(next)).resolves.toEqual({ status: "STOLEN" });
    await expect(ask(old)).resolves.toEqual({ status: "NO RECORD" });
  }, 30_000);
});
