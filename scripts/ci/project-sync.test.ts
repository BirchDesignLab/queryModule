import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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
}
interface WaveBranch {
  ref: boolean;
  prs: Array<{ isDraft: boolean; repo: string | null }>;
}

async function runBoard(
  items: FakeItem[],
  event: { eventName: string; payload: unknown; ref?: string },
  waves: Record<string, WaveBranch> = {},
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
    graphql: async (q: string, v: Record<string, unknown>) => {
      if (q.includes("pullRequests(headRefName")) {
        const k = /feat\/p0-wave-(\d+)/.exec(String(v.b))?.[1] ?? "";
        const w = waves[k] ?? { ref: false, prs: [] };
        return {
          repository: {
            ref: w.ref ? { name: String(v.b) } : null,
            pullRequests: {
              nodes: w.prs.map((p) => ({
                isDraft: p.isDraft,
                headRepository: p.repo ? { nameWithOwner: p.repo } : null,
              })),
            },
          },
        };
      }
      // The pre-I2 script's closingIssuesReferences query.
      return { repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } };
    },
    rest: { issues: { update: async () => ({}) } },
  };
  const context = {
    ...event,
    repo: { owner: "BirchDesignLab", repo: "queryModule" },
  };
  const core = { info: () => {}, notice: () => {} };
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

  it("ignores fork PRs, by closing reference or by wave branch name (M3)", async () => {
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
        { number: 2, title: "wave task", state: "OPEN", status: "Todo", wave: "W9" },
        {
          number: 3,
          title: "own PR",
          state: "OPEN",
          status: "Todo",
          prs: [{ state: "OPEN", isDraft: false, repo: REPO }],
        },
      ],
      issueEvent,
      { "9": { ref: false, prs: [{ isDraft: false, repo: fork }] } },
    );
    const statuses = writes.filter((w) => w.field === "Status");
    expect(statuses).toEqual([{ item: 3, field: "Status", value: "In Review" }]);
  });

  it("triggers on pull_request edited, for a Closes line added later (M2)", () => {
    expect(readFileSync(workflowPath, "utf8")).toMatch(/types: \[[^\]]*\bedited\b[^\]]*\]/);
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

  it("derives a task's wave from its parent's Wave field, not from a title regex, even when the parent has been renamed (C1)", async () => {
    process.env.PROJECT_TOKEN = "fake";
    const writes = await runBoard(
      [
        {
          number: 55,
          title: "Wave 9: Renamed wave parent (Tasks 90 to 91)",
          state: "OPEN",
          level: "Wave",
          wave: "W9",
        },
        { number: 2, title: "child task", state: "OPEN", status: "Todo", parentNumber: 55 },
      ],
      issueEvent,
      { "9": { ref: true, prs: [] } },
    );
    expect(writes).toContainEqual({ item: 2, field: "Status", value: "In Progress" });
  });
});
