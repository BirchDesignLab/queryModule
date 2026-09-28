import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { leafDates, parentStatus, rollUp } from "../ops/board-model.mjs";

/**
 * Runs the board job's github-script body (.github/workflows/project-sync.yml) against
 * fake GitHub clients, so the reconcile rules are tested without the network.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath =
  process.env.PROJECT_SYNC_YML ?? join(root, ".github/workflows/project-sync.yml");

function boardScript(): string {
  const lines = readFileSync(workflowPath, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "script: |");
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() !== "" && !l.startsWith("            ")) break;
    body.push(l.slice(12));
  }
  return body.join("\n");
}

const REPO = "BirchDesignLab/queryModule";
interface FakeItem {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  stateReason?: string | null;
  status?: string;
  level?: string;
  wave?: string;
  parentNumber?: number;
  sub?: { total: number; completed: number };
  prs?: Array<{ state: string; isDraft: boolean; repo: string | null }>;
  createdAt?: string;
  closedAt?: string | null;
  start?: string;
  finish?: string;
}

async function runBoard(
  items: FakeItem[],
  event: { eventName: string; payload: unknown; ref?: string },
  opts: { noLevelField?: boolean; notices?: string[]; closed?: number[] } = {},
) {
  const writes: Array<{ item: number; field: string; value: string | null }> = [];
  const itemId = (n: number) => `item-${n}`;
  const numberOf = (id: string) => Number(id.slice(5));
  const fields = [
    {
      id: "f-status",
      name: "Status",
      options: ["Todo", "In Progress", "In Review", "Blocked", "Done"],
    },
    ...(opts.noLevelField
      ? []
      : [
          {
            id: "f-level",
            name: "Level",
            options: ["Milestone", "Phase", "Wave", "Task", "Follow-up"],
          },
        ]),
    { id: "f-start", name: "Start" },
    { id: "f-finish", name: "Finish" },
  ].map((f) => ({ ...f, options: f.options?.map((o) => ({ id: `o-${o}`, name: o })) }));
  const nameOfField = (id: string) => fields.find((f) => f.id === id)?.name ?? id;
  const pm = {
    graphql: async (q: string, v: Record<string, unknown>) => {
      if (q.includes("user(login:"))
        return { user: { projectV2: { id: "p", fields: { nodes: fields } } } };
      if (q.includes("items(first:100"))
        return {
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: items.map((i) => ({
                id: itemId(i.number),
                content: {
                  number: i.number,
                  title: i.title,
                  state: i.state,
                  stateReason: i.stateReason ?? null,
                  createdAt: i.createdAt ?? "2026-09-25T00:00:00Z",
                  closedAt: i.closedAt ?? (i.state === "CLOSED" ? "2026-09-26T00:00:00Z" : null),
                  repository: { nameWithOwner: REPO },
                  parent: i.parentNumber ? { number: i.parentNumber, title: "" } : null,
                  subIssuesSummary: i.sub ?? { total: 0, completed: 0 },
                  closedByPullRequestsReferences: {
                    nodes: (i.prs ?? []).map((p) => ({
                      state: p.state,
                      isDraft: p.isDraft,
                      headRepository: p.repo ? { nameWithOwner: p.repo } : null,
                    })),
                  },
                },
                fieldValues: {
                  nodes: [
                    ...(i.status ? [{ name: i.status, field: { name: "Status" } }] : []),
                    ...(i.level ? [{ name: i.level, field: { name: "Level" } }] : []),
                    ...(i.wave ? [{ name: i.wave, field: { name: "Wave" } }] : []),
                    ...(i.start ? [{ date: i.start, field: { name: "Start" } }] : []),
                    ...(i.finish ? [{ date: i.finish, field: { name: "Finish" } }] : []),
                  ],
                },
              })),
            },
          },
        };
      const value = v.v as { singleSelectOptionId?: string; date?: string } | undefined;
      writes.push({
        item: numberOf(String(v.i)),
        field: nameOfField(String(v.f)),
        value: value ? (value.singleSelectOptionId?.slice(2) ?? value.date ?? null) : null,
      });
      return {};
    },
  };
  const github = {
    rest: {
      issues: {
        update: async (a: { issue_number: number }) => {
          opts.closed?.push(a.issue_number);
          return {};
        },
      },
    },
  };
  const context = {
    ...event,
    repo: { owner: "BirchDesignLab", repo: "queryModule" },
  };
  const core = { info: () => {}, notice: (m: string) => opts.notices?.push(m) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...a: unknown[]) => Promise<void>;
  const fn = new AsyncFunction("github", "context", "core", "getOctokit", boardScript());
  await fn(github, context, core, () => pm);
  return writes;
}

const saved = process.env.PROJECT_TOKEN;
afterEach(() => {
  if (saved === undefined) delete process.env.PROJECT_TOKEN;
  else process.env.PROJECT_TOKEN = saved;
});

describe("project-sync board job", () => {
  const issueEvent = { eventName: "issues", payload: { issue: { number: 1 } } };

  it("reconciles every item on every run, so a dropped run is healed (I2)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 1, title: "a", state: "CLOSED", stateReason: "COMPLETED", status: "Done" },
        { number: 2, title: "b", state: "CLOSED", stateReason: "COMPLETED", status: "In Review" },
      ],
      issueEvent,
    );
    expect(writes).toContainEqual({ item: 2, field: "Status", value: "Done" });
    expect(writes.find((w) => w.item === 2 && w.field === "Finish")?.value).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("moves an open item with no PR or wave from Done or In Review back to Todo (M2)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 1, title: "reopened", state: "OPEN", status: "Done" },
        { number: 2, title: "pr closed unmerged", state: "OPEN", status: "In Review" },
        { number: 3, title: "blocked", state: "OPEN", status: "Blocked" },
        { number: 4, title: "started by hand", state: "OPEN", status: "In Progress" },
      ],
      issueEvent,
    );
    const statuses = writes.filter((w) => w.field === "Status");
    expect(statuses).toEqual([
      { item: 1, field: "Status", value: "Todo" },
      { item: 2, field: "Status", value: "Todo" },
    ]);
  });

  it("ignores fork PRs closing an issue (M3)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const fork = "someone-else/queryModule";
    const writes = await runBoard(
      [
        {
          number: 1,
          title: "task",
          state: "OPEN",
          status: "Todo",
          prs: [{ state: "OPEN", isDraft: false, repo: fork }],
        },
        {
          number: 3,
          title: "own PR",
          state: "OPEN",
          status: "Todo",
          prs: [{ state: "OPEN", isDraft: false, repo: REPO }],
        },
      ],
      issueEvent,
    );
    const statuses = writes.filter((w) => w.field === "Status");
    expect(statuses).toEqual([{ item: 3, field: "Status", value: "In Review" }]);
  });

  it("triggers on pull_request edited, for a Closes line added later (M2)", () => {
    expect(readFileSync(workflowPath, "utf8")).toMatch(/types: \[[^\]]*\bedited\b[^\]]*\]/);
  });

  it("has no push trigger and no P0 wave-branch name anywhere (#193: branch detection dropped)", () => {
    const text = readFileSync(workflowPath, "utf8");
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\npermissions:"));
    expect(on).not.toMatch(/^\s*push:/m);
    expect(text).not.toMatch(/feat\/p0-wave-/);
    expect(text).not.toMatch(/waveStatus|waveCache|waveOf|waveNumber/);
  });

  it("gives a P0 task with an open non-draft closing PR In Review, a draft one In Progress, no PR leaves it as it is, and a closed-completed issue Done (no branch fallback, #193)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 1,
          title: "reviewed task",
          state: "OPEN",
          status: "Todo",
          prs: [{ state: "OPEN", isDraft: false, repo: REPO }],
        },
        {
          number: 2,
          title: "drafted task",
          state: "OPEN",
          status: "Todo",
          prs: [{ state: "OPEN", isDraft: true, repo: REPO }],
        },
        { number: 3, title: "untouched task", state: "OPEN", status: "Ready" },
        { number: 4, title: "done task", state: "CLOSED", stateReason: "COMPLETED" },
      ],
      issueEvent,
    );
    const statuses = writes.filter((w) => w.field === "Status");
    expect(statuses).toEqual([
      { item: 1, field: "Status", value: "In Review" },
      { item: 2, field: "Status", value: "In Progress" },
      { item: 4, field: "Status", value: "Done" },
    ]);
  });

  it("closes a wave parent identified by the Level field, not a title regex (C1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 1: Workspace and first contracts (Tasks 1 to 6)",
          state: "OPEN",
          level: "Wave",
          sub: { total: 2, completed: 2 },
        },
      ],
      issueEvent,
    );
    expect(writes).toContainEqual({ item: 55, field: "Status", value: "Done" });
  });

  it("does not close an open item with Level Wave whose title no longer matches the retired regex, when its sub-issues are incomplete (C1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 1: Workspace and first contracts (Tasks 1 to 6)",
          state: "OPEN",
          status: "Todo",
          level: "Wave",
          sub: { total: 2, completed: 1 },
        },
      ],
      issueEvent,
    );
    expect(writes.find((w) => w.item === 55 && w.field === "Status")).toBeUndefined();
  });

  it("leaves an open task with no closing PR unchanged, even under a renamed wave parent (no branch fallback, C1, #193)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 9: Renamed wave parent (Tasks 90 to 91)",
          state: "OPEN",
          level: "Wave",
          sub: { total: 2, completed: 0 },
        },
        { number: 2, title: "child task", state: "OPEN", status: "Ready", parentNumber: 55 },
      ],
      issueEvent,
    );
    expect(writes.find((w) => w.item === 2 && w.field === "Status")).toBeUndefined();
  });
});

describe("project-sync board job: Start/Finish roll-up (#80 requirements 4-6)", () => {
  const issueEvent = { eventName: "issues", payload: { issue: { number: 1 } } };

  it("skips the wave-parent close and the date roll-up, with a notice, while the Level field is missing (PR #83 review M1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const notices: string[] = [];
    const closed: number[] = [];
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 1",
          state: "OPEN",
          level: "Wave",
          sub: { total: 1, completed: 1 },
        },
        {
          number: 1,
          title: "task",
          state: "CLOSED",
          stateReason: "COMPLETED",
          status: "Done",
          createdAt: "2026-09-26T00:00:00Z",
          closedAt: "2026-09-27T00:00:00Z",
          parentNumber: 55,
        },
      ],
      issueEvent,
      { noLevelField: true, notices, closed },
    );
    expect(closed).toEqual([]);
    expect(writes.filter((w) => w.field === "Start" || w.field === "Finish")).toEqual([]);
    expect(notices.some((n) => /Level field missing/.test(n))).toBe(true);
  });

  it("closes the same wave parent and rolls up once the Level field exists (PR #83 review M1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const closed: number[] = [];
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 1",
          state: "OPEN",
          level: "Wave",
          sub: { total: 1, completed: 1 },
        },
        {
          number: 1,
          title: "task",
          state: "CLOSED",
          stateReason: "COMPLETED",
          status: "Done",
          createdAt: "2026-09-26T00:00:00Z",
          closedAt: "2026-09-27T00:00:00Z",
          parentNumber: 55,
        },
      ],
      issueEvent,
      { closed },
    );
    expect(closed).toEqual([55]);
    expect(writes).toContainEqual({ item: 55, field: "Finish", value: "2026-09-27" });
  });

  it("can be run by hand (workflow_dispatch), once after gh-setup-project --apply (PR #83 review M1)", () => {
    const text = readFileSync(workflowPath, "utf8");
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\npermissions:"));
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("sets a leaf's Start from its created date, clamped to the 2026-09-25 floor", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 1,
          title: "task",
          state: "OPEN",
          status: "Todo",
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
      issueEvent,
    );
    expect(writes).toContainEqual({ item: 1, field: "Start", value: "2026-09-25" });
  });

  it("sets a leaf's Finish from its closed date only when closed as completed", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 1,
          title: "done task",
          state: "CLOSED",
          stateReason: "COMPLETED",
          status: "Done",
          createdAt: "2026-09-25T00:00:00Z",
          closedAt: "2026-09-28T00:00:00Z",
        },
        {
          number: 2,
          title: "not planned",
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
          createdAt: "2026-09-25T00:00:00Z",
          closedAt: "2026-09-28T00:00:00Z",
        },
      ],
      issueEvent,
    );
    expect(writes).toContainEqual({ item: 1, field: "Finish", value: "2026-09-28" });
    expect(writes.find((w) => w.item === 2 && w.field === "Finish")).toBeUndefined();
  });

  it("rolls up a wave parent's Start/Finish from its child tasks, identified by the Level field", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 1",
          state: "OPEN",
          level: "Wave",
          sub: { total: 2, completed: 1 },
        },
        {
          number: 1,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          status: "Done",
          createdAt: "2026-09-25T00:00:00Z",
          closedAt: "2026-09-27T00:00:00Z",
          parentNumber: 55,
        },
        {
          number: 2,
          title: "task b",
          state: "OPEN",
          status: "In Progress",
          createdAt: "2026-09-26T00:00:00Z",
          parentNumber: 55,
        },
      ],
      issueEvent,
    );
    // Wave still has an open child: Start is the earliest child Start, Finish
    // is the latest child date so far (not yet "every child closed").
    expect(writes).toContainEqual({ item: 55, field: "Start", value: "2026-09-25" });
    expect(writes).toContainEqual({ item: 55, field: "Finish", value: "2026-09-27" });
  });
});

describe("project-sync board job: parent Status roll-up beyond P0 (#193)", () => {
  const issueEvent = { eventName: "issues", payload: { issue: { number: 1 } } };

  it("gives no Status write for a parent with no children", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [{ number: 39, title: "Foundation (M0 P1)", state: "OPEN", level: "Phase" }],
      issueEvent,
    );
    expect(writes.find((w) => w.item === 39 && w.field === "Status")).toBeUndefined();
  });

  it("is In Progress for a phase parent with some closed children (issue #193 example)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 39, title: "Foundation (M0 P1)", state: "OPEN", level: "Phase" },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
        { number: 42, title: "task b", state: "OPEN", status: "Todo", parentNumber: 39 },
      ],
      issueEvent,
    );
    expect(writes).toContainEqual({ item: 39, field: "Status", value: "In Progress" });
  });

  it("is Done when every child of a phase parent is closed as completed", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 39, title: "Foundation (M0 P1)", state: "OPEN", level: "Phase" },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
        {
          number: 42,
          title: "task b",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
      ],
      issueEvent,
    );
    expect(writes).toContainEqual({ item: 39, field: "Status", value: "Done" });
  });

  it("is Todo when no child of a phase parent has started", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 39, title: "Foundation (M0 P1)", state: "OPEN", level: "Phase" },
        { number: 41, title: "task a", state: "OPEN", status: "Todo", parentNumber: 39 },
      ],
      issueEvent,
    );
    expect(writes).toContainEqual({ item: 39, field: "Status", value: "Todo" });
  });

  it("keeps a manually set Blocked phase parent even though the roll-up would say In Progress", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 39,
          title: "Foundation (M0 P1)",
          state: "OPEN",
          status: "Blocked",
          level: "Phase",
        },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
        { number: 42, title: "task b", state: "OPEN", status: "Todo", parentNumber: 39 },
      ],
      issueEvent,
    );
    expect(writes.find((w) => w.item === 39 && w.field === "Status")).toBeUndefined();
  });

  it("does not count a closed-not-planned child as done", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 39, title: "Foundation (M0 P1)", state: "OPEN", level: "Phase" },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
        {
          number: 42,
          title: "task b (not planned)",
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
          status: "Todo",
          parentNumber: 39,
        },
      ],
      issueEvent,
    );
    // Not every child is Done (the not-planned one stays at its prior Status,
    // never forced to Done), so this is In Progress, never Done.
    expect(writes).toContainEqual({ item: 39, field: "Status", value: "In Progress" });
  });

  it("rolls a milestone up over its phase parents, which have themselves already rolled up over their tasks", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 90, title: "M0 Skeleton", state: "OPEN", level: "Milestone" },
        {
          number: 39,
          title: "Foundation (M0 P1)",
          state: "OPEN",
          level: "Phase",
          parentNumber: 90,
        },
        {
          number: 40,
          title: "Contracts (M0 P0)",
          state: "OPEN",
          level: "Phase",
          parentNumber: 90,
        },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
        { number: 42, title: "task b", state: "OPEN", status: "Todo", parentNumber: 39 },
        {
          number: 43,
          title: "task c",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 40,
        },
        {
          number: 44,
          title: "task d",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 40,
        },
      ],
      issueEvent,
    );
    // Phase 39 rolls up to In Progress (one done, one not started); phase 40
    // rolls up to Done (every child done); the milestone rolls up over those
    // two computed phase statuses to In Progress.
    expect(writes).toContainEqual({ item: 39, field: "Status", value: "In Progress" });
    expect(writes).toContainEqual({ item: 40, field: "Status", value: "Done" });
    expect(writes).toContainEqual({ item: 90, field: "Status", value: "In Progress" });
  });

  it("keeps a wave parent Done after it auto-closes this run, even with a registered not-planned child (S1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 1: Workspace and first contracts (Tasks 1 to 6)",
          state: "OPEN",
          level: "Wave",
          sub: { total: 2, completed: 2 },
        },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          status: "Done",
          parentNumber: 55,
        },
        {
          number: 42,
          title: "task b (not planned)",
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
          status: "Todo",
          parentNumber: 55,
        },
      ],
      issueEvent,
    );
    const statuses = writes.filter((w) => w.item === 55 && w.field === "Status");
    // The wave-parent close (reconcile, above) already wrote Done from the
    // issue's own new state; the children-based roll-up must not then
    // overwrite it with In Progress just because the not-planned child never
    // reaches Done on its own (S1).
    expect(statuses).toEqual([{ item: 55, field: "Status", value: "Done" }]);
  });

  it("does not roll up a closed-not-planned phase parent from its children (C1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 39,
          title: "Foundation (M0 P1)",
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
          status: "Todo",
          level: "Phase",
        },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
        { number: 42, title: "task b", state: "OPEN", status: "Todo", parentNumber: 39 },
      ],
      issueEvent,
    );
    expect(writes.find((w) => w.item === 39 && w.field === "Status")).toBeUndefined();
  });

  it("does not override a parent's own open closing PR with the children roll-up (C1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 39,
          title: "Foundation (M0 P1)",
          state: "OPEN",
          status: "Todo",
          level: "Phase",
          prs: [{ state: "OPEN", isDraft: false, repo: REPO }],
        },
        { number: 41, title: "task a", state: "OPEN", status: "Todo", parentNumber: 39 },
      ],
      issueEvent,
    );
    const statuses = writes.filter((w) => w.item === 39 && w.field === "Status");
    expect(statuses).toEqual([{ item: 39, field: "Status", value: "In Review" }]);
  });

  it("does not reset an already-Done open parent to Todo before the roll-up runs (I1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        { number: 39, title: "Foundation (M0 P1)", state: "OPEN", status: "Done", level: "Phase" },
        {
          number: 41,
          title: "task a",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
        {
          number: 42,
          title: "task b",
          state: "CLOSED",
          stateReason: "COMPLETED",
          parentNumber: 39,
        },
      ],
      issueEvent,
    );
    const statuses = writes.filter((w) => w.item === 39 && w.field === "Status");
    expect(statuses).toEqual([]);
  });
});

/**
 * Parity (#193, same pattern as the leafDates/rollUp parity below): the board
 * job's inline copy of the Status roll-up and board-model.mjs's parentStatus
 * must give the parent the same answer. Each case builds a phase parent (39)
 * with children whose own Status the job will independently compute to the
 * listed value, then checks the parent's resulting Status against calling
 * parentStatus() directly on that same list.
 */
