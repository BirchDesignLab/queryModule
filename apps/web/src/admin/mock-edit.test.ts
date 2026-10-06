import { describe, expect, it } from "vitest";
import {
  addPayloadChild,
  addTrigger,
  type MockResult,
  mockPointer,
  payloadAt,
  payloadPointer,
  removePayloadAt,
  removeTrigger,
  renamePayloadKey,
  resultOf,
  setPayloadValue,
  setTriggerField,
  setTriggerValue,
  withDefaultResult,
  withResult,
} from "./mock-edit.js";

// Task 3a (#549, CFG-2): pure helpers behind the payload editor and the result radios. Payloads are
// edited by path; every update is immutable and a no-op returns its input. Synthetic values only.

const payload = () => ({
  status: "STOLEN",
  plate: "ZZ-0001",
  owner: { last: "TESTERSON", address: "1 Example Ave" },
  warrants: [{ issued: "1901-01-02" }],
  year: 1999,
});

describe("mockPointer and payloadPointer", () => {
  it("builds the pointers the server reports", () => {
    expect(mockPointer.coverage).toBe("/mock/coverage");
    expect(mockPointer.source("stateSource")).toBe("/mock/sources/stateSource");
    expect(mockPointer.response("stateSource", 2)).toBe("/mock/sources/stateSource/responses/2");
    expect(payloadPointer("/mock/sources/a/responses/0/default", ["owner", "last"])).toBe(
      "/mock/sources/a/responses/0/default/owner/last",
    );
    expect(payloadPointer("/p", ["a/b", "c~d", 3])).toBe("/p/a~1b/c~0d/3");
  });

  it("recognises mock pointers", () => {
    expect(mockPointer.is("/mock/coverage")).toBe(true);
    expect(mockPointer.is("/mock")).toBe(true);
    expect(mockPointer.is("/mockery")).toBe(false);
    expect(mockPointer.is("/queryTypes/0")).toBe(false);
  });

  it("the response a pointer sits in, or null", () => {
    expect(mockPointer.responseOf("/mock/sources/s/responses/1/scenarios/0/respond/plate")).toEqual(
      {
        sourceId: "s",
        response: 1,
      },
    );
    expect(mockPointer.responseOf("/mock/sources/s")).toBeNull();
  });
});

describe("payload editing by path", () => {
  it("payloadAt reads a value", () => {
    expect(payloadAt(payload(), ["owner", "last"])).toBe("TESTERSON");
  });

  it("setPayloadValue replaces a scalar and keeps the original type when the text still fits", () => {
    expect(setPayloadValue(payload(), ["plate"], "ZZ-0002").plate).toBe("ZZ-0002");
    expect(setPayloadValue(payload(), ["year"], "1950").year).toBe(1950);
    expect(setPayloadValue(payload(), ["year"], "abc").year).toBe("abc");
  });

  it("setPayloadValue to the same text is a no-op", () => {
    const p = payload();
    expect(setPayloadValue(p, ["plate"], "ZZ-0001")).toBe(p);
    expect(setPayloadValue(p, ["year"], "1999")).toBe(p);
  });

  it("renamePayloadKey keeps the order and refuses a key the object already has", () => {
    const out = renamePayloadKey(payload(), ["plate"], "dob");
    expect(Object.keys(out)).toEqual(["status", "dob", "owner", "warrants", "year"]);
    const p = payload();
    expect(renamePayloadKey(p, ["plate"], "status")).toBe(p);
    expect(renamePayloadKey(p, ["plate"], "plate")).toBe(p);
  });

  it("removePayloadAt removes a key or an array item", () => {
    expect(removePayloadAt(payload(), ["plate"])).not.toHaveProperty("plate");
    expect(removePayloadAt(payload(), ["warrants", 0]).warrants).toEqual([]);
  });

  it("addPayloadChild adds an allowlisted key that is unused, a group or a list", () => {
    const field = addPayloadChild({ status: "X" }, [], "value");
    expect(Object.keys(field)).toHaveLength(2);
    expect(Object.keys(field)[0]).toBe("status");
    const key = Object.keys(field)[1] as string;
    expect(field[key]).toBe("");
    const group = addPayloadChild({ status: "X" }, [], "group");
    expect(Object.values(group).some((v) => typeof v === "object" && !Array.isArray(v))).toBe(true);
    const list = addPayloadChild({ status: "X" }, [], "list");
    expect(Object.values(list).some((v) => Array.isArray(v))).toBe(true);
  });

  it("addPayloadChild inside a list appends an empty group; inside a group adds a field", () => {
    expect(addPayloadChild(payload(), ["warrants"], "group").warrants).toHaveLength(2);
    const inGroup = addPayloadChild(payload(), ["owner"], "value");
    expect(Object.keys(inGroup.owner as object)).toHaveLength(3);
  });

  it("never mutates its input", () => {
    const p = payload();
    const before = structuredClone(p);
    setPayloadValue(p, ["owner", "last"], "SAMPLEWORTH");
    removePayloadAt(p, ["owner"]);
    addPayloadChild(p, ["owner"], "value");
    expect(p).toEqual(before);
  });
});

