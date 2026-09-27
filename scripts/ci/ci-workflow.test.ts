import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// ADR-0008: one aggregate `ci` check, path-scoped jobs. This test parses the
// real ci.yml so a structural regression fails here instead of only in CI.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = resolve(root, ".github", "workflows", "ci.yml");
// biome-ignore lint/suspicious/noExplicitAny: the parsed workflow has no local type
const workflow: any = parse(readFileSync(workflowPath, "utf8"));
// biome-ignore lint/suspicious/noExplicitAny: same as above
const jobs: Record<string, any> = workflow.jobs;
const jobIds = Object.keys(jobs);

// biome-ignore lint/suspicious/noExplicitAny: same as above
function jobNeeds(job: any): string[] {
  if (!job?.needs) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

describe("ci.yml structure (ADR-0008)", () => {
  it("has an aggregate `ci` job that runs always() and needs every other job except sensitive-review", () => {
    const ci = jobs.ci;
    expect(ci).toBeDefined();
    expect(ci.if).toBe("always()");
    const expected = jobIds.filter((id) => id !== "ci" && id !== "sensitive-review").sort();
    expect(jobNeeds(ci).sort()).toEqual(expected);
  });

  it("every job sets timeout-minutes", () => {
    for (const id of jobIds) {
      expect(jobs[id]["timeout-minutes"], `job ${id} is missing timeout-minutes`).toBeTypeOf(
        "number",
      );
    }
  });

  it("the lockfile pre-install guard step precedes pnpm/action-setup in `checks`", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
    const steps: any[] = jobs.checks.steps;
    const guardIndex = steps.findIndex(
      (s) => typeof s.run === "string" && s.run.includes("lockfile-guard.mjs"),
    );
    const setupIndex = steps.findIndex(
      (s) => typeof s.uses === "string" && s.uses.startsWith("pnpm/action-setup"),
    );
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(setupIndex);
  });

  it("`web` and `mobile` jobs need `checks`", () => {
    expect(jobNeeds(jobs.web)).toContain("checks");
    expect(jobNeeds(jobs.mobile)).toContain("checks");
  });

  it("the aggregate step reads job results through env, never interpolating the placeholder syntax into the run body", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
    const steps: any[] = jobs.ci.steps;
    const aggregate = steps.find(
      (s) =>
        typeof s.run === "string" &&
        s.env &&
        Object.values(s.env).some((v) => typeof v === "string" && v.includes("toJSON(needs)")),
    );
    expect(aggregate, "no aggregate step reads needs via an env var").toBeDefined();
    expect(aggregate.run.includes("${{")).toBe(false);
  });
});

describe("ci.yml aggregate and caps (task 605 critic M2, quality Q1)", () => {
  // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
  const step: any = jobs.ci.steps.find((s: { run?: unknown }) => typeof s.run === "string");
  const run: string = step.run;
  const script = run.slice(run.indexOf("'") + 1, run.lastIndexOf("'"));
  const aggregate = (needs: unknown) =>
    spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, NEEDS_JSON: JSON.stringify(needs) },
      encoding: "utf8",
    }).status;
  const all = (result: string) =>
    Object.fromEntries(jobNeeds(jobs.ci).map((id) => [id, { result, outputs: {} }]));

  it("passes when every needed job succeeded or was skipped", () => {
    expect(aggregate(all("success"))).toBe(0);
    expect(aggregate({ ...all("success"), web: { result: "skipped" } })).toBe(0);
  });

  it("fails on failure, cancelled, a missing or unknown result, or no jobs at all", () => {
    for (const result of ["failure", "cancelled", "", "neutral"])
      expect(aggregate({ ...all("success"), checks: { result } }), result).toBe(1);
    expect(aggregate({ ...all("success"), checks: {} })).toBe(1);
    expect(aggregate({})).toBe(1);
  });

  it("caps timeouts: changes and ci at most 5 minutes, every other job at most 20", () => {
    for (const id of jobIds) {
      const cap = id === "changes" || id === "ci" ? 5 : 20;
      expect(jobs[id]["timeout-minutes"], id).toBeLessThanOrEqual(cap);
    }
  });

  it("`web` and `mobile` also need `changes`", () => {
    expect(jobNeeds(jobs.web)).toContain("changes");
    expect(jobNeeds(jobs.mobile)).toContain("changes");
  });

  it("checks runs the schema-table write guard over packages/api/src (#189)", () => {
    const runs = (jobs.checks.steps as Array<{ run?: string }>).map((st) => st.run ?? "");
    expect(runs).toContain("node scripts/ci/check-schema-writes.ts packages/api/src");
  });

  it("`web` and `mobile` fail open when `changes` emits no key (#96 G-M2)", () => {
    expect(jobs.web.if).toBe("needs.changes.outputs.web != 'false'");
    expect(jobs.mobile.if).toBe("needs.changes.outputs.mobile != 'false'");
  });
});
