import { describe, expect, it } from "vitest";
import {
  boardDatesMarker,
  bodyUpdate,
  clampToFloor,
  closedStatus,
  followUpAdoptionError,
  leafDates,
  matchParent,
  parentStatus,
  rollUp,
  titleUpdate,
  waveParentStatus,
} from "./board-model.mjs";

describe("waveParentStatus: wave parent close from issue state only (#79)", () => {
  it("gives no Status write for an open wave parent whose tasks are all closed", () => {
    // waveState reflects the plan data ("ready"), not the (irrelevant) fact that
    // every task issue underneath happens to be closed already.
    expect(waveParentStatus({ state: "open" }, "ready")).toBe("Todo"); // #244: no Ready column
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

describe("leafDates: board-dates body marker overrides an after-the-fact issue's dates (#488)", () => {
  const marker = "Filed after the fact.\n<!-- board-dates start=2026-09-30 finish=2026-09-30 -->";
  it("overrides Start and, for an issue closed as completed, Finish", () => {
    expect(
      leafDates({
        created_at: "2026-10-01T00:00:00Z",
        closed_at: "2026-10-01T00:00:00Z",
        state: "closed",
        state_reason: "completed",
        body: marker,
      }),
    ).toEqual({ start: "2026-09-30", finish: "2026-09-30" });
  });

  it("keeps Finish empty while the issue is open or closed as not planned", () => {
    expect(leafDates({ created_at: "2026-10-01T00:00:00Z", state: "open", body: marker })).toEqual({
      start: "2026-09-30",
      finish: null,
    });
    expect(
      leafDates({
        created_at: "2026-10-01T00:00:00Z",
        closed_at: "2026-10-01T00:00:00Z",
        state: "closed",
        state_reason: "not_planned",
        body: marker,
      }),
    ).toEqual({ start: "2026-09-30", finish: null });
  });

  it("takes either attribute alone, clamps to the floor, and ignores a malformed marker", () => {
    const issue = (body: string) =>
      leafDates({
        created_at: "2026-10-01T00:00:00Z",
        closed_at: "2026-10-02T00:00:00Z",
        state: "closed",
        state_reason: "completed",
        body,
      });
    expect(issue("<!-- board-dates finish=2026-09-30 -->")).toEqual({
      start: "2026-10-01",
      finish: "2026-09-30",
    });
    expect(issue("<!-- board-dates start=2026-09-01 -->")).toEqual({
      start: "2026-09-25",
      finish: "2026-10-02",
    });
    for (const bad of [
      "<!-- board-dates start=09-30-2026 -->",
      "board-dates start=2026-09-30",
      "<!-- board-dates -->",
    ]) {
      expect(issue(bad)).toEqual({ start: "2026-10-01", finish: "2026-10-02" });
    }
  });

  it("drops a date that is not a real calendar date (#497 G-M2), keeping the other attribute", () => {
    const issue = (body: string) =>
      leafDates({
        created_at: "2026-10-01T00:00:00Z",
        closed_at: "2026-10-02T00:00:00Z",
        state: "closed",
        state_reason: "completed",
        body,
      });
    expect(issue("<!-- board-dates start=2026-13-45 -->")).toEqual({
      start: "2026-10-01",
      finish: "2026-10-02",
    });
    expect(issue("<!-- board-dates start=2026-02-30 finish=2026-09-30 -->")).toEqual({
      start: "2026-10-01",
      finish: "2026-09-30",
    });
    expect(boardDatesMarker("<!-- board-dates start=2026-13-45 finish=2026-00-10 -->")).toEqual({});
  });

  it("ignores a finish before the start (#497 G-M2)", () => {
    expect(boardDatesMarker("<!-- board-dates start=2026-09-30 finish=2026-09-29 -->")).toEqual({
      start: "2026-09-30",
    });
    expect(boardDatesMarker("<!-- board-dates start=2026-09-30 finish=2026-09-30 -->")).toEqual({
      start: "2026-09-30",
      finish: "2026-09-30",
    });
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

describe("followUpAdoptionError (#96 G-M4, #193 checker ruling)", () => {
  const live = (n: number, labels: string[]) => ({
    number: n,
    labels: labels.map((name) => ({ name })),
  });
  const issues = new Map([
    [61, live(61, ["platform", "follow-up"])],
    [70, live(70, ["platform", "p1"])],
    [75, live(75, ["platform", "p1"])],
  ]);
  const byNumber = (n: number) => issues.get(n);

  it("is null when the data and the live issue agree the follow-up label is present", () => {
    expect(followUpAdoptionError([{ number: 61, labels: ["follow-up"] }], byNumber)).toBeNull();
  });
  it("is null for a follow-up number with no live issue yet (it will be created)", () => {
    expect(followUpAdoptionError([{ number: 999, labels: ["follow-up"] }], byNumber)).toBeNull();
  });
  it("is null when the data and the live issue agree the follow-up label is absent (#75, issue #193)", () => {
    expect(followUpAdoptionError([{ number: 75, labels: [] }], byNumber)).toBeNull();
  });
  it("refuses when the data lists follow-up but the live issue lacks it", () => {
    expect(followUpAdoptionError([{ number: 70, labels: ["follow-up"] }], byNumber)).toMatch(
      /#70.*follow-up/,
    );
  });
  it("refuses when the live issue carries follow-up but the data does not list it", () => {
    const withFollowUp = new Map([[80, live(80, ["follow-up"])]]);
    expect(followUpAdoptionError([{ number: 80, labels: [] }], (n) => withFollowUp.get(n))).toMatch(
      /#80.*follow-up/,
    );
  });
});

describe("parentStatus: Wave/Phase/Milestone Status roll-up from children (#193)", () => {
  it("gives no Status write for a parent with no children", () => {
    expect(parentStatus([], null)).toBeNull();
  });

  it("is In Progress for a P1 phase parent with some closed children", () => {
    expect(parentStatus(["Done", "Todo"], "Todo")).toBe("In Progress");
  });

  it("is Done when every child is closed as completed", () => {
    expect(parentStatus(["Done", "Done"], "Todo")).toBe("Done");
  });

  it("is Todo when no child has started", () => {
    expect(parentStatus(["Todo", "Todo"], "Todo")).toBe("Todo");
  });

  it("keeps a manual Blocked when the roll-up would say In Progress", () => {
    expect(parentStatus(["Done", "Todo"], "Blocked")).toBe("Blocked");
  });

  it("moves a Blocked parent to Done when every child completes (automation may close Blocked)", () => {
    expect(parentStatus(["Done", "Done"], "Blocked")).toBe("Done");
  });

  it("is In Review only when every open (non-Done) started child is In Review", () => {
    expect(parentStatus(["Done", "In Review"], "Todo")).toBe("In Review");
    expect(parentStatus(["In Review", "In Review"], "Todo")).toBe("In Review");
  });

  it("is In Progress when a started child is In Progress alongside an In Review one", () => {
    expect(parentStatus(["In Review", "In Progress"], "Todo")).toBe("In Progress");
  });

  it("is In Progress, not In Review, when an In Review child sits alongside a not-yet-started child (I2)", () => {
    // Brief: "In Progress unless every open child is In Review". A Todo
    // sibling is an open (non-Done) child that is not In Review, so this
    // must not read as "every open child is In Review".
    expect(parentStatus(["In Review", "Todo"], "Todo")).toBe("In Progress");
  });

  it("is In Progress, not In Review, when an In Review child sits alongside a Blocked child (I2)", () => {
    expect(parentStatus(["In Review", "Blocked"], "Todo")).toBe("In Progress");
  });

  it("moves a Blocked parent to In Review when every open child is In Review", () => {
    expect(parentStatus(["Done", "In Review"], "Blocked")).toBe("In Review");
  });

  it("does not count a closed-not-planned child (status stays whatever it was, never Done) as done", () => {
    // A closed-not-planned child never gets forced to Done by truth(); its
    // Status field stays at its prior value (here Todo), so it is neither
    // "every child done" nor "started".
    expect(parentStatus(["Done", "Todo"], "Todo")).toBe("In Progress");
    expect(parentStatus(["Todo", "Todo"], "Todo")).toBe("Todo");
  });

  it("rolls a milestone up over its phase parents' own already-computed statuses", () => {
    // A milestone's children are phase parents; parentStatus is applied again
    // one level up using their Status values, so nesting composes.
    expect(parentStatus(["In Progress", "Todo"], "Todo")).toBe("In Progress");
    expect(parentStatus(["Done", "Done"], "Todo")).toBe("Done");
  });
});