describe("project-sync board job: parity with board-model.mjs parentStatus (#193)", () => {
  const issueEvent = { eventName: "issues", payload: { issue: { number: 1 } } };

  function childFor(status: string, number: number, parentNumber: number): FakeItem {
    if (status === "Done")
      return {
        number,
        title: `child ${number}`,
        state: "CLOSED",
        stateReason: "COMPLETED",
        parentNumber,
      };
    if (status === "In Review")
      return {
        number,
        title: `child ${number}`,
        state: "OPEN",
        status: "Todo",
        prs: [{ state: "OPEN", isDraft: false, repo: REPO }],
        parentNumber,
      };
    if (status === "In Progress")
      return {
        number,
        title: `child ${number}`,
        state: "OPEN",
        status: "Todo",
        prs: [{ state: "OPEN", isDraft: true, repo: REPO }],
        parentNumber,
      };
    return { number, title: `child ${number}`, state: "OPEN", status: "Todo", parentNumber };
  }

  const cases: Array<[string, string[], string | null]> = [
    ["no children", [], null],
    ["some closed, some not", ["Done", "Todo"], null],
    ["all closed", ["Done", "Done"], null],
    ["none started", ["Todo", "Todo"], null],
    ["Blocked kept over In Progress", ["Done", "Todo"], "Blocked"],
    ["Blocked moved to Done", ["Done", "Done"], "Blocked"],
    ["every open child In Review", ["Done", "In Review"], null],
    ["mixed In Review/In Progress", ["In Review", "In Progress"], null],
  ];

  it.each(cases)(
    "%s: parent Status matches parentStatus()",
    async (_name, childStatuses, current) => {
      process.env.PROJECT_TOKEN = "fake";
      const parentItem: FakeItem = {
        number: 39,
        title: "Foundation (M0 P1)",
        state: "OPEN",
        level: "Phase",
        ...(current ? { status: current } : {}),
      };
      const children = childStatuses.map((s, i) => childFor(s, 100 + i, 39));
      const writes = await runBoard([parentItem, ...children], issueEvent);
      const last =
        writes.filter((w) => w.item === 39 && w.field === "Status").at(-1)?.value ?? null;
      const actual = last ?? current ?? null;
      expect(actual).toBe(parentStatus(childStatuses, current));
    },
  );
});

