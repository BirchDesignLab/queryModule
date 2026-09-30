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
    reset: () => undefined,
    dispose: () => undefined,
  }));
  return { store, submit };
}

function failedRow(kind: "noResponse" | "invalid" = "noResponse") {
  const requests = createRequestsStore();
  const id = requests
    .getState()
    .begin({ queryType: "VEH", summary: "VEH.ZZ-0001.TX", submitted: SUBMITTED });
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
    expect(submit).toHaveBeenCalledWith({ ...SUBMITTED, configHash: "h-now" });
    expect(result).toEqual({ kind: "sent", outcome: ACK, rowId: expect.any(String) });
    const items = requests.getState().items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      status: "acknowledged",
      summary: "VEH.ZZ-0001.TX",
      submitted: SUBMITTED,
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
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
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
    const id = requests.getState().begin({ queryType: "VEH", summary: "s", submitted: SUBMITTED });
    requests
      .getState()
      .settle(id, await submit.getState().submit({ ...SUBMITTED, configHash: "h" }));
    expect(requests.getState().items[0]).toMatchObject({ status: "failed", failure: "noResponse" });
    expect(submit.getState().status).toBe("noConnection");
    // Down: the retry is gated and sends nothing.
    expect(await retryRequest({ requests, submit }, id, "h")).toEqual({
      kind: "gated",
      status: "noConnection",
    });
    up = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(submit.getState().status).toBe("idle");
    const result = await retryRequest({ requests, submit }, id, "h");
    expect(result.kind).toBe("sent");
    expect(keys).toEqual(["key-1", "key-1"]);
    expect(requests.getState().items.map((r) => r.status)).toEqual(["acknowledged", "failed"]);
  });

  it("a request the server answered (503) is retried under a new key", async () => {
    const keys = keysSeen(() => new HttpResponse(null, { status: 503 }));
    const submit = realSubmit();
    const requests = createRequestsStore();
    const id = requests.getState().begin({ queryType: "VEH", summary: "s", submitted: SUBMITTED });
    requests
      .getState()
      .settle(id, await submit.getState().submit({ ...SUBMITTED, configHash: "h" }));
    await retryRequest({ requests, submit }, id, "h");
    expect(keys).toEqual(["key-1", "key-2"]);
  });
});
