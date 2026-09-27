import { describe, expect, it } from "vitest";
import {
  bodyUpdate,
  clampToFloor,
  closedStatus,
  leafDates,
  matchParent,
  rollUp,
  titleUpdate,
  waveParentStatus,
} from "./board-model.mjs";

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

  it("returns undefined for an item with no recorded number yet (created on --apply)", () => {
    expect(matchParent({ number: null, title: "M0 Skeleton" }, byNumber)).toBeUndefined();
  });
});

describe("clampToFloor: no date before the project's 2026-09-25 start (#80 req. 4)", () => {
  it("leaves a date at or after the floor unchanged", () => {
    expect(clampToFloor("2026-09-25")).toBe("2026-09-25");
    expect(clampToFloor("2026-10-01")).toBe("2026-10-01");
  });

  it("clamps a date earlier than the floor up to it", () => {
    expect(clampToFloor("2026-09-20")).toBe("2026-09-25");
  });

  it("clamps a longer ISO timestamp by its date part", () => {
    expect(clampToFloor("2026-09-01T12:00:00Z")).toBe("2026-09-25");
  });

  it("accepts a custom floor", () => {
    expect(clampToFloor("2026-01-01", "2026-06-01")).toBe("2026-06-01");
  });
});

describe("leafDates: Task/Follow-up Start and Finish (#80 req. 4)", () => {
  it("sets Start from created_at and leaves Finish empty for an open issue", () => {
    expect(leafDates({ created_at: "2026-09-27T00:00:00Z", state: "open" })).toEqual({
      start: "2026-09-27",
      finish: null,
    });
  });

  it("sets Finish from closed_at when closed as completed", () => {
    expect(
      leafDates({
        created_at: "2026-09-27T00:00:00Z",
        closed_at: "2026-09-30T00:00:00Z",
        state: "closed",
        state_reason: "completed",
      }),
    ).toEqual({ start: "2026-09-27", finish: "2026-09-30" });
  });

  it("leaves Finish empty for a closed not-planned issue", () => {
    expect(
      leafDates({
        created_at: "2026-09-27T00:00:00Z",
        closed_at: "2026-09-30T00:00:00Z",
        state: "closed",
        state_reason: "not_planned",
      }),
    ).toEqual({ start: "2026-09-27", finish: null });
  });

  it("clamps both Start and Finish to the floor", () => {
    expect(
      leafDates({
        created_at: "2026-09-01T00:00:00Z",
        closed_at: "2026-09-10T00:00:00Z",
        state: "closed",
        state_reason: "completed",
      }),
    ).toEqual({ start: "2026-09-25", finish: "2026-09-25" });
  });
});

describe("rollUp: parent dates from children, bottom up (#80 req. 5)", () => {
  it("gives no dates when no child has one", () => {
    expect(rollUp([{ start: null, finish: null, closed: false }])).toEqual({
      start: null,
      finish: null,
    });
  });

  it("sets Finish to the latest child Finish once every child is closed", () => {
    expect(
      rollUp([
        { start: "2026-09-25", finish: "2026-09-27", closed: true },
        { start: "2026-09-26", finish: "2026-09-30", closed: true },
      ]),
    ).toEqual({ start: "2026-09-25", finish: "2026-09-30" });
  });

  it("keeps Finish as the latest date so far while any child is open", () => {
    expect(
      rollUp([
        { start: "2026-09-25", finish: "2026-09-25", closed: true },
        { start: "2026-09-26", finish: null, closed: false },
      ]),
    ).toEqual({ start: "2026-09-25", finish: "2026-09-26" });
  });

  it("ignores an undated child for Start/Finish but still requires it closed for the all-closed check", () => {
    expect(
      rollUp([
        { start: "2026-09-25", finish: "2026-09-27", closed: true },
        { start: null, finish: null, closed: false },
      ]),
    ).toEqual({ start: "2026-09-25", finish: "2026-09-27" });
  });

  it("gives no Finish when every child is closed but none has one (all closed not-planned)", () => {
    expect(
      rollUp([
        { start: "2026-09-25", finish: null, closed: true },
        { start: "2026-09-26", finish: null, closed: true },
      ]),
    ).toEqual({ start: "2026-09-25", finish: null });
  });

  it("rolls up three levels deep (task -> wave -> phase)", () => {
    const wave1 = rollUp([
      { start: "2026-09-25", finish: "2026-09-26", closed: true },
      { start: "2026-09-26", finish: "2026-09-28", closed: true },
    ]);
    const wave2 = rollUp([{ start: "2026-09-29", finish: null, closed: false }]);
    const phase = rollUp([
      { ...wave1, closed: true },
      { ...wave2, closed: false },
    ]);
    expect(phase).toEqual({ start: "2026-09-25", finish: "2026-09-29" });
  });
});

describe("matchParent: a recorded number with no live issue fails closed (W5 wave-end)", () => {
  it("throws instead of letting --apply create a duplicate on every run", () => {
    expect(() => matchParent({ number: 999, title: "Gone (M9 P9)" }, () => undefined)).toThrow(
      "issue #999 (Gone (M9 P9)) is recorded in the setup-script data but not found",
    );
  });
});

describe("closedStatus: Done only for an issue closed as completed (#79)", () => {
  it("is Done for closed completed and for a closed issue with no reason", () => {
    expect(closedStatus({ state: "closed", state_reason: "completed" })).toBe("Done");
    expect(closedStatus({ state: "closed", state_reason: null })).toBe("Done");
  });
  it("is undefined for closed not planned, duplicate, and open issues", () => {
    expect(closedStatus({ state: "closed", state_reason: "not_planned" })).toBeUndefined();
    expect(closedStatus({ state: "closed", state_reason: "duplicate" })).toBeUndefined();
    expect(closedStatus({ state: "open" })).toBeUndefined();
  });
});
