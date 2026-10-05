import { describe, expect, it } from "vitest";
import {
  AdminQueryDetailSchema,
  AdminQueryQuerySchema,
  IdempotencyKeySchema,
  ListQueriesQuerySchema,
  QueryDetailSchema,
  QueryListResponseSchema,
  QueryParamsSchema,
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

const CID = "01890000-0000-7000-8000-000000000001";
const RID = "01890000-0000-7000-8000-000000000002";
const returned = {
  resultId: RID,
  sourceId: "stateSource",
  status: "returned",
  adapterKind: "mock",
  errorCode: null,
  createdAt: 1000,
  receivedAt: 1200,
  timedOutAt: null,
  purged: false,
  payload: { rows: [{ plate: "ZZ-0001" }] },
};
const part = {
  partId: 0,
  parentPartId: null,
  origin: "primary",
  queryType: "VEH",
  typeValues: { state: "TX" },
  plateOnly: false,
  skippedReason: null,
  droppedSourceIds: [],
  purged: false,
  values: { plate: "ZZ-0001" },
  sources: [returned],
};
const detail = { correlationId: CID, submittedAt: 1000, configHash: "c".repeat(64), parts: [part] };

describe("FR-062 GET /queries shapes (spec 5.1, 5.5)", () => {
  it("one request: parts, per-source status, payload for returned", () => {
    expect(QueryDetailSchema.safeParse(detail).success).toBe(true);
    expect(QueryParamsSchema.safeParse({ correlationId: CID }).success).toBe(true);
    expect(QueryParamsSchema.safeParse({ correlationId: "nope" }).success).toBe(false);
  });
  it("a purged part and a purged result carry no values or payload", () => {
    const { values: _v, ...bare } = part;
    const { payload: _p, ...bareResult } = returned;
    const purged = { ...bare, purged: true, sources: [{ ...bareResult, purged: true }] };
    expect(QueryDetailSchema.safeParse({ ...detail, parts: [purged] }).success).toBe(true);
  });
  it("rejects an unknown source status and unknown keys", () => {
    const bad = { ...part, sources: [{ ...returned, status: "weird" }] };
    expect(QueryDetailSchema.safeParse({ ...detail, parts: [bad] }).success).toBe(false);
    expect(QueryDetailSchema.safeParse({ ...detail, extra: 1 }).success).toBe(false);
  });
  it("the list is newest first with a cursor, at most 100 per page", () => {
    expect(
      QueryListResponseSchema.safeParse({ requests: [detail], nextCursor: null }).success,
    ).toBe(true);
    expect(ListQueriesQuerySchema.parse({ limit: "25", cursor: "abc" })).toEqual({
      limit: 25,
      cursor: "abc",
    });
    expect(ListQueriesQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(ListQueriesQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ListQueriesQuerySchema.safeParse({ limit: "1.5" }).success).toBe(false);
    expect(ListQueriesQuerySchema.safeParse({ other: "1" }).success).toBe(false);
  });
});

describe("FR-063 admin query read (spec 5.1)", () => {
  it("includeHidden is true or false; each result says whether it is hidden", () => {
    expect(AdminQueryQuerySchema.parse({ includeHidden: "true" })).toEqual({
      includeHidden: "true",
    });
    expect(AdminQueryQuerySchema.parse({})).toEqual({});
    expect(AdminQueryQuerySchema.safeParse({ includeHidden: "yes" }).success).toBe(false);
    const admin = { ...detail, parts: [{ ...part, sources: [{ ...returned, hidden: true }] }] };
    expect(AdminQueryDetailSchema.safeParse(admin).success).toBe(true);
    expect(AdminQueryDetailSchema.safeParse(detail).success).toBe(false);
  });
});