/**
 * Parity (PR #83 review M2): the board job's inline leafDates/rollUp and
 * board-model.mjs's must give every item the same Start and Finish. The
 * reference walks the same child sets as the job (each child's live `parent`
 * link, any depth). gh-setup-project.mjs derives its child sets from its data
 * instead (tasks by number range, phase over waves only), and only seeds empty
 * Start/Finish, so project-sync's values win after the first run.
 */
function referenceDates(items: FakeItem[]) {
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const memo = new Map<number, { start: string | null; finish: string | null; closed: boolean }>();
  const infoOf = (n: number): { start: string | null; finish: string | null; closed: boolean } => {
    const cached = memo.get(n);
    if (cached) return cached;
    const i = byNumber.get(n) as FakeItem;
    const closed = i.state === "CLOSED";
    const info =
      i.level === "Wave" || i.level === "Phase" || i.level === "Milestone"
        ? {
            ...rollUp(items.filter((c) => c.parentNumber === n).map((c) => infoOf(c.number))),
            closed,
          }
        : {
            ...leafDates({
              created_at: i.createdAt ?? "2026-09-25T00:00:00Z",
              closed_at: i.closedAt ?? (closed ? "2026-09-26T00:00:00Z" : null),
              state: closed ? "closed" : "open",
              state_reason: i.stateReason?.toLowerCase() ?? null,
            }),
            closed,
          };
    memo.set(n, info);
    return info;
  };
  return new Map(items.map((i) => [i.number, infoOf(i.number)]));
}

