import { describe, expect, it } from "vitest";
import { bodyUpdate, waveParentStatus } from "./board-model.mjs";

describe("waveParentStatus: wave parent close from issue state only (#79)", () => {
  it("gives no Status write for an open wave parent whose tasks are all closed", () => {
    // waveState reflects the plan data ("ready"), not the (irrelevant) fact that
    // every task issue underneath happens to be closed already.
    expect(waveParentStatus({ state: "open" }, "ready")).toBe("Ready");
    expect(waveParentStatus({ state: "open" }, "todo")).toBe("Todo");
    expect(waveParentStatus({ state: "open" }, "review")).toBe("In Review");
  });

  it("gives Done for a closed-as-completed issue", () => {
    expect(waveParentStatus({ state: "closed", state_reason: "completed" }, "ready")).toBe("Done");
    // state_reason absent (older GitHub payloads) still counts as completed.
    expect(waveParentStatus({ state: "closed" }, "ready")).toBe("Done");
  });

  it("forces no Status for a closed not-planned issue", () => {
    expect(
      waveParentStatus({ state: "closed", state_reason: "not_planned" }, "ready"),
    ).toBeUndefined();
  });

  it("forces no Status for a closed duplicate issue (critic:I4)", () => {
    expect(
      waveParentStatus({ state: "closed", state_reason: "duplicate" }, "ready"),
    ).toBeUndefined();
  });
});

describe("bodyUpdate: rewrite existing issue bodies (#79)", () => {
  it("returns null when bodies are equal", () => {
    expect(bodyUpdate("same text", "same text")).toBeNull();
  });

  it("returns null when bodies differ only by CRLF line endings", () => {
    expect(bodyUpdate("line one\r\nline two", "line one\nline two")).toBeNull();
  });

  it("returns null when bodies differ only by trailing whitespace", () => {
    expect(bodyUpdate("line one   \nline two\t", "line one\nline two")).toBeNull();
  });

  it("returns the desired body when the text differs", () => {
    expect(bodyUpdate("old text", "new text")).toBe("new text");
  });
});
