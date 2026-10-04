import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { derivePassword } from "../../packages/api/src/seed/password";

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

  it("the oasdiff step diffs the merge base against the rename-mapped head, fail closed (#171)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed workflow steps
    const steps: any[] = jobs.test.steps;
    const step = steps.find((s) => s.name === "oasdiff breaking");
    expect(step).toBeDefined();
    const run: string = step.run;
    expect(run).toContain("set -euo pipefail");
    // On pull_request the checkout is refs/pull/N/merge, so HEAD is the merge commit and its
    // merge base with the base tip is the tip itself: the PR head sha must be passed (#171).
    expect(step.env.HEAD_SHA).toBe(["$", "{{ github.event.pull_request.head.sha }}"].join(""));
    expect(run).toContain(
      'openapi-base.ts "origin/$BASE_REF" base-openapi.json "$HEAD_SHA" head-openapi.json',
    );
    expect(run).not.toMatch(/git (show|ls-tree)/);
    // Skip is an explicit exit code 3; exit 0 must leave the file, anything else fails.
    expect(run).toContain("rc=$?");
    expect(run).toMatch(/3\)\s+exit 0/);
    expect(run).toMatch(
      /0\)\s+\[ -f base-openapi.json \] && \[ -f head-openapi.json \] \|\| exit 1/,
    );
    expect(run).toMatch(/\*\)\s+exit "\$rc"/);
    expect(run).not.toMatch(/if \[ ! -f base-openapi.json \]/);
    const rename = run.indexOf(
      "openapi-rename-map.ts base-openapi.json head-openapi.json head-openapi.renamed.json",
    );
    const diff = run.indexOf(
      "breaking /work/base-openapi.json /work/head-openapi.renamed.json --fail-on ERR",
    );
    expect(rename).toBeGreaterThan(run.indexOf("openapi-base.ts"));
    expect(diff).toBeGreaterThan(rename);
    expect(step.if).toContain("api-breaking");
    const checkout = steps.find(
      (s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout"),
    );
    expect(checkout.with["fetch-depth"]).toBe(0);
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

// progress-r1-guard-1/2 (round 2): a named type instead of an `any[]` local,
// so these task-29 tests never need a new noExplicitAny suppression.
type WorkflowStep = {
  name?: string;
  run?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

describe("ci.yml image build, boot smoke, publish (task 29, BR-006 SEC-006 NFR-003)", () => {
  it("`image` job is gated on docs-only like the other gated jobs and waits for `checks` (#231 G-M1)", () => {
    expect(jobs.image).toBeDefined();
    // checks holds the pre-install lockfile guard; image installs, so it runs only after it.
    expect(jobNeeds(jobs.image)).toEqual(["changes", "checks"]);
    expect(jobs.image.if).toBe("needs.changes.outputs.docs_only != 'true'");
  });

  it("`image` job's boot-smoke down step always runs, even if an earlier step failed", () => {
    const steps = jobs.image.steps as WorkflowStep[];
    const down = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("boot-smoke.sh down"),
    );
    expect(down, "no boot-smoke.sh down step in the image job").toBeDefined();
    expect(down?.if).toBe("always()");
  });

  it("`image` job builds and boots the same tag it smoke-tests (querymodule:ci)", () => {
    const steps = jobs.image.steps as WorkflowStep[];
    const build = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("docker buildx build"),
    );
    expect(build?.run).toContain("--tag querymodule:ci");
    const up = steps.find((s) => typeof s.run === "string" && s.run.includes("boot-smoke.sh up"));
    expect(up?.run).toContain("querymodule:ci");
  });

  it("the image carries its commit as org.opencontainers.image.revision, from the runner env, not an expression (M1 exit)", () => {
    const steps = jobs.image.steps as WorkflowStep[];
    const build = steps.find(
      (s) => typeof s.run === "string" && s.run.includes("docker buildx build"),
    );
    expect(build?.run).toContain('--label "org.opencontainers.image.revision=$GITHUB_SHA"');
    expect(build?.run).not.toContain("${{");
  });

  it("main runs never cancel each other; PR branches still do (developer 09-28-26, #231)", () => {
    // Deviation from spec 9.3: every main sha must finish ci (and build its image) so it can be
    // promoted; a newer push to main queues behind the running one instead of cancelling it.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal GitHub Actions expression
    expect(workflow.concurrency.group).toBe("ci-${{ github.ref }}");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal GitHub Actions expression
      "${{ github.ref != 'refs/heads/main' }}",
    );
  });

  it("a push to main always builds the image, so every main sha gets a sha- image (#230)", async () => {
    // image skips only on docs_only, and changed-paths fails closed to docs_only=false on any
    // push (a docs-only merge to main still builds, smoke-tests and publishes its image).
    expect(jobs.image.if).toBe("needs.changes.outputs.docs_only != 'true'");
    expect(jobs.checks.if).toBe("needs.changes.outputs.docs_only != 'true'");
    const { main } = await import("./changed-paths.mjs");
    const lines: string[] = [];
    main({
      env: { BASE_SHA: "abc", EVENT_NAME: "push" },
      runGit: () => "",
      write: (l: string) => lines.push(l),
    });
    expect(lines).toContain("docs_only=false");
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
    const steps = publish.steps as WorkflowStep[];
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
    expect(push?.run?.includes("${{")).toBe(false);
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
      const steps = jobs[id].steps as WorkflowStep[];
      const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
      expect(checkout?.with?.["persist-credentials"], `${id} checkout`).toBe(false);
    }
  });

  it("`image` job exposes real GHA cache credentials to the buildx `run:` step (fixes C1)", () => {
    const steps = jobs.image.steps as WorkflowStep[];
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
    const steps = jobs.image.steps as WorkflowStep[];
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

/**
 * Step 12 no-echo guard (G-m2, #315): no xtrace in any spelling, the derived password `$pw` appears
 * only on the mask line and the export line, and nothing names `$E2E_USER_PASSWORD` or dumps the
 * environment (env, printenv, export, declare, set with no arguments). Returns the offending lines.
 */
function step12Violations(run: string): string[] {
  const bad: string[] = [];
  for (const raw of run.split("\n")) {
    const l = raw.trim();
    if (/^set\s+(-[a-zA-Z]*x[a-zA-Z]*|.*-o\s+xtrace)/.test(l) || /xtrace/.test(l)) bad.push(l);
    else if (/\$\{?pw(?![A-Za-z_])/.test(l)) {
      const isMask = l === 'echo "::add-mask::$pw"';
      const isExport = /^export E2E_USER_EMAIL=smoke@example\.test E2E_USER_PASSWORD="\$pw"$/.test(
        l,
      );
      if (!isMask && !isExport) bad.push(l);
    } else if (
      // Any mention of the password variable except the export line, and every spelling that
      // dumps the environment, as a command word after a separator, keyword or wrapper (#315).
      /E2E_USER_PASSWORD/.test(l) ||
      /(^|[;|&({]\s*|\b(then|do|else|sudo|command|exec)\s+)(\S*\/)?(env|printenv|export(\s+-\S+)?|declare(\s+-\S+)?|typeset(\s+-\S+)?|set)\s*($|[|;&>)}])/.test(
        l,
      ) ||
      /\bprintenv\b/.test(l)
    )
      bad.push(l);
  }
  return bad;
}

describe("ci.yml step 12: the M0 Playwright suite against the boot-smoke container (#167)", () => {
  const step = () =>
    (jobs.image.steps as WorkflowStep[]).find(
      (s) => typeof s.name === "string" && s.name.startsWith("12:"),
    );

  it("runs the whole e2e suite, not one spec, at the container's PUBLIC_ORIGIN via QM_BASE_URL", () => {
    const run = String(step()?.run ?? "");
    expect(run).toMatch(/playwright test\s*$/m);
    const smoke = readFileSync(resolve(root, "scripts/ci/boot-smoke.sh"), "utf8");
    const origin = smoke.match(/-e PUBLIC_ORIGIN=(\S+)/)?.[1];
    expect(origin).toBe("http://localhost:3000");
    // boot-smoke.sh hands step 12 the same origin the container was started with.
    expect(smoke).toContain(`QM_BASE_URL=${origin}`);
    expect(run).toContain("E2E_BASE_URL=$QM_BASE_URL ");
  });

  it("masks the derived smoke password before exporting it and never echoes it otherwise", () => {
    const run = String(step()?.run ?? "");
    expect(step12Violations(run)).toEqual([]);
    const lines = run
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const mask = lines.indexOf('echo "::add-mask::$pw"');
    const exported = lines.findIndex((l) => l.includes('E2E_USER_PASSWORD="$pw"'));
    expect(mask).toBeGreaterThan(-1);
    expect(exported).toBeGreaterThan(mask);
    expect(lines[0]).toMatch(/"\$SEED_PASSWORD_SECRET_FILE" smoke@example\.test\)$/);
  });

  it.each([
    ["set -x", "set -x"],
    ["set -o xtrace", "set -o xtrace"],
    ["set -ex", "set -ex"],
    ["printf of the password", 'printf "$pw"'],
    ["printf into GITHUB_ENV", 'printf "PW=$pw" >> "$GITHUB_ENV"'],
    ["braced reference", `cat <<< "$` + `{pw}"`],
    ["the exported variable by name", 'echo "$E2E_USER_PASSWORD"'],
    ["the exported variable, braced", `echo "$` + `{E2E_USER_PASSWORD}"`],
    ["env", "env"],
    ["env piped", "env | sort"],
    ["printenv", "printenv"],
    ["printenv of the variable", "printenv E2E_USER_PASSWORD"],
    ["export -p", "export -p"],
    ["bare export", "export"],
    ["declare -x", "declare -x"],
    ["set with no arguments", "set"],
    ["declare -p of the variable", "declare -p E2E_USER_PASSWORD"],
    ["typeset -p of the variable", "typeset -p E2E_USER_PASSWORD"],
    ["export -p of the variable", "export -p E2E_USER_PASSWORD"],
    ["the variable bare, unquoted", "echo E2E_USER_PASSWORD"],
    ["env inside if/then", "if true; then env; fi"],
    ["env inside braces", "{ env; }"],
    ["sudo env", "sudo env"],
    ["env by absolute path", "/usr/bin/env"],
    ["env after exec", "exec env"],
    ["env after command", "command env"],
    [
      "an export that smuggles $pw into the email",
      'export E2E_USER_EMAIL=$pw E2E_USER_PASSWORD="$pw"',
    ],
  ])("the no-echo guard rejects %s", (_name, line) => {
    const run = String(step()?.run ?? "");
    expect(
      step12Violations(`${line}
${run}`),
    ).not.toEqual([]);
  });

  it("derives derivePassword's value (spec 8.5) from the secret file", () => {
    const derive = String(step()?.run ?? "")
      .split("\n")
      .find((l) => l.trim().startsWith("pw=$("))
      ?.trim();
    expect(derive).toBeDefined();
    const secret = "ci-step-12-test-secret-not-real";
    const dir = mkdtempSync(join(tmpdir(), "qm-ci-step12-"));
    try {
      const file = join(dir, "SEED_PASSWORD_SECRET");
      writeFileSync(file, `${secret}\n`);
      const r = spawnSync("bash", ["-c", `${derive}\nprintf %s "$pw"`], {
        encoding: "utf8",
        env: { ...process.env, SEED_PASSWORD_SECRET_FILE: file },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(derivePassword(secret, "smoke@example.test"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
