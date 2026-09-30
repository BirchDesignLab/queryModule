import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createRequestsStore } from "./requests.js";
import { isRetryable, retryRequest } from "./retry.js";
import type { SubmitController, SubmitOutcome, SubmitRequest, SubmitState } from "./submit.js";

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
    ["configChanged", true],
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

describe("retryRequest: the stored values go as a NEW request and add a new row", () => {
  it("submits the stored values under a fresh key with the current config hash, keeps the failed row, settles the new one", async () => {
    const { requests, id } = failedRow();
    const { store, submit } = fakeSubmit("idle");
    const result = await retryRequest({ requests, submit: store }, id, "h-now");
    expect(submit).toHaveBeenCalledWith({ ...SUBMITTED, configHash: "h-now", freshKey: true });
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
