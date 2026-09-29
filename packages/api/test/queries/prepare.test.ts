import type { SiteConfig } from "@querymodule/core/config";
import { ApiErrorSchema } from "@querymodule/core/contracts";
import type { Plan } from "@querymodule/core/planner";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppDeps } from "../../src/deps";
import type { AppEnv } from "../../src/http/types";
import { type PreparedSubmit, prepareSubmit, snapshotCredentials } from "../../src/queries/prepare";
import type { Principal } from "../../src/seams";
import { createTestApp } from "../helpers/test-app";

const PRINCIPAL: Principal = {
  userId: "01890a5d-ac96-774b-bcce-b302099a8000",
  email: "dispatcher@example.test",
  role: "user",
  sessionId: "session-0001",
  identitySource: "local",
  authenticatedAt: 1_790_000_000_000,
};
const PLATE = "ZZ-0001";
const LAST = "TESTERSON";

/** One POST route over the built deps: 200 with the prepared value, or prepareSubmit's own response. */
async function harness(): Promise<{
  deps: AppDeps;
  send: (body: unknown) => Promise<Response>;
}> {
  const { deps } = await createTestApp();
  const app = new Hono<AppEnv>();
  app.post("/", async (c) => {
    const p = prepareSubmit(c, deps, await c.req.json(), PRINCIPAL);
    return p.ok ? c.json(p.value) : p.response;
  });
  const send = (body: unknown) =>
    Promise.resolve(
      app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { deps, send };
}

function body(deps: AppDeps, over: Record<string, unknown> = {}) {
  return {
    queryType: "VEH",
    values: { plate: PLATE, year: "26" },
    sourceIds: ["stateSource", "nationalSource"],
    mode: "normal",
    configHash: deps.config.configHash,
    ...over,
  };
}

/** A 400 body: status, parsed errors, and the raw text for the no-values check. */
async function rejected(r: Response) {
  const text = await r.text();
  expect(text).not.toContain(PLATE);
  expect(text).not.toContain(LAST);
  const e = ApiErrorSchema.parse(JSON.parse(text)).error;
  return { status: r.status, code: e.code, errors: e.errors, params: e.params };
}

async function rejectedAny(r: Response) {
  const e = ApiErrorSchema.parse(await r.json()).error;
  return { status: r.status, code: e.code, params: e.params };
}

describe("prepareSubmit (spec 5.2 steps 2 and 3, FR-040, FR-041, FR-042, FR-064)", () => {
  it("a valid VEH body prepares one mock pair per selected source with no owner", async () => {
    const { deps, send } = await harness();
    const r = await send(body(deps));
    expect(r.status).toBe(200);
    const v = (await r.json()) as PreparedSubmit;
    expect(v.request.queryType).toBe("VEH");
    expect(v.plan.mode).toBe("normal");
    expect(v.pairs).toEqual([
      {
        partId: 0,
        sourceId: "stateSource",
        credentialUserId: null,
        delegationId: null,
        adapterKind: "mock",
      },
      {
        partId: 0,
        sourceId: "nationalSource",
        credentialUserId: null,
        delegationId: null,
        adapterKind: "mock",
      },
    ]);
  });

  it("a plate-only VEH body snapshots only the narrowed source", async () => {
    const { deps, send } = await harness();
    const r = await send(body(deps, { values: { plate: PLATE }, mode: "plateOnly" }));
    expect(r.status).toBe(200);
    const v = (await r.json()) as PreparedSubmit;
    expect(v.plan.droppedSourceIds).toEqual(["nationalSource"]);
    expect(v.pairs.map((p) => [p.partId, p.sourceId])).toEqual([[0, "stateSource"]]);
  });

  it("a PER body plans two parts and snapshots pairs for both", async () => {
    const { deps, send } = await harness();
    const r = await send(body(deps, { queryType: "PER", values: { last: LAST } }));
    expect(r.status).toBe(200);
    const v = (await r.json()) as PreparedSubmit;
    expect(v.plan.parts.map((p) => [p.partId, p.queryType, p.status])).toEqual([
      [0, "PER", "planned"],
      [1, "WNT", "planned"],
    ]);
    expect(v.pairs.map((p) => [p.partId, p.sourceId, p.adapterKind])).toEqual([
      [0, "stateSource", "mock"],
      [0, "nationalSource", "mock"],
      [1, "nationalSource", "mock"],
    ]);
  });

  it("a stale configHash is 409 configHashMismatch with the loaded hash", async () => {
    const { deps, send } = await harness();
    const r = await rejectedAny(await send(body(deps, { configHash: "0".repeat(64) })));
    expect(r.status).toBe(409);
    expect(r.code).toBe("configHashMismatch");
    expect(r.params).toEqual({ currentConfigHash: deps.config.configHash });
  });

  it("an unknown field is 400 validation.unknownField, value not echoed", async () => {
    const { deps, send } = await harness();
    const r = await rejected(
      await send(body(deps, { values: { plate: PLATE, colour: LAST, year: "26" } })),
    );
    expect([r.status, r.code]).toEqual([400, "validationFailed"]);
    expect(r.errors).toEqual([{ key: "validation.unknownField", params: { field: "colour" } }]);
  });

  it("mode normal for a plate-only draft is 400 validation.modeMismatch", async () => {
    const { deps, send } = await harness();
    const r = await rejected(await send(body(deps, { values: { plate: PLATE } })));
    expect([r.status, r.code]).toEqual([400, "validationFailed"]);
    expect(r.errors).toEqual([{ key: "validation.modeMismatch" }]);
  });

  it("a plate-only draft selecting only nationalSource is 400 plan.noPlateOnlySource", async () => {
    const { deps, send } = await harness();
    const r = await rejected(
      await send(
        body(deps, { values: { plate: PLATE }, sourceIds: ["nationalSource"], mode: "plateOnly" }),
      ),
    );
    expect([r.status, r.code]).toEqual([400, "validationFailed"]);
    expect(r.errors).toEqual([{ key: "plan.noPlateOnlySource" }]);
  });

  it("schema failures are 400 validation.invalidBody naming only the top-level field", async () => {
    const { deps, send } = await harness();
    const r = await rejected(
      await send(body(deps, { values: { plate: [PLATE], year: { x: PLATE } } })),
    );
    expect([r.status, r.code]).toEqual([400, "validationFailed"]);
    expect(r.errors).toEqual([{ key: "validation.invalidBody", params: { field: "values" } }]);
    const empty = await rejected(await send(body(deps, { sourceIds: [], mode: 7 })));
    expect(empty.errors).toEqual([
      { key: "validation.invalidBody", params: { field: "sourceIds" } },
      { key: "validation.invalidBody", params: { field: "mode" } },
    ]);
  });

  it("a root-level schema failure names no field and echoes no key or value", async () => {
    const { deps, send } = await harness();
    const r = await rejected(await send({ ...body(deps), [LAST]: PLATE }));
    expect(r.errors).toEqual([{ key: "validation.invalidBody" }]);
    const nonObject = await rejected(await send(PLATE));
    expect(nonObject.errors).toEqual([{ key: "validation.invalidBody" }]);
  });

  it("duplicate sourceIds are 400 validation.invalidBody on sourceIds (controller ruling #284)", async () => {
    const { deps, send } = await harness();
    const r = await rejected(
      await send(body(deps, { sourceIds: ["stateSource", "nationalSource", "stateSource"] })),
    );
    expect([r.status, r.code]).toEqual([400, "validationFailed"]);
    expect(r.errors).toEqual([{ key: "validation.invalidBody", params: { field: "sourceIds" } }]);
  });
});

describe("snapshotCredentials (spec 5.2 step 3, SEC-011)", () => {
  const plan: Plan = {
    mode: "normal",
    droppedSourceIds: [],
    parts: [
      {
        partId: 0,
        parentPartId: null,
        origin: "primary",
        queryType: "VEH",
        typeValues: {},
        values: {},
        sourceIds: ["stateSource"],
        droppedSourceIds: [],
        mode: "normal",
        status: "planned",
      },
      {
        partId: 2,
        parentPartId: 0,
        origin: "alsoRun",
        queryType: "WNT",
        typeValues: {},
        values: {},
        sourceIds: [],
        droppedSourceIds: [],
        mode: "normal",
        status: "skipped",
        skipReasons: [{ key: "plan.nestedNoSources" }],
      },
    ],
  };

  it("a source that requires credentials still resolves no owner in M1", async () => {
    const { deps } = await createTestApp();
    const config: SiteConfig = structuredClone(deps.config.siteConfig);
    for (const s of config.sources) s.requiresCredentials = true;
    expect(snapshotCredentials(plan, config, PRINCIPAL)).toEqual([
      {
        partId: 0,
        sourceId: "stateSource",
        credentialUserId: null,
        delegationId: null,
        adapterKind: "mock",
      },
    ]);
  });

  it("a planned source missing from the resolved config throws", async () => {
    const { deps } = await createTestApp();
    const config: SiteConfig = structuredClone(deps.config.siteConfig);
    config.sources = config.sources.filter((s) => s.id !== "stateSource");
    expect(() => snapshotCredentials(plan, config, PRINCIPAL)).toThrow(
      "snapshot: planned source not in config",
    );
  });
});
