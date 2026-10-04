import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createApiClient } from "../api/create-api-client.js";
import { createFakePlatform } from "../testing/fake-platform.js";
import { createRequestsStore } from "./requests.js";
import { isRetryable, retryRequest } from "./retry.js";
import {
  createSubmitController,
  type SubmitController,
  type SubmitOutcome,
  type SubmitRequest,
  type SubmitState,
} from "./submit.js";

const SUBMITTED = {
  queryType: "VEH",
  values: { plate: "ZZ-0001", state: "TX" },
  sourceIds: ["state"],
  mode: "normal" as const,
};
const ACK: SubmitOutcome = {
  kind: "acknowledged",
  queryType: "VEH",
  response: { correlationId: "c-2", acknowledgedAt: 2, parts: [] },
};

const ACK_BODY = {
  correlationId: "c-9",
  acknowledgedAt: 9,
  parts: [{ partId: 0, queryType: "VEH", status: "dispatched", sourceIds: ["state"] }],
};

function fakeSubmit(status: SubmitState["status"], outcome: SubmitOutcome = ACK) {
  const submit = vi.fn(async (_req: SubmitRequest) => outcome);
  const store: SubmitController = createStore<SubmitState>(() => ({
    status,
    submit,
    keyFor: () => "key-fresh",
    reset: () => undefined,
    dispose: () => undefined,
  }));
  return { store, submit };
}

function failedRow(kind: "noResponse" | "invalid" = "noResponse") {
  const requests = createRequestsStore();
  const id = requests.getState().begin({
    queryType: "VEH",
    summary: "VEH.ZZ-0001.TX",
    submitted: SUBMITTED,
    idempotencyKey: "key-orig",
  });
  requests.getState().settle(id, kind === "invalid" ? { kind, errors: [] } : { kind });
  return { requests, id };
}

describe("isRetryable: a failed row whose values were kept, except where the same values cannot succeed", () => {
  it.each([
    ["noResponse", true],
    ["unavailable", true],
    ["failed", true],
    ["rateLimited", true],
    ["configChanged", false],
    ["invalid", false],
    ["forbidden", false],
  ] as const)("%s -> %s", (failure, expected) => {
    const requests = createRequestsStore();
    const id = requests.getState().begin({ queryType: "VEH", summary: "s", submitted: SUBMITTED });
    requests
      .getState()
      .settle(
        id,
        failure === "invalid"
          ? { kind: failure, errors: [] }
          : failure === "rateLimited"
            ? { kind: failure, retryAfterSeconds: 1 }
            : { kind: failure },
      );
    const row = requests.getState().items[0];
    expect(row !== undefined && isRetryable(row)).toBe(expected);
  });

  it("never for a sending or acknowledged row, nor a failed row without kept values", () => {
    const requests = createRequestsStore();
    const sending = requests
      .getState()
      .begin({ queryType: "VEH", summary: "a", submitted: SUBMITTED });
    expect(isRetryable(requests.getState().items[0] as never)).toBe(false);
    requests.getState().settle(sending, ACK);
    expect(isRetryable(requests.getState().items[0] as never)).toBe(false);
    const bare = requests.getState().begin({ queryType: "VEH", summary: "b" });
    requests.getState().settle(bare, { kind: "failed" });
    expect(isRetryable(requests.getState().items[0] as never)).toBe(false);
  });
});

