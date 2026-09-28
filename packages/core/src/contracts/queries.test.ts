import { describe, expect, it } from "vitest";
import {
  IdempotencyKeySchema,
  SubmitQueryRequestSchema,
  SubmitQueryResponseSchema,
} from "./queries";
import { findRoute } from "./routes";

const body = {
  queryType: "VEH",
  values: { plate: "ZZ-0001", state: null },
  sourceIds: ["stateSource"],
  mode: "normal",
  configHash: "c".repeat(64),
};

describe("FR-064 submit request (spec 5.1, 5.2)", () => {
  it("accepts the documented body", () =>
    expect(SubmitQueryRequestSchema.safeParse(body).success).toBe(true));
  it.each([
    ["unknown top-level key", { ...body, extra: 1 }],
    ["no sources", { ...body, sourceIds: [] }],
    ["nine sources", { ...body, sourceIds: Array.from({ length: 9 }, (_, i) => `s${i}`) }],
    ["a value over 4 KB", { ...body, values: { plate: "x".repeat(4097) } }],
    ["a field key with a dot", { ...body, values: { "a.b": "1" } }],
    ["bad mode", { ...body, mode: "fast" }],
    ["short configHash", { ...body, configHash: "c" }],
  ])("rejects %s", (_n, b) => expect(SubmitQueryRequestSchema.safeParse(b).success).toBe(false));
  it("Idempotency-Key: 16 to 128 url-safe characters", () => {
    expect(IdempotencyKeySchema.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(IdempotencyKeySchema.safeParse("a b".repeat(8)).success).toBe(false);
    expect(IdempotencyKeySchema.safeParse("k".repeat(128)).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse("k".repeat(129)).success).toBe(false);
  });
});

describe("FR-040 submit response", () => {
  it("parts carry dispatched and skipped status", () => {
    const r = {
      correlationId: "01890a5d-ac96-774b-bcce-b302099a8057",
      acknowledgedAt: 1_790_000_000_000,
      parts: [
        {
          partId: 0,
          queryType: "PER",
          status: "dispatched",
          sourceIds: ["stateSource"],
          droppedSourceIds: [],
        },
        { partId: 1, queryType: "WNT", status: "skipped", sourceIds: [], droppedSourceIds: [] },
      ],
    };
    expect(SubmitQueryResponseSchema.safeParse(r).success).toBe(true);
    expect(SubmitQueryResponseSchema.safeParse({ ...r, parts: [] }).success).toBe(false);
  });
});

describe("BR-007 submitQuery route definition", () => {
  it("is a session route that needs X-Requested-With", () => {
    const r = findRoute("submitQuery");
    expect([r.method, r.path, r.access, r.requiresRequestedWith]).toEqual([
      "post",
      "/api/v1/queries",
      "session",
      true,
    ]);
    expect(Object.keys(r.responses).map(Number).sort()).toEqual([
      202, 400, 401, 403, 409, 413, 429, 500, 503,
    ]);
  });
});
