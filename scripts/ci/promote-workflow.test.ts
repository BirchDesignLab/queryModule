import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Task 30 (BR-004, SEC-020, NFR-003): parses the real promote.yml so a
// structural regression fails here instead of only in CI.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = resolve(root, ".github", "workflows", "promote.yml");
const raw = readFileSync(workflowPath, "utf8");
// biome-ignore lint/suspicious/noExplicitAny: the parsed workflow has no local type
const workflow: any = parse(raw);

type WorkflowStep = {
  name?: string;
  run?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

const job = workflow.jobs.promote;
const steps: WorkflowStep[] = job.steps;

function allRunBodies(): string[] {
  return steps.filter((s) => typeof s.run === "string").map((s) => s.run as string);
}

describe("promote.yml structure (task 30, BR-004 SEC-020 NFR-003)", () => {
  it("is workflow_dispatch only, with a required sha input and an optional milestone choice", () => {
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.pull_request).toBeUndefined();
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.sha.required).toBe(true);
    expect(inputs.milestone.required).toBe(false);
  });

  it("checks out with fetch-depth: 0 and persist-credentials: false (closes #67)", () => {
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout, "no checkout step").toBeDefined();
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("uses actions/checkout@v7 to match the repo's action style", () => {
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.uses).toBe("actions/checkout@v7");
  });

  it("validates sha as 40 lowercase hex before any other step uses it", () => {
    const shaCheckIndex = steps.findIndex(
      (s) => typeof s.run === "string" && /\^\[0-9a-f\]\{40\}\$/.test(s.run),
    );
    expect(shaCheckIndex, "no sha-format validation step").toBeGreaterThanOrEqual(0);
    const ciCheckIndex = steps.findIndex(
      (s) => typeof s.run === "string" && s.run.includes("gh run list"),
    );
    expect(ciCheckIndex).toBeGreaterThanOrEqual(0);
    // The format check and the ci-success check happen in the same guard step
    // (or the format check precedes any later use); either way it must not be after.
    expect(shaCheckIndex).toBeLessThanOrEqual(ciCheckIndex);
  });

  it("runs the milestone gate with pnpm (pnpm/action-setup) and node from .nvmrc", () => {
    const pnpmSetup = steps.find((s) => s.uses?.startsWith("pnpm/action-setup"));
    const nodeSetup = steps.find((s) => s.uses?.startsWith("actions/setup-node"));
    expect(pnpmSetup, "no pnpm/action-setup step").toBeDefined();
    expect(nodeSetup, "no actions/setup-node step").toBeDefined();
    expect(nodeSetup?.with?.["node-version-file"]).toBe(".nvmrc");
    const pnpmIndex = steps.indexOf(pnpmSetup as WorkflowStep);
    const nodeIndex = steps.indexOf(nodeSetup as WorkflowStep);
    expect(pnpmIndex).toBeLessThan(nodeIndex);
  });

  it("gates the milestone-only steps on inputs.milestone != ''", () => {
    const notesCheck = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("docs/releases/"),
    );
    const storyTagStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("check-story-tags.ts"),
    );
    expect(notesCheck?.if).toBe("inputs.milestone != ''");
    expect(storyTagStep?.if).toBe("inputs.milestone != ''");
  });

  it("passes --milestone and $MILESTONE as separate argv entries to the story-tag gate", () => {
    const storyTagStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("check-story-tags.ts"),
    );
    expect(storyTagStep?.run).toMatch(
      /node scripts\/ci\/check-story-tags\.ts --milestone "\$MILESTONE"/,
    );
    // Not concatenated into one argv entry like --milestone=$MILESTONE or --milestone="m0-$MILESTONE".
    expect(storyTagStep?.run).not.toMatch(/--milestone=/);
  });

  it("checks the release notes file exists at the promoted sha", () => {
    const notesCheck = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("docs/releases/"),
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal shell placeholder text, not a JS template
    expect(notesCheck?.run).toContain("docs/releases/${MILESTONE}.md");
  });

  it("retags by imagetools create from the sha-<sha> tag, never a rebuild", () => {
    const retag = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("imagetools create"),
    );
    expect(retag, "no imagetools create step").toBeDefined();
    expect(retag?.run).toContain("sha-$SHA");
    const build = steps.find((s) => s.uses?.startsWith("docker/build-push-action"));
    expect(build, "promote must not rebuild the image").toBeUndefined();
    const buildxBuild = allRunBodies().find((r) => r.includes("docker buildx build"));
    expect(buildxBuild, "promote must not run docker buildx build").toBeUndefined();
  });

  it("creates the local milestone tag before the retag step, so an existing tag fails the job before :release moves (C2)", () => {
    const createTagStep = steps.find(
      (s) => typeof s.run === "string" && /\bgit tag\b/.test(s.run) && !s.run.includes("git push"),
    );
    const retagStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("imagetools create"),
    );
    const pushStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("git push") && !/\bgit tag\b/.test(s.run),
    );
    expect(createTagStep, "no tag-create step (must not also push)").toBeDefined();
    expect(retagStep, "no imagetools create (retag) step").toBeDefined();
    expect(pushStep, "no tag-push step (must not also create the tag)").toBeDefined();
    expect(createTagStep?.if).toBe("inputs.milestone != ''");
    expect(pushStep?.if).toBe("inputs.milestone != ''");
    const createIndex = steps.indexOf(createTagStep as WorkflowStep);
    const retagIndex = steps.indexOf(retagStep as WorkflowStep);
    const pushIndex = steps.indexOf(pushStep as WorkflowStep);
    // git tag (no -f) fails if $MILESTONE already exists, and it must run
    // before imagetools create moves :release, so a re-cut tag fails the
    // job before :release is touched. The push happens only after both.
    expect(createIndex).toBeLessThan(retagIndex);
    expect(retagIndex).toBeLessThan(pushIndex);
  });

  it("pushes the milestone git tag only when milestone is set, with the push credential scoped to that one step", () => {
    const pushStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("git push") && !/\bgit tag\b/.test(s.run),
    );
    expect(pushStep, "no tag-push step").toBeDefined();
    expect(pushStep?.if).toBe("inputs.milestone != ''");
    // The checkout step must not itself carry a push-capable credential.
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    // The push step supplies its own credential via env, not via the persisted checkout credential.
    expect(pushStep?.env, "tag push step must scope its own credential via env").toBeDefined();
    expect(pushStep?.env?.GH_TOKEN, "tag push step must set GH_TOKEN itself").toBeDefined();
  });

  it("never sets GH_TOKEN in job-wide env, and no pnpm install step carries it (C1)", () => {
    expect(job.env?.GH_TOKEN, "GH_TOKEN must not be job-wide").toBeUndefined();
    const installStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("pnpm install"),
    );
    expect(installStep, "no pnpm install step").toBeDefined();
    expect(installStep?.env?.GH_TOKEN, "pnpm install step must not carry GH_TOKEN").toBeUndefined();
  });

  it("scopes GH_TOKEN only to the steps that need it (gh run list, git push)", () => {
    const ghRunListStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("gh run list"),
    );
    const pushStep = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("git push") && !/\bgit tag\b/.test(s.run),
    );
    expect(ghRunListStep?.env?.GH_TOKEN, "guard step must set its own GH_TOKEN").toBeDefined();
    expect(pushStep?.env?.GH_TOKEN, "push step must set its own GH_TOKEN").toBeDefined();
    for (const s of steps) {
      if (s === ghRunListStep || s === pushStep) continue;
      expect(s.env?.GH_TOKEN, `step "${s.name}" must not carry GH_TOKEN`).toBeUndefined();
    }
  });

  it("never interpolates the GitHub expression syntax inside a run: body", () => {
    for (const run of allRunBodies()) {
      expect(run.includes("${{")).toBe(false);
    }
  });

  it("has a promote concurrency group that never cancels in progress", () => {
    expect(workflow.concurrency.group).toBe("promote");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("grants only the permissions the job needs", () => {
    const perms = workflow.permissions ?? job.permissions;
    expect(perms.contents).toBe("write");
    expect(perms.packages).toBe("write");
    expect(perms.actions).toBe("read");
    // No broader scopes such as id-token, issues, or pull-requests.
    expect(Object.keys(perms).sort()).toEqual(["actions", "contents", "packages"]);
  });
});

describe("promote.yml restores no dependency cache (#231 G-M2)", () => {
  it("no step restores a cache in a workflow that holds contents and packages write", () => {
    // A poisoned main-scope pnpm store cache would feed the milestone-gate install.
    for (const s of steps) {
      expect(s.with?.cache, `${s.name ?? s.uses} restores a cache`).toBeUndefined();
      expect(s.uses ?? "", `${s.name ?? s.uses} uses actions/cache`).not.toMatch(/^actions\/cache/);
    }
  });
});