describe("retryRequest: the stored values go as a new attempt and add a new row", () => {
  it("submits the stored values under the current config hash, keeps the failed row, settles the new one", async () => {
    const { requests, id } = failedRow();
    const { store, submit } = fakeSubmit("idle");
    const result = await retryRequest({ requests, submit: store }, id, "h-now");
    // SUBMIT-1: the retry is the same request, so it goes under the failed row's own key.
    expect(submit).toHaveBeenCalledWith({
      ...SUBMITTED,
      idempotencyKey: "key-orig",
      configHash: "h-now",
    });
    expect(result).toEqual({ kind: "sent", outcome: ACK, rowId: expect.any(String) });
    const items = requests.getState().items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      status: "acknowledged",
      summary: "VEH.ZZ-0001.TX",
      submitted: SUBMITTED,
      idempotencyKey: "key-orig",
    });
    expect(items[1]).toMatchObject({ id, status: "failed", failure: "noResponse" });
  });

  it("the new row is Sending while the request is in flight", async () => {
    const { requests, id } = failedRow();
    let release: (o: SubmitOutcome) => void = () => undefined;
    const submit = vi.fn(() => new Promise<SubmitOutcome>((r) => (release = r)));
    const store: SubmitController = createStore<SubmitState>(() => ({
      status: "idle",
      submit,
      keyFor: () => "key-fresh",
      reset: () => undefined,
      dispose: () => undefined,
    }));
    const pending = retryRequest({ requests, submit: store }, id, "h");
    expect(requests.getState().items[0]?.status).toBe("sending");
    release({ kind: "failed" });
    await pending;
    expect(requests.getState().items[0]?.status).toBe("failed");
  });

  it("a failed retry leaves two failed rows, and either can be retried again", async () => {
    const { requests, id } = failedRow();
    const { store } = fakeSubmit("idle", { kind: "noResponse" });
    await retryRequest({ requests, submit: store }, id, "h");
    const rows = requests.getState().items;
    expect(rows.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(rows.every(isRetryable)).toBe(true);
  });

  it("is gated while submitting or offline: nothing is sent and no row is added", async () => {
    for (const status of ["submitting", "noConnection"] as const) {
      const { requests, id } = failedRow();
      const { store, submit } = fakeSubmit(status);
      expect(await retryRequest({ requests, submit: store }, id, "h")).toEqual({
        kind: "gated",
        status,
      });
      expect(submit).not.toHaveBeenCalled();
      expect(requests.getState().items).toHaveLength(1);
    }
  });

  it("does nothing for a row that is gone (a reset) or not retryable", async () => {
    const { requests, id } = failedRow("invalid");
    const { store, submit } = fakeSubmit("idle");
    expect(await retryRequest({ requests, submit: store }, id, "h")).toEqual({
      kind: "unavailable",
    });
    requests.getState().reset();
    expect(await retryRequest({ requests, submit: store }, id, "h")).toEqual({
      kind: "unavailable",
    });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("retryRequest with the real submit controller: the Idempotency-Key rule (spec 6.7)", () => {
  const BASE = "http://api.test";
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => {
    server.resetHandlers();
    vi.useRealTimers();
  });
  afterAll(() => server.close());

  function realSubmit() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const platform = createFakePlatform();
    const api = createApiClient({ baseUrl: BASE, platform, onUnauthenticated: () => undefined });
    let n = 0;
    return createSubmitController({
      api,
      queryClient: new QueryClient(),
      online: platform.online,
      newKey: () => `key-${++n}`,
      random: () => 0,
    });
  }

  function keysSeen(answer: () => Response): (string | null)[] {
    const keys: (string | null)[] = [];
    server.use(
      http.post(`${BASE}/api/v1/queries`, ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return answer();
      }),
    );
    return keys;
  }

  /** A row begun the way the panel does: its key comes from the controller and is kept with it. */
  const beginRow = (
    requests: ReturnType<typeof createRequestsStore>,
    submit: SubmitController,
    summary = "s",
    submitted: typeof SUBMITTED = SUBMITTED,
  ) => {
    const idempotencyKey = submit.getState().keyFor({ ...submitted, configHash: "h" });
    const id = requests
      .getState()
      .begin({ queryType: submitted.queryType, summary, submitted, idempotencyKey });
    return { id, idempotencyKey, submitted };
  };
  const sendRow = async (
    requests: ReturnType<typeof createRequestsStore>,
    submit: SubmitController,
    row: { id: string; idempotencyKey: string; submitted: typeof SUBMITTED },
  ) =>
    requests
      .getState()
      .settle(
        row.id,
        await submit
          .getState()
          .submit({ ...row.submitted, idempotencyKey: row.idempotencyKey, configHash: "h" }),
      );

  it("a request that got no answer is retried under the same key (the server may have it), as a new row", async () => {
    let up = false;
    server.use(
      http.get(`${BASE}/api/v1/health`, () =>
        up ? HttpResponse.json({ ok: true }) : HttpResponse.error(),
      ),
    );
    const keys = keysSeen(() =>
      up ? HttpResponse.json(ACK_BODY, { status: 202 }) : HttpResponse.error(),
    );
    const submit = realSubmit();
    const requests = createRequestsStore();
    const row = beginRow(requests, submit);
    await sendRow(requests, submit, row);
    expect(requests.getState().items[0]).toMatchObject({ status: "failed", failure: "noResponse" });
    expect(submit.getState().status).toBe("noConnection");
    // Down: the retry is gated and sends nothing.
    expect(await retryRequest({ requests, submit }, row.id, "h")).toEqual({
      kind: "gated",
      status: "noConnection",
    });
    up = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(submit.getState().status).toBe("idle");
    const result = await retryRequest({ requests, submit }, row.id, "h");
    expect(result.kind).toBe("sent");
    expect(keys).toEqual(["key-1", "key-1"]);
    expect(requests.getState().items.map((r) => r.status)).toEqual(["acknowledged", "failed"]);
  });

  it.each([
    ["503", () => new HttpResponse(null, { status: 503 })],
    ["502 from a gateway", () => new HttpResponse(null, { status: 502 })],
    [
      "429",
      () => HttpResponse.json({ error: { code: "rateLimited", requestId: "r" } }, { status: 429 }),
    ],
  ])(
    "SUBMIT-1 a request answered %s is retried under the same key, so it cannot run twice",
    async (_name, answer) => {
      const keys = keysSeen(answer);
      const submit = realSubmit();
      const requests = createRequestsStore();
      const row = beginRow(requests, submit);
      await sendRow(requests, submit, row);
      await retryRequest({ requests, submit }, row.id, "h");
      expect(keys).toEqual(["key-1", "key-1"]);
    },
  );

  it("SUBMIT-1 another request sent between does not take the failed row's key", async () => {
    let drop = true;
    server.use(http.get(`${BASE}/api/v1/health`, () => HttpResponse.json({ ok: true })));
    const keys = keysSeen(() =>
      drop ? HttpResponse.error() : HttpResponse.json(ACK_BODY, { status: 202 }),
    );
    const submit = realSubmit();
    const requests = createRequestsStore();
    const a = beginRow(requests, submit, "a");
    await sendRow(requests, submit, a); // A drops: key-1
    await vi.advanceTimersByTimeAsync(2000);
    drop = false;
    const b = beginRow(requests, submit, "b", { ...SUBMITTED, queryType: "PER" });
    await sendRow(requests, submit, b); // B is a different request: key-2
    await retryRequest({ requests, submit }, a.id, "h");
    expect(keys).toEqual(["key-1", "key-2", "key-1"]);
  });

  it("SUBMIT-1 the server sees one request: a retry of a stored-but-unanswered request replays it", async () => {
    const stored = new Map<string, number>();
    let firstAnswered = false;
    server.use(
      http.post(`${BASE}/api/v1/queries`, ({ request }) => {
        const key = request.headers.get("idempotency-key") ?? "";
        const replay = stored.has(key);
        if (!replay) stored.set(key, stored.size + 1);
        // The first answer is lost to a gateway after the server stored the request.
        if (!firstAnswered) {
          firstAnswered = true;
          return new HttpResponse(null, { status: 502 });
        }
        return HttpResponse.json(ACK_BODY, { status: 202 });
      }),
    );
    const submit = realSubmit();
    const requests = createRequestsStore();
    const row = beginRow(requests, submit);
    await sendRow(requests, submit, row);
    await retryRequest({ requests, submit }, row.id, "h");
    expect(stored.size).toBe(1);
  });
});