describe("resultOf and withResult", () => {
  it("reads a payload and a behavior as one of the five results", () => {
    expect(resultOf({ when: { a: "b" }, respond: { status: "NO RECORD" } })).toBe("norecord");
    expect(resultOf({ when: { a: "b" }, respond: { status: "STOLEN" } })).toBe("record");
    expect(resultOf({ when: { a: "b" }, behavior: "error" })).toBe("error");
    expect(resultOf({ when: { a: "b" }, behavior: "timeout" })).toBe("timeout");
    expect(resultOf({ when: { a: "b" }, behavior: "credentialsRejected" })).toBe("creds");
    expect(resultOf({ status: "NO RECORD" })).toBe("norecord");
    expect(resultOf({ status: "STOLEN" })).toBe("record");
  });

  it.each<[MockResult, object]>([
    ["norecord", { respond: { status: "NO RECORD" } }],
    ["error", { behavior: "error" }],
    ["timeout", { behavior: "timeout" }],
    ["creds", { behavior: "credentialsRejected" }],
  ])("a scenario switched to %s carries exactly one of respond or behavior", (result, expected) => {
    const out = withResult({ when: { plate: "ZZ-0001" }, respond: { status: "STOLEN" } }, result);
    expect(out).toEqual({ when: { plate: "ZZ-0001" }, ...expected });
  });

  it("switching to a record keeps an existing payload and otherwise starts with a status row", () => {
    const kept = withResult({ when: { a: "b" }, respond: { status: "STOLEN" } }, "record");
    expect(kept.respond).toEqual({ status: "STOLEN" });
    const fresh = withResult({ when: { a: "b" }, behavior: "error" }, "record");
    expect(Object.keys(fresh.respond ?? {})).toEqual(["status"]);
    expect(fresh.behavior).toBeUndefined();
    const noRecord = withResult({ when: { a: "b" }, respond: { status: "NO RECORD" } }, "record");
    expect(noRecord.respond?.status).not.toBe("NO RECORD");
  });

  it("the result already chosen is a no-op", () => {
    const s = { when: { a: "b" }, behavior: "error" as const };
    expect(withResult(s, "error")).toBe(s);
  });
});

describe("withDefaultResult", () => {
  it("switches a default between no record and a record, and is a no-op for the current one", () => {
    expect(withDefaultResult({ status: "STOLEN" }, "norecord")).toEqual({ status: "NO RECORD" });
    expect(Object.keys(withDefaultResult({ status: "NO RECORD" }, "record"))).toEqual(["status"]);
    const p = { status: "STOLEN" };
    expect(withDefaultResult(p, "record")).toBe(p);
  });
});

describe("trigger fields (when)", () => {
  const when = () => ({ plate: "ZZ-0001", state: "TX" });

  it("setTriggerValue edits one value, keeps a number's type when the text fits, and is a no-op when equal", () => {
    expect(setTriggerValue(when(), "plate", "ZZ-0002")).toEqual({ plate: "ZZ-0002", state: "TX" });
    expect(setTriggerValue({ year: 1 }, "year", "20")).toEqual({ year: 20 });
    const w = when();
    expect(setTriggerValue(w, "plate", "ZZ-0001")).toBe(w);
  });

  it("setTriggerField renames a key in place, keeping its value, and refuses a key already used", () => {
    const out = setTriggerField(when(), "plate", "vin");
    expect(Object.entries(out)).toEqual([
      ["vin", "ZZ-0001"],
      ["state", "TX"],
    ]);
    const w = when();
    expect(setTriggerField(w, "plate", "state")).toBe(w);
    expect(setTriggerField(w, "plate", "plate")).toBe(w);
  });

  it("removeTrigger drops one field", () => {
    expect(removeTrigger(when(), "state")).toEqual({ plate: "ZZ-0001" });
  });

  it("addTrigger adds the first field the scenario does not use yet, with a blank value", () => {
    expect(addTrigger({ plate: "ZZ-0001" }, ["plate", "state", "vin"])).toEqual({
      plate: "ZZ-0001",
      state: "",
    });
    const full = { plate: "a" };
    expect(addTrigger(full, ["plate"])).toBe(full);
  });
});
