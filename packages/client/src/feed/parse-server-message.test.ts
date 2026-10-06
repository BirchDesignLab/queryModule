import { describe, expect, it, vi } from "vitest";
import { parseServerMessage } from "./parse-server-message.js";

const CORRELATION_ID = "01923abc-4def-7123-8abc-0123456789ab";
const RESULT_ID = "01923abc-4def-7123-8abc-0123456789ac";

const sourceStatus = {
  v: 1,
  type: "sourceStatus",
  seq: 6,
  at: 1_700_000_000_000,
  correlationId: CORRELATION_ID,
  partId: 0,
  sourceId: "state",
  resultId: RESULT_ID,
  status: "returned",
};

describe("ADR-0013 tolerant receipt parser (FR-065, NFR-003)", () => {
  it("accepts each known server message type", () => {
    expect(parseServerMessage(JSON.stringify({ v: 1, type: "welcome", latestSeq: 5 }))).toEqual({
      v: 1,
      type: "welcome",
      latestSeq: 5,
    });
    expect(
      parseServerMessage(JSON.stringify({ v: 1, type: "pong", nonce: "n1", serverTime: 9 })),
    ).toEqual({ v: 1, type: "pong", nonce: "n1", serverTime: 9 });
    expect(parseServerMessage(JSON.stringify(sourceStatus))).toEqual(sourceStatus);
    expect(
      parseServerMessage(
        JSON.stringify({
          v: 1,
          type: "resultHidden",
          seq: 7,
          at: 1,
          correlationId: CORRELATION_ID,
          resultIds: [RESULT_ID],
        }),
      ),
    ).toMatchObject({ type: "resultHidden", seq: 7 });
    expect(
      parseServerMessage(JSON.stringify({ v: 1, type: "resync", reason: "tooOld", latestSeq: 12 })),
    ).toMatchObject({ type: "resync", latestSeq: 12 });
  });

  it("drops an unknown type without counting it", () => {
    const onInvalid = vi.fn();
    expect(
      parseServerMessage(JSON.stringify({ v: 1, type: "somethingNew" }), onInvalid),
    ).toBeNull();
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("strips unknown keys from a known type", () => {
    const parsed = parseServerMessage(JSON.stringify({ ...sourceStatus, extra: "x" }));
    expect(parsed).toEqual(sourceStatus);
    expect(parsed).not.toHaveProperty("extra");
  });

  it("drops a known type that fails its schema and counts it by type only", () => {
    const onInvalid = vi.fn();
    const broken = { ...sourceStatus, status: "notAStatus" };
    expect(parseServerMessage(JSON.stringify(broken), onInvalid)).toBeNull();
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith("sourceStatus");
  });

  it("drops a known type with a missing field", () => {
    const onInvalid = vi.fn();
    const { correlationId: _omitted, ...missing } = sourceStatus;
    expect(parseServerMessage(JSON.stringify(missing), onInvalid)).toBeNull();
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not json", "{nope"],
    ["an empty string", ""],
    ["a json string", JSON.stringify("welcome")],
    ["a json number", "42"],
    ["null", "null"],
    ["an array", "[]"],
    ["an object without a type", JSON.stringify({ v: 1 })],
    ["a numeric type", JSON.stringify({ v: 1, type: 3 })],
    ["a prototype key as the type", JSON.stringify({ v: 1, type: "__proto__" })],
    ["a built-in method name as the type", JSON.stringify({ v: 1, type: "toString" })],
  ])("never throws on %s", (_name, raw) => {
    const onInvalid = vi.fn();
    expect(parseServerMessage(raw, onInvalid)).toBeNull();
    expect(onInvalid).not.toHaveBeenCalled();
  });
});
