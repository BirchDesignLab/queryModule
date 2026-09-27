import { describe, expect, it } from "vitest";
import { bodyUpdate, matchParent, titleUpdate, waveParentStatus } from "./board-model.mjs";

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

describe("titleUpdate: rename parents and follow-ups by number, not by title (#80)", () => {
  it("returns null when titles are equal", () => {
    expect(titleUpdate("Contracts (M0 P0)", "Contracts (M0 P0)")).toBeNull();
  });

  it("returns the desired title when the live title is the old style", () => {
    expect(titleUpdate("M0 P0: Contracts", "Contracts (M0 P0)")).toBe("Contracts (M0 P0)");
  });
});

describe("matchParent: match data items to live issues by number (#80)", () => {
  const liveIssues = [
    { number: 39, title: "M0 P0: Contracts" },
    { number: 55, title: "M0 P0 W1: Tasks 1 to 6" },
  ];
  const byNumber = (n: number) => liveIssues.find((i) => i.number === n);

  it("matches an item by its recorded number even though the live title has not been renamed yet", () => {
    expect(matchParent({ number: 39, title: "Contracts (M0 P0)" }, byNumber)).toBe(liveIssues[0]);
  });

  it("matches a wave parent by number", () => {
    expect(
      matchParent(
        { number: 55, title: "Wave 1: Workspace and first contracts (Tasks 1 to 6)" },
        byNumber,
      ),
    ).toBe(liveIssues[1]);
  });

  it("returns undefined for an item with no number yet (a milestone parent not yet created)", () => {
    expect(matchParent({ number: null, title: "M0 Skeleton" }, byNumber)).toBeUndefined();
  });

  it("returns undefined when the recorded number has no matching live issue", () => {
    expect(matchParent({ number: 999, title: "Contracts (M0 P0)" }, byNumber)).toBeUndefined();
  });
});