const task = (
  number: number,
  parentNumber: number,
  createdAt: string,
  closed?: { at: string; reason?: string },
): FakeItem => ({
  number,
  title: `task ${number}`,
  state: closed ? "CLOSED" : "OPEN",
  stateReason: closed ? (closed.reason ?? "COMPLETED") : null,
  status: closed ? "Done" : "Todo",
  level: "Task",
  createdAt,
  closedAt: closed?.at ?? null,
  parentNumber,
});
const parent = (
  number: number,
  level: string,
  parentNumber?: number,
  closed = false,
): FakeItem => ({
  number,
  title: `${level} ${number}`,
  state: closed ? "CLOSED" : "OPEN",
  stateReason: closed ? "COMPLETED" : null,
  level,
  parentNumber,
  // Incomplete, so the job never closes a parent mid-test.
  sub: { total: 2, completed: 0 },
});

describe("project-sync board job: parity with board-model.mjs (PR #83 review M2)", () => {
  const issueEvent = { eventName: "issues", payload: { issue: { number: 1 } } };
  const cases: Array<[string, FakeItem[]]> = [
    [
      "a wave with an open child (latest child date so far)",
      [
        parent(55, "Wave"),
        task(1, 55, "2026-09-20T00:00:00Z", { at: "2026-09-27T00:00:00Z" }),
        task(2, 55, "2026-09-26T00:00:00Z"),
      ],
    ],
    [
      "a wave whose children are all closed (latest child Finish)",
      [
        parent(55, "Wave", undefined, true),
        task(1, 55, "2026-09-25T00:00:00Z", { at: "2026-09-28T00:00:00Z" }),
        task(2, 55, "2026-09-26T00:00:00Z", { at: "2026-09-30T00:00:00Z" }),
      ],
    ],
    [
      "a not-planned leaf (no Finish of its own, still closed for the roll-up)",
      [
        parent(55, "Wave"),
        task(1, 55, "2026-09-25T00:00:00Z", { at: "2026-09-28T00:00:00Z" }),
        task(2, 55, "2026-09-29T00:00:00Z", { at: "2026-10-02T00:00:00Z", reason: "NOT_PLANNED" }),
      ],
    ],
    [
      "a multi-level milestone > phase > wave > task tree, with a follow-up under the phase",
      [
        parent(90, "Milestone"),
        parent(39, "Phase", 90),
        parent(55, "Wave", 39),
        parent(56, "Wave", 39),
        task(1, 55, "2026-09-25T00:00:00Z", { at: "2026-09-26T00:00:00Z" }),
        task(2, 56, "2026-09-27T00:00:00Z", { at: "2026-09-29T00:00:00Z" }),
        task(3, 56, "2026-09-28T00:00:00Z"),
        { ...task(4, 39, "2026-10-01T00:00:00Z"), level: "Follow-up" },
      ],
    ],
    [
      "a parent with no children (no dates) beside a pre-floor leaf (clamped)",
      [parent(55, "Wave"), task(1, 60, "2026-09-01T00:00:00Z", { at: "2026-09-10T00:00:00Z" })],
    ],
  ];

  it.each(cases)("%s: every item's Start and Finish match", async (_name, items) => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(items, issueEvent);
    const last = (n: number, f: string) =>
      writes.filter((w) => w.item === n && w.field === f).at(-1)?.value ?? null;
    const expected = referenceDates(items);
    for (const i of items) {
      const want = expected.get(i.number);
      expect({
        item: i.number,
        start: last(i.number, "Start"),
        finish: last(i.number, "Finish"),
      }).toEqual({ item: i.number, start: want?.start ?? null, finish: want?.finish ?? null });
    }
  });
});
