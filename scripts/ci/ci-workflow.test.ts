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
  it("has an aggregate `ci` job that runs always() and needs every other job except sensitive-review and publish", () => {
    const ci = jobs.ci;
    expect(ci).toBeDefined();
    expect(ci.if).toBe("always()");
    const expected = jobIds
      .filter((id) => id !== "ci" && id !== "sensitive-review" && id !== "publish")
      .sort();
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

describe("ci.yml image build, boot smoke, publish (task 29, BR-006 SEC-006 NFR-003)", () => {
  it("`image` job is gated on docs-only like the other gated jobs", () => {
    expect(jobs.image).toBeDefined();
    expect(jobNeeds(jobs.image)).toEqual(["changes"]);
    expect(jobs.image.if).toBe("needs.changes.outputs.docs_only != 'true'");
  });

  it("`image` job's boot-smoke down step always runs, even if an earlier step failed", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
    const steps: any[] = jobs.image.steps;
    const down = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("boot-smoke.sh down"),
    );
    expect(down, "no boot-smoke.sh down step in the image job").toBeDefined();
    expect(down.if).toBe("always()");
  });

  it("`image` job builds and boots the same tag it smoke-tests (querymodule:ci)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
    const steps: any[] = jobs.image.steps;
    const build = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("docker buildx build"),
    );
    expect(build?.run).toContain("--tag querymodule:ci");
    const up = steps.find((s) => typeof s.run === "string" && s.run.includes("boot-smoke.sh up"));
    expect(up?.run).toContain("querymodule:ci");
  });

  it("the aggregate `ci` job needs `image`", () => {
    expect(jobNeeds(jobs.ci)).toContain("image");
  });

  it("`publish` needs `ci`, runs only on a push to main, and never on a pull_request", () => {
    const publish = jobs.publish;
    expect(publish).toBeDefined();
    expect(jobNeeds(publish)).toEqual(["ci"]);
    expect(publish.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    // A pull_request event can never satisfy this condition.
    expect(publish.if.includes("pull_request")).toBe(false);
  });

  it("`publish` has read-only contents and write packages permissions, and pushes sha- and latest tags of the loaded image (not a rebuild)", () => {
    const publish = jobs.publish;
    expect(publish.permissions).toEqual({ contents: "read", packages: "write" });
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
    const steps: any[] = publish.steps;
    // C2 (round 1 review): publish must not build the image itself; it loads
    // and pushes the exact bytes the `image` job already smoke-tested.
    const build = steps.find((s) => s.uses?.startsWith("docker/build-push-action"));
    expect(build, "publish must not rebuild the image (fixes C2)").toBeUndefined();
    const download = steps.find((s) => s.uses?.startsWith("actions/download-artifact"));
    expect(
      download,
      "publish must download the image artifact the `image` job uploaded",
    ).toBeDefined();
    expect(download?.with?.name).toBe("querymodule-image");
    const load = steps.find((s) => typeof s.run === "string" && s.run.includes("docker load"));
    expect(load, "publish must docker load the downloaded image").toBeDefined();
    const push = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("docker push") && s.env,
    );
    expect(push, "no run step pushes both tags through env vars").toBeDefined();
    expect(push?.run.includes("${{")).toBe(false);
    const envValues = Object.values(push?.env ?? {});
    expect(
      envValues.some(
        (v) =>
          typeof v === "string" &&
          v.startsWith("ghcr.io/birchdesignlab/querymodule:sha-") &&
          v.includes("github.sha"),
      ),
    ).toBe(true);
    expect(envValues.some((v) => typeof v === "string" && v.endsWith(":latest"))).toBe(true);
  });

  it("every checkout step in `image` and `publish` sets persist-credentials: false", () => {
    for (const id of ["image", "publish"]) {
      // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
      const steps: any[] = jobs[id].steps;
      const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
      expect(checkout?.with?.["persist-credentials"], `${id} checkout`).toBe(false);
    }
  });

  it("`image` job exposes real GHA cache credentials to the buildx `run:` step (fixes C1)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
    const steps: any[] = jobs.image.steps;
    const runtimeIndex = steps.findIndex((s) =>
      s.uses?.startsWith("crazy-max/ghaction-github-runtime"),
    );
    const buildIndex = steps.findIndex(
      (s) => typeof s.run === "string" && s.run.includes("docker buildx build"),
    );
    expect(
      runtimeIndex,
      "no crazy-max/ghaction-github-runtime step in the image job",
    ).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(runtimeIndex).toBeLessThan(buildIndex);
  });

  it("`image` job saves and uploads the tested image only on a push to main (fixes C2)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow step
    const steps: any[] = jobs.image.steps;
    const pushGate = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
    const save = steps.find(
      (s) =>
        typeof s.run === "string" &&
        s.run.includes("docker save") &&
        s.run.includes("querymodule:ci"),
    );
    expect(save, "no docker save step in the image job").toBeDefined();
    expect(save?.if).toBe(pushGate);
    const upload = steps.find((s) => s.uses?.startsWith("actions/upload-artifact"));
    expect(upload, "no actions/upload-artifact step in the image job").toBeDefined();
    expect(upload?.if).toBe(pushGate);
    expect(upload?.with?.name).toBe("querymodule-image");
  });
});
