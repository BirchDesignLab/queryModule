// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the deps-demotion cases are literal ${...} injection payloads.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateSensitiveReview,
  listSensitiveChanges,
  packageJsonDepsOnly,
  parseReviewFrontMatter,
  parseSensitiveTiers,
  runSensitiveReview,
  tierOf,
  workflowDiffUsesOnly,
} from "./sensitive-review";

const legacy = parseSensitiveTiers(
  "# comment\npackages/api/src/audit/**\n\n.github/**\nscripts/ci/**\n",
);
const sha = "0123456789abcdef0123456789abcdef01234567";
const BASE = "abc1234000000000000000000000000000000000";
const HEAD = "def5678000000000000000000000000000000000";
const artifact = `---\nreviewer: "opus-5.5"\neffort: "xhigh"\nreviewedSha: "${sha}"\nverdict: "approve"\n---\n\nFindings: none.\n`;

describe("sensitive-review (spec 9.1)", () => {
  it("parses globs, skipping comments and blanks", () => {
    expect(legacy.critical).toEqual(["packages/api/src/audit/**", ".github/**", "scripts/ci/**"]);
  });

  it("matches dotfiles and nested paths", () => {
    expect(
      [".github/workflows/ci.yml", "docs/a.md", "packages/api/src/audit/service.ts"].filter(
        (f) => tierOf(f, [legacy]) !== null,
      ),
    ).toEqual([".github/workflows/ci.yml", "packages/api/src/audit/service.ts"]);
  });

  it("the shipped tier file classifies the gate, deps and exempt paths (spec 9.1, ADR-0007)", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const shipped = parseSensitiveTiers(
      readFileSync(join(repoRoot, ".github/sensitive-paths"), "utf8"),
    );
    const c = (f: string) => tierOf(f, [shipped]);
    for (const f of [
      "packages/core/src/contracts/audit.ts",
      "packages/core/src/contracts/identity.ts",
      ".github/sensitive-paths",
      "scripts/ci/sensitive-review.ts",
      "scripts/ci/check-sensitive-review.ts",
      "scripts/ci/check-audit-migrations.ts",
    ])
      expect(c(f), f).toBe("critical");
    for (const f of [
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "tsconfig.base.json",
      "scripts/tsconfig.json",
      "vitest.config.ts",
      "scripts/vitest.config.ts",
      "packages/api/vitest.config.ts",
      "biome.json",
      "packages/core/biome.json",
      ".gitignore",
      ".github/workflows/ci.yml",
      ".github/licence-exceptions.json",
      ".github/dependabot.yml",
      "scripts/ci/openapi.ts",
      "scripts/ops/gh-setup-project.mjs",
    ])
      expect(c(f), f).toBe("gate");
    for (const f of ["pnpm-lock.yaml"]) expect(c(f), f).toBe("deps");
    for (const f of [
      ".github/ISSUE_TEMPLATE/bug.yml",
      ".github/pull_request_template.md",
      "packages/api/package.json",
      "docs/a.md",
    ])
      expect(c(f), f).toBeNull();
  });

  it("parses front matter and rejects missing fields", () => {
    expect(parseReviewFrontMatter(artifact)).toEqual({
      reviewer: "opus-5.5",
      effort: "xhigh",
      reviewedSha: sha,
      verdict: "approve",
    });
    expect(parseReviewFrontMatter("---\nreviewer: opus-5.5\n---\n")).toBeNull();
    expect(parseReviewFrontMatter("no front matter")).toBeNull();
  });

  const base = {
    classify: (f: string) => tierOf(f, [legacy]),
    prNumber: 7,
    filesChangedAfterReviewedSha: [] as string[] | undefined,
  };

  it("passes when no sensitive path is touched", () => {
    expect(
      evaluateSensitiveReview({ ...base, changedFiles: ["docs/x.md"], artifactText: undefined }).ok,
    ).toBe(true);
  });

  it("fails without the artifact", () => {
    const r = evaluateSensitiveReview({
      ...base,
      changedFiles: ["scripts/ci/x.ts"],
      artifactText: undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toContain("docs/reviews/pr-7.md is missing");
  });

  it("fails on a wrong reviewer, a low effort, a non-approve verdict or a bad sha", () => {
    for (const text of [
      artifact.replace("opus-5.5", "sonnet-5"),
      artifact.replace('"xhigh"', '"low"'),
      artifact.replace('"approve"', '"changes"'),
      artifact.replace(sha, "not-a-sha"),
    ]) {
      expect(
        evaluateSensitiveReview({ ...base, changedFiles: ["scripts/ci/x.ts"], artifactText: text })
          .ok,
      ).toBe(false);
    }
  });

  it("accepts effort xhigh or max and names a bad effort", () => {
    const run = (text: string) =>
      evaluateSensitiveReview({ ...base, changedFiles: ["scripts/ci/x.ts"], artifactText: text });
    expect(run(artifact.replace('"xhigh"', '"max"')).ok).toBe(true);
    expect(run(artifact.replace('"xhigh"', '"low"')).messages[0]).toContain(
      "critical paths need effort xhigh or max, got low",
    );
  });

  it("fails when reviewedSha is not an ancestor or sensitive files changed after it", () => {
    expect(
      evaluateSensitiveReview({
        ...base,
        changedFiles: ["scripts/ci/x.ts"],
        artifactText: artifact,
        filesChangedAfterReviewedSha: undefined,
      }).ok,
    ).toBe(false);
    const late = evaluateSensitiveReview({
      ...base,
      changedFiles: ["scripts/ci/x.ts"],
      artifactText: artifact,
      filesChangedAfterReviewedSha: ["docs/reviews/pr-7.md", "scripts/ci/x.ts"],
    });
    expect(late.ok).toBe(false);
    expect(late.messages[0]).toContain("scripts/ci/x.ts");
  });

  it("passes with a valid artifact and only non-sensitive changes after reviewedSha", () => {
    const r = evaluateSensitiveReview({
      ...base,
      changedFiles: ["scripts/ci/x.ts"],
      artifactText: artifact,
      filesChangedAfterReviewedSha: ["docs/reviews/pr-7.md"],
    });
    expect(r).toEqual({ ok: true, messages: ["sensitive review recorded for scripts/ci/x.ts"] });
  });
});

describe("runSensitiveReview (spec 9.1, fails closed)", () => {
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const env = {
    EVENT_NAME: "pull_request",
    BASE_SHA: BASE,
    HEAD_SHA: HEAD,
    PR_NUMBER: "7",
  };
  const files: Record<string, string> = { ".github/sensitive-paths": "scripts/ci/**\n" };
  const readFile = (p: string) => files[p];
  const calls: string[][] = [];
  const gitWith =
    (answers: Record<string, { status: number | null; stdout: string | null; stderr: string }>) =>
    (args: string[]) => {
      calls.push(args);
      return answers[args.slice(0, 2).join(" ")] ?? ok();
    };

  it("skips non pull_request events with exit 0", () => {
    const r = runSensitiveReview({ EVENT_NAME: "push" }, { runGit: gitWith({}), readFile });
    expect(r.code).toBe(0);
    expect(runSensitiveReview({}, { runGit: gitWith({}), readFile }).messages[0]).toContain(
      "local",
    );
  });

  it("exits 2 when BASE_SHA is empty or unset", () => {
    for (const BASE_SHA of ["", undefined]) {
      const r = runSensitiveReview({ ...env, BASE_SHA }, { runGit: gitWith({}), readFile });
      expect(r.code).toBe(2);
    }
  });

  it("exits 2 when HEAD_SHA is empty or unset", () => {
    for (const HEAD_SHA of ["", undefined]) {
      const r = runSensitiveReview({ ...env, HEAD_SHA }, { runGit: gitWith({}), readFile });
      expect(r.code, String(HEAD_SHA)).toBe(2);
    }
  });

  it("exits 2 without calling git when BASE_SHA or HEAD_SHA is not a hex sha", () => {
    for (const bad of [
      "--output=f",
      "HEAD",
      "main",
      "abc123",
      "ABC1234",
      "abc1234",
      BASE.slice(0, 39),
      `${BASE}0`,
    ]) {
      for (const key of ["BASE_SHA", "HEAD_SHA"]) {
        const calls: string[][] = [];
        const runGit = (args: string[]) => {
          calls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        };
        const r = runSensitiveReview({ ...env, [key]: bad }, { runGit, readFile });
        expect(r.code, `${key}=${bad}`).toBe(2);
        expect(calls, `${key}=${bad}`).toEqual([]);
      }
    }
  });

  it("exits 2 when PR_NUMBER is unset, NaN, zero or fractional", () => {
    for (const PR_NUMBER of [undefined, "", "abc", "0", "-3", "1.5"]) {
      const r = runSensitiveReview({ ...env, PR_NUMBER }, { runGit: gitWith({}), readFile });
      expect(r.code, String(PR_NUMBER)).toBe(2);
    }
  });

  it("exits 2 when git diff base...head fails (bad BASE_SHA)", () => {
    const runGit = gitWith({
      "diff --name-only": { status: 128, stdout: "", stderr: "fatal: bad revision" },
    });
    const r = runSensitiveReview(env, { runGit, readFile });
    expect(r.code).toBe(2);
    expect(r.messages.join("\n")).toContain("fatal: bad revision");
  });

  it("exits 2 when git cannot be spawned", () => {
    const runGit = gitWith({ "diff --name-only": { status: null, stdout: null, stderr: "" } });
    expect(runSensitiveReview(env, { runGit, readFile }).code).toBe(2);
  });

  it("passes with exit 0 when no sensitive path is touched", () => {
    const runGit = gitWith({ "diff --name-only": ok("docs/a.md\0") });
    expect(runSensitiveReview(env, { runGit, readFile })).toEqual({
      code: 0,
      messages: ["no sensitive paths touched"],
    });
  });

  it("exits 1 when a sensitive path is touched and the artifact is missing", () => {
    const runGit = gitWith({ "diff --name-only": ok("scripts/ci/x.ts\0") });
    const r = runSensitiveReview(env, { runGit, readFile });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("docs/reviews/pr-7.md is missing");
  });

  const withArtifact = (p: string) => (p === "docs/reviews/pr-7.md" ? artifact : readFile(p));

  it("exits 0 with a valid artifact whose reviewedSha is an ancestor", () => {
    calls.length = 0;
    const runGit = (args: string[]) => {
      calls.push(args);
      if (args[0] === "diff" && args.at(-1) === `${BASE}...${HEAD}`) return ok("scripts/ci/x.ts\0");
      return ok();
    };
    const r = runSensitiveReview(env, { runGit, readFile: withArtifact });
    expect(r.code).toBe(0);
    expect(calls).toContainEqual(["merge-base", "--is-ancestor", sha, HEAD]);
    expect(calls).toContainEqual([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      `${BASE}...${HEAD}`,
    ]);
    expect(calls).toContainEqual(["diff", "--name-only", "-z", "--no-renames", sha, HEAD]);
  });

  it("exits 1 when reviewedSha is not an ancestor (merge-base status 1)", () => {
    const runGit = gitWith({
      "diff --name-only": ok("scripts/ci/x.ts\0"),
      "merge-base --is-ancestor": { status: 1, stdout: "", stderr: "" },
    });
    const r = runSensitiveReview(env, { runGit, readFile: withArtifact });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("not an ancestor");
  });

  it("exits 2 when merge-base fails (status other than 0 or 1)", () => {
    const runGit = gitWith({
      "diff --name-only": ok("scripts/ci/x.ts\0"),
      "merge-base --is-ancestor": { status: 128, stdout: "", stderr: "fatal: not a valid commit" },
    });
    expect(runSensitiveReview(env, { runGit, readFile: withArtifact }).code).toBe(2);
  });

  it("exits 2 when git diff reviewedSha head fails", () => {
    const runGit = (args: string[]) =>
      args[0] === "diff" && args.includes(sha)
        ? { status: 128, stdout: "", stderr: "fatal: bad object" }
        : args[0] === "diff"
          ? ok("scripts/ci/x.ts\0")
          : ok();
    expect(runSensitiveReview(env, { runGit, readFile: withArtifact }).code).toBe(2);
  });

  it("exits 1 on a malformed reviewedSha without calling merge-base", () => {
    calls.length = 0;
    const badSha = artifact.replace(sha, "not-a-sha");
    const r = runSensitiveReview(env, {
      runGit: gitWith({ "diff --name-only": ok("scripts/ci/x.ts\0") }),
      readFile: (p) => (p === "docs/reviews/pr-7.md" ? badSha : readFile(p)),
    });
    expect(r).toEqual({
      code: 1,
      messages: ["docs/reviews/pr-7.md: reviewedSha is not a commit sha"],
    });
    expect(calls.some((c) => c[0] === "merge-base")).toBe(false);
  });

  it("exits 1 on an abbreviated reviewedSha, which git could resolve as a ref", () => {
    calls.length = 0;
    const shortSha = artifact.replace(sha, sha.slice(0, 12));
    const r = runSensitiveReview(env, {
      runGit: gitWith({ "diff --name-only": ok("scripts/ci/x.ts\0") }),
      readFile: (p) => (p === "docs/reviews/pr-7.md" ? shortSha : readFile(p)),
    });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("reviewedSha is not a commit sha");
    expect(calls.some((c) => c[0] === "merge-base")).toBe(false);
  });

  it("exits 2 when .github/sensitive-paths is missing", () => {
    const runGit = gitWith({ "diff --name-only": ok("scripts/ci/x.ts\0") });
    const r = runSensitiveReview(env, { runGit, readFile: () => undefined });
    expect(r.code).toBe(2);
    expect(r.messages[0]).toContain(".github/sensitive-paths is missing");
  });

  it("exits 2 when .github/sensitive-paths lists no globs", () => {
    const runGit = gitWith({ "diff --name-only": ok("docs/a.md\0") });
    const r = runSensitiveReview(env, { runGit, readFile: () => "# only a comment\n\n" });
    expect(r.code).toBe(2);
    expect(r.messages[0]).toContain(".github/sensitive-paths lists no globs");
  });

  it("matches the base globs too, so a PR cannot drop the glob that judges it", () => {
    calls.length = 0;
    const runGit = gitWith({
      "diff --name-only": ok(".github/sensitive-paths\0packages/api/src/audit/a.ts\0"),
      "ls-tree --name-only": ok(".github/sensitive-paths\0"),
      [`show ${BASE}:.github/sensitive-paths`]: ok(".github/**\npackages/api/src/audit/**\n"),
    });
    const readHead = (p: string) => (p === ".github/sensitive-paths" ? "docs/**\n" : undefined);
    const r = runSensitiveReview(env, { runGit, readFile: readHead });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("packages/api/src/audit/a.ts");
    expect(calls).toContainEqual([
      "ls-tree",
      "--name-only",
      "-z",
      BASE,
      "--",
      ".github/sensitive-paths",
    ]);
  });

  it("exits 2 when the base glob file cannot be read", () => {
    for (const failing of ["ls-tree --name-only", `show ${BASE}:.github/sensitive-paths`]) {
      const runGit = gitWith({
        "diff --name-only": ok("docs/a.md\0"),
        "ls-tree --name-only": ok(".github/sensitive-paths\0"),
        [failing]: { status: 128, stdout: "", stderr: "fatal: bad object" },
      });
      expect(runSensitiveReview(env, { runGit, readFile }).code, failing).toBe(2);
    }
  });
});

describe("runSensitiveReview against a real git repo", () => {
  const git = (cwd: string, args: string[]) => {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(cwd, ".gitcfg") },
    });
    return { status: r.status, stdout: r.stdout ?? null, stderr: r.stderr ?? null };
  };
  const inRepo = (change: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "sensitive-review-"));
    try {
      const write = (p: string, t: string) => {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), t);
      };
      const commit = () => {
        git(dir, ["add", "-A"]);
        git(dir, [
          "-c",
          "user.name=Testerson",
          "-c",
          "user.email=t@example.test",
          "commit",
          "-qm",
          "c",
        ]);
        return (git(dir, ["rev-parse", "HEAD"]).stdout ?? "").trim();
      };
      writeFileSync(join(dir, ".gitcfg"), "");
      git(dir, ["init", "-q"]);
      write(".gitignore", ".gitcfg\n");
      write(".github/sensitive-paths", "scripts/ci/**\n");
      write("scripts/ci/x.ts", "export const x = 1;\n".repeat(20));
      const base = commit();
      change(dir);
      const head = commit();
      return runSensitiveReview(
        { EVENT_NAME: "pull_request", BASE_SHA: base, HEAD_SHA: head, PR_NUMBER: "7" },
        {
          runGit: (args) => git(dir, args),
          readFile: (p) => (p === ".github/sensitive-paths" ? "scripts/ci/**\n" : undefined),
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("catches a file renamed out of a sensitive path", () => {
    const r = inRepo((dir) => git(dir, ["mv", "scripts/ci/x.ts", "moved-x.ts"]));
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("scripts/ci/x.ts");
  });

  it("catches a sensitive path with non-ASCII characters", () => {
    const r = inRepo((dir) => writeFileSync(join(dir, "scripts/ci/é.ts"), "export {};\n"));
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("scripts/ci/é.ts");
  });
});

describe("listSensitiveChanges (sensitive label, project-sync)", () => {
  const git =
    (answers: Record<string, { status: number | null; stdout: string | null; stderr: string }>) =>
    (args: string[]) =>
      answers[args.slice(0, 2).join(" ")] ?? { status: 0, stdout: "", stderr: "" };
  const env = { BASE_SHA: BASE, HEAD_SHA: HEAD };
  const readFile = (p: string) => (p === ".github/sensitive-paths" ? "scripts/ci/**\n" : undefined);

  it("lists changed files the head or base globs match", () => {
    const runGit = git({
      "diff --name-only": {
        status: 0,
        stdout: "scripts/ci/x.ts\0docs/a.md\0README.md\0",
        stderr: "",
      },
      "ls-tree --name-only": { status: 0, stdout: ".github/sensitive-paths\0", stderr: "" },
      [`show ${BASE}:.github/sensitive-paths`]: { status: 0, stdout: "docs/**\n", stderr: "" },
    });
    expect(listSensitiveChanges(env, { runGit, readFile })).toEqual({
      code: 0,
      files: ["scripts/ci/x.ts", "docs/a.md"],
      messages: [],
    });
  });

  it("returns no files when nothing sensitive changed", () => {
    const runGit = git({ "diff --name-only": { status: 0, stdout: "README.md\0", stderr: "" } });
    expect(listSensitiveChanges(env, { runGit, readFile }).files).toEqual([]);
  });

  it("exits 2 on a bad or missing sha before git runs, and on a git failure", () => {
    const calls: string[][] = [];
    const spy = (args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(listSensitiveChanges({ ...env, BASE_SHA: "--x" }, { runGit: spy, readFile }).code).toBe(
      2,
    );
    expect(
      listSensitiveChanges({ ...env, HEAD_SHA: undefined }, { runGit: spy, readFile }).code,
    ).toBe(2);
    expect(calls).toEqual([]);
    const failing = git({ "diff --name-only": { status: 128, stdout: "", stderr: "fatal" } });
    expect(listSensitiveChanges(env, { runGit: failing, readFile }).code).toBe(2);
  });
});

describe("sensitive tiers (ADR-0007)", () => {
  const text = [
    "# comment",
    "[critical]",
    "packages/api/src/audit/**",
    ".github/sensitive-paths",
    "[gate]",
    ".github/**",
    "scripts/ci/**",
    "package.json",
    "[deps]",
    "pnpm-lock.yaml",
    ".github/dependabot.yml",
    "[exempt]",
    ".github/ISSUE_TEMPLATE/**",
    "packages/api/src/audit/readme.md",
  ].join("\n");
  const t = parseSensitiveTiers(text);

  it("parses sections; lines before any section are critical (legacy file)", () => {
    expect(t.critical).toEqual(["packages/api/src/audit/**", ".github/sensitive-paths"]);
    expect(t.exempt).toEqual([".github/ISSUE_TEMPLATE/**", "packages/api/src/audit/readme.md"]);
    expect(parseSensitiveTiers("scripts/ci/**\n").critical).toEqual(["scripts/ci/**"]);
    expect(() => parseSensitiveTiers("[bogus]\nx\n")).toThrow("unknown section [bogus]");
  });

  it("rejects a malformed section header and a negated glob (M8)", () => {
    for (const bad of ["[ exempt ]", "[exempt", "[abc]x.ts", "[exempt] # note"])
      expect(() => parseSensitiveTiers(`[gate]\n.github/**\n${bad}\nx\n`), bad).toThrow(
        "malformed section header",
      );
    expect(() => parseSensitiveTiers("[exempt]\n!docs/**\n")).toThrow("negated glob");
  });

  it("classifies critical over exempt, exempt over deps and gate, deps over gate", () => {
    const c = (f: string) => tierOf(f, [t]);
    expect(c("packages/api/src/audit/a.ts")).toBe("critical");
    expect(c("packages/api/src/audit/readme.md")).toBe("critical");
    expect(c(".github/sensitive-paths")).toBe("critical");
    expect(c(".github/ISSUE_TEMPLATE/bug.yml")).toBeNull();
    expect(c(".github/dependabot.yml")).toBe("deps");
    expect(c("pnpm-lock.yaml")).toBe("deps");
    expect(c(".github/workflows/ci.yml")).toBe("gate");
    expect(c("docs/a.md")).toBeNull();
  });

  it("takes the highest tier across base and head, so a PR cannot lower its own tier", () => {
    const head = parseSensitiveTiers("[gate]\n.github/**\n[exempt]\n.github/workflows/**\n");
    const base = parseSensitiveTiers("[gate]\n.github/**\n");
    expect(tierOf(".github/workflows/ci.yml", [head])).toBeNull();
    expect(tierOf(".github/workflows/ci.yml", [base, head])).toBe("gate");
  });

  const classify = (f: string) => tierOf(f, [t]);
  const run = (changedFiles: string[], artifactText: string | undefined, late: string[] = []) =>
    evaluateSensitiveReview({
      changedFiles,
      classify,
      prNumber: 7,
      artifactText,
      filesChangedAfterReviewedSha: late,
    });

  it("needs no artifact for deps-only or exempt changes", () => {
    const r = run(["pnpm-lock.yaml", ".github/ISSUE_TEMPLATE/bug.yml", "docs/a.md"], undefined);
    expect(r.ok).toBe(true);
    expect(r.messages[0]).toContain("deps tier only (pnpm-lock.yaml)");
  });

  it("accepts effort high for gate paths and requires xhigh or max for critical paths", () => {
    const high = artifact.replace('"xhigh"', '"high"');
    expect(run([".github/workflows/ci.yml"], high).ok).toBe(true);
    const r = run([".github/workflows/ci.yml", "packages/api/src/audit/a.ts"], high);
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toContain("critical paths need effort xhigh or max, got high");
    expect(run([".github/workflows/ci.yml"], artifact.replace('"xhigh"', '"medium"')).ok).toBe(
      false,
    );
  });

  it("ignores deps and exempt files changed after reviewedSha", () => {
    expect(
      run(["scripts/ci/x.ts"], artifact, ["pnpm-lock.yaml", ".github/ISSUE_TEMPLATE/a.yml"]).ok,
    ).toBe(true);
    expect(run(["scripts/ci/x.ts"], artifact, ["scripts/ci/y.ts"]).ok).toBe(false);
  });
});

describe("deps-only demotion: package.json (ADR-0007, version-only)", () => {
  const pkg = (dev: Record<string, string> | undefined, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      name: "q",
      scripts: { lint: "biome ci ." },
      ...(dev ? { devDependencies: dev } : {}),
      ...extra,
    });
  const before = pkg({ a: "^1.2.3", b: "workspace:*", c: "1.0.0" });

  it("a version-only bump of existing packages is deps", () => {
    expect(packageJsonDepsOnly(before, pkg({ a: "^1.2.4", b: "workspace:*", c: "1.0.0" }))).toBe(
      true,
    );
    expect(
      packageJsonDepsOnly(before, pkg({ a: "~1.3.0", b: "workspace:*", c: "2.0.0-rc.1" })),
    ).toBe(true);
    // key order is not a change
    expect(packageJsonDepsOnly(before, pkg({ c: "1.0.0", b: "workspace:*", a: "^1.2.4" }))).toBe(
      true,
    );
  });

  it("a swapped, added or removed package, or a non-semver value, is not deps (I1)", () => {
    const cases: Array<[string, string]> = [
      ["npm alias (E)", pkg({ a: "npm:not-a@5.0.2", b: "workspace:*", c: "1.0.0" })],
      ["github spec (F)", pkg({ a: "github:someone-else/a", b: "workspace:*", c: "1.0.0" })],
      ["git url", pkg({ a: "git+https://example.test/a.git", b: "workspace:*", c: "1.0.0" })],
      ["tarball url", pkg({ a: "https://example.test/a.tgz", b: "workspace:*", c: "1.0.0" })],
      ["file:", pkg({ a: "file:../a", b: "workspace:*", c: "1.0.0" })],
      ["link:", pkg({ a: "link:../a", b: "workspace:*", c: "1.0.0" })],
      ["dist-tag", pkg({ a: "latest", b: "workspace:*", c: "1.0.0" })],
      ["range", pkg({ a: ">=1.2.3", b: "workspace:*", c: "1.0.0" })],
      ["workspace to semver", pkg({ a: "^1.2.3", b: "^1.0.0", c: "1.0.0" })],
      ["added package", pkg({ a: "^1.2.3", b: "workspace:*", c: "1.0.0", d: "^1.0.0" })],
      ["removed package", pkg({ a: "^1.2.3", b: "workspace:*" })],
      ["field removed", pkg(undefined)],
      [
        "field added",
        pkg({ a: "^1.2.3", b: "workspace:*", c: "1.0.0" }, { dependencies: { e: "^1.0.0" } }),
      ],
      [
        "script edit",
        pkg({ a: "^1.2.3", b: "workspace:*", c: "1.0.0" }, { scripts: { lint: "true" } }),
      ],
      ["not json", "{ not json"],
      ["not an object", "null"],
    ];
    for (const [label, after] of cases)
      expect(packageJsonDepsOnly(before, after), label).toBe(false);
    expect(packageJsonDepsOnly(undefined, before)).toBe(false);
    expect(
      packageJsonDepsOnly(
        JSON.stringify({ devDependencies: ["a"] }),
        JSON.stringify({ devDependencies: ["b"] }),
      ),
    ).toBe(false);
  });
});

describe("deps-only demotion: workflows (ADR-0007, C1 and I1)", () => {
  const diff = (...hunks: string[][]) =>
    [
      "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
      "index 1111111..2222222 100644",
      "--- a/.github/workflows/ci.yml",
      "+++ b/.github/workflows/ci.yml",
      ...hunks.flatMap((h) => ["@@ -1 +1 @@", ...h]),
      "",
    ].join("\n");
  const bump = ["-      - uses: actions/checkout@v7", "+      - uses: actions/checkout@v8"];
  const hex = (c: string) => c.repeat(40);

  it("a ref-only bump of an existing uses: line is deps", () => {
    expect(workflowDiffUsesOnly(diff(bump))).toBe(true);
    expect(
      workflowDiffUsesOnly(
        diff(bump, [
          "-        uses: pnpm/action-setup@v6",
          "+        uses: pnpm/action-setup@v6.1.0",
        ]),
      ),
    ).toBe(true);
    expect(
      workflowDiffUsesOnly(
        diff([
          `-      - uses: actions/checkout@${hex("a")} # v4.1.0`,
          `+      - uses: actions/checkout@${hex("b")} # v4.2.0`,
        ]),
      ),
    ).toBe(true);
    expect(workflowDiffUsesOnly(diff(bump).replace(/\n/g, "\r\n"))).toBe(true);
  });

  it("injected shell or JavaScript shaped like a uses: line is not deps (C1)", () => {
    const cases: Array<[string, string[]]> = [
      ["run block, added (C)", ["+          uses:$(echo${IFS}x)@x||true"]],
      ["run block, replacing a run line", ["-          pnpm lint", "+          uses:$(x)@x||true"]],
      ["template literal (D)", ["+            uses:${String(process.env.PROJECT_TOKEN).length}@x"]],
      ["ref injection", ["-          uses:a@v1", "+          uses:a@$(x)"]],
      ["ref template injection", ["-          uses:a@v1", "+          uses:a@${x}"]],
      [
        "comment injection",
        ["-      - uses: actions/checkout@v7", "+      - uses: actions/checkout@v8 # ${fetch(1)}"],
      ],
    ];
    for (const [label, hunk] of cases) expect(workflowDiffUsesOnly(diff(hunk)), label).toBe(false);
  });

  it("a swapped, added or removed action is not deps (I1)", () => {
    const cases: Array<[string, string[]]> = [
      [
        "repository swap (A)",
        ["-      - uses: actions/github-script@v9", "+      - uses: someone-else/github-script@v9"],
      ],
      ["added step (B)", ["+      - uses: x@main"]],
      ["removed step", ["-      - uses: actions/checkout@v7"]],
      [
        "indent change",
        ["-      - uses: actions/checkout@v7", "+        - uses: actions/checkout@v8"],
      ],
      [
        "marker change",
        ["-      - uses: actions/checkout@v7", "+        uses: actions/checkout@v8"],
      ],
      [
        "unequal counts",
        [
          "-      - uses: actions/checkout@v7",
          "-      - uses: actions/setup-node@v7",
          "+      - uses: actions/checkout@v8",
        ],
      ],
      ["other line", [...bump, "-        run: pnpm lint", "+        run: true"]],
      ["context line", [...bump, "       with:"]],
    ];
    for (const [label, hunk] of cases) expect(workflowDiffUsesOnly(diff(hunk)), label).toBe(false);
    expect(workflowDiffUsesOnly("")).toBe(false);
    expect(workflowDiffUsesOnly(diff())).toBe(false);
    expect(workflowDiffUsesOnly(`new file mode 100644\n${diff(bump)}`)).toBe(false);
  });
});

describe("deps demotion wired through git (M7)", () => {
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const env = { EVENT_NAME: "pull_request", BASE_SHA: BASE, HEAD_SHA: HEAD, PR_NUMBER: "7" };
  const tiers = "[critical]\nscripts/ci/sensitive-review.ts\n[gate]\n.github/**\npackage.json\n";
  const readFile = (p: string) => (p === ".github/sensitive-paths" ? tiers : undefined);
  const gitWith =
    (answers: Record<string, { status: number | null; stdout: string | null; stderr: string }>) =>
    (args: string[]) =>
      answers[args.slice(0, 2).join(" ")] ?? ok();
  const pkg = (v: string) => JSON.stringify({ name: "q", devDependencies: { vitest: v } });
  const withPkg = (after: string | null) =>
    gitWith({
      "diff --name-only": ok("package.json\0"),
      [`show ${BASE}:package.json`]: ok(pkg("^1.2.3")),
      [`show ${HEAD}:package.json`]:
        after === null ? { status: 128, stdout: "", stderr: "fatal" } : ok(after),
    });

  it("package.json: a bump is deps, an alias or an unreadable side is gate", () => {
    expect(runSensitiveReview(env, { runGit: withPkg(pkg("^1.2.4")), readFile })).toEqual({
      code: 0,
      messages: ["deps tier only (package.json): automated checks cover it"],
    });
    const alias = runSensitiveReview(env, {
      runGit: withPkg(pkg("npm:not-vitest@5.0.2")),
      readFile,
    });
    expect(alias.code).toBe(1);
    expect(alias.messages[0]).toContain("gate paths touched (package.json)");
    expect(runSensitiveReview(env, { runGit: withPkg(null), readFile }).code).toBe(1);
    expect(
      listSensitiveChanges(env, { runGit: withPkg(pkg("npm:x@1.0.0")), readFile }).files,
    ).toEqual(["package.json"]);
  });

  const wf = ".github/workflows/ci.yml";
  const withDiff = (d: { status: number; stdout: string; stderr: string }) =>
    gitWith({ "diff --name-only": ok(`${wf}\0`), "diff -U0": d });
  const hunk = (a: string, b: string) => ok(`@@ -1 +1 @@\n-${a}\n+${b}\n`);

  it("workflow: git diff -U0 decides; a bump is deps, an injection is gate, a failure is 2", () => {
    const calls: string[][] = [];
    const bump = withDiff(hunk("      - uses: a/b@v7", "      - uses: a/b@v8"));
    const spy = (args: string[]) => {
      calls.push(args);
      return bump(args);
    };
    expect(runSensitiveReview(env, { runGit: spy, readFile }).code).toBe(0);
    expect(calls).toContainEqual(["diff", "-U0", "--no-color", `${BASE}...${HEAD}`, "--", wf]);
    const inject = withDiff(hunk("          pnpm lint", "          uses:$(x)@x||true"));
    expect(runSensitiveReview(env, { runGit: inject, readFile }).code).toBe(1);
    expect(listSensitiveChanges(env, { runGit: inject, readFile }).files).toEqual([wf]);
    const failing = withDiff({ status: 128, stdout: "", stderr: "fatal: bad object" });
    expect(runSensitiveReview(env, { runGit: failing, readFile }).code).toBe(2);
    expect(listSensitiveChanges(env, { runGit: failing, readFile }).code).toBe(2);
  });

  it("exits 2 when the base tier file has an unknown section", () => {
    const runGit = gitWith({
      "diff --name-only": ok("docs/a.md\0"),
      "ls-tree --name-only": ok(".github/sensitive-paths\0"),
      [`show ${BASE}:.github/sensitive-paths`]: ok("[bogus]\nx\n"),
    });
    const r = runSensitiveReview(env, { runGit, readFile });
    expect(r.code).toBe(2);
    expect(r.messages[0]).toContain("on the base: unknown section [bogus]");
  });

  it("an untiered base keeps a head [gate] path at critical (bootstrap)", () => {
    const runGit = gitWith({
      "diff --name-only": ok(`${wf}\0`),
      "diff -U0": hunk("        run: pnpm lint", "        run: true"),
      "ls-tree --name-only": ok(".github/sensitive-paths\0"),
      [`show ${BASE}:.github/sensitive-paths`]: ok(".github/**\n"),
    });
    const high = artifact.replace('"xhigh"', '"high"');
    const r = runSensitiveReview(env, {
      runGit,
      readFile: (p) => (p === "docs/reviews/pr-7.md" ? high : readFile(p)),
    });
    expect(r.code).toBe(1);
    expect(r.messages[0]).toContain("critical paths need effort xhigh or max, got high");
  });
});

describe("deps demotion against a real git repo (C1, I1 repros)", () => {
  type Edit = (p: string, f: (t: string) => string) => void;
  const git = (cwd: string, args: string[]) => {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(cwd, ".gitcfg") },
    });
    return { status: r.status, stdout: r.stdout ?? null, stderr: r.stderr ?? null };
  };
  const tiers =
    "[critical]\n.github/sensitive-paths\n[gate]\n.github/**\nscripts/**\npackage.json\n";
  const workflow = [
    "name: ci",
    "on: [pull_request]",
    "jobs:",
    "  ci:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - uses: actions/github-script@v9",
    "        with:",
    "          script: |",
    "            const n = 1;",
    "            core.info(`n=${n}`);",
    "      - name: Test",
    "        run: |",
    "          pnpm lint",
    "          pnpm coverage",
    "",
  ].join("\n");
  const pkg = (dev: Record<string, string>) =>
    `${JSON.stringify({ name: "q", scripts: { lint: "biome ci ." }, devDependencies: dev }, null, 2)}\n`;
  const baseDeps = { picomatch: "^4.0.7", vitest: "^5.0.2" };
  const wfPath = ".github/workflows/ci.yml";

  /**
   * Commits the base, then each change as its own commit, and runs both entry points
   * at the last commit. With two or more changes, an xhigh artifact reviews the first.
   */
  const inRepo = (changes: Array<(edit: Edit) => void>) => {
    const dir = mkdtempSync(join(tmpdir(), "sensitive-deps-"));
    try {
      const write = (p: string, t: string) => {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), t);
      };
      const edit: Edit = (p, f) => write(p, f(readFileSync(join(dir, p), "utf8")));
      const commit = () => {
        git(dir, ["add", "-A"]);
        git(dir, ["-c", "user.name=T", "-c", "user.email=t@example.test", "commit", "-qm", "c"]);
        return (git(dir, ["rev-parse", "HEAD"]).stdout ?? "").trim();
      };
      writeFileSync(join(dir, ".gitcfg"), "");
      git(dir, ["init", "-q"]);
      write(".gitignore", ".gitcfg\n");
      write(".github/sensitive-paths", tiers);
      write(wfPath, workflow);
      write("package.json", pkg(baseDeps));
      write("scripts/x.ts", "export const x = 1;\n");
      const shas = [commit()];
      for (const change of changes) {
        change(edit);
        shas.push(commit());
      }
      const art = `---\nreviewer: "opus-5.5"\neffort: "xhigh"\nreviewedSha: "${shas[1]}"\nverdict: "approve"\n---\n`;
      const deps = {
        runGit: (args: string[]) => git(dir, args),
        readFile: (p: string) => {
          if (p === ".github/sensitive-paths") return tiers;
          return p === "docs/reviews/pr-7.md" && changes.length > 1 ? art : undefined;
        },
      };
      const e = {
        EVENT_NAME: "pull_request",
        BASE_SHA: shas[0],
        HEAD_SHA: shas.at(-1),
        PR_NUMBER: "7",
      };
      return { review: runSensitiveReview(e, deps), label: listSensitiveChanges(e, deps) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const wfEdit = (from: string, to: string) => (edit: Edit) =>
    edit(wfPath, (t) => {
      expect(t).toContain(from);
      return t.replace(from, to);
    });
  const depEdit = (dev: Record<string, string>) => (edit: Edit) =>
    edit("package.json", () => pkg(dev));

  it("keeps genuine version bumps at deps", () => {
    for (const change of [
      wfEdit("actions/checkout@v7", "actions/checkout@v8"),
      depEdit({ ...baseDeps, vitest: "^5.0.3" }),
    ]) {
      const r = inRepo([change]);
      expect(r.review.code).toBe(0);
      expect(r.review.messages[0]).toContain("deps tier only");
      expect(r.label.files).toEqual([]);
    }
  });

  it("classifies every swap and injection repro as gate, with the sensitive label", () => {
    const cases: Array<[string, (edit: Edit) => void, string]> = [
      ["A repo swap", wfEdit("actions/github-script@v9", "someone-else/github-script@v9"), wfPath],
      [
        "B added step",
        wfEdit("      - name: Test\n", "      - uses: x@main\n      - name: Test\n"),
        wfPath,
      ],
      [
        "C run block",
        wfEdit(
          "          pnpm lint\n",
          "          pnpm lint\n          uses:$(echo${IFS}x)@x||true\n",
        ),
        wfPath,
      ],
      [
        "D template literal",
        wfEdit(
          "            const n = 1;\n",
          "            const n = 1;\n            uses:${String(process.env.PROJECT_TOKEN).length}@x\n",
        ),
        wfPath,
      ],
      ["E npm alias", depEdit({ ...baseDeps, vitest: "npm:not-vitest@5.0.2" }), "package.json"],
      [
        "F github spec",
        depEdit({ ...baseDeps, picomatch: "github:someone-else/picomatch" }),
        "package.json",
      ],
    ];
    for (const [label, change, file] of cases) {
      const r = inRepo([change]);
      expect(r.review.code, label).toBe(1);
      expect(r.review.messages[0], label).toContain(`gate paths touched (${file})`);
      expect(r.label.files, label).toEqual([file]);
    }
  });

  it("fails the late-file rule on an injection added after reviewedSha", () => {
    const r = inRepo([
      (edit) => edit("scripts/x.ts", () => "export const x = 2;\n"),
      wfEdit("          pnpm lint\n", "          pnpm lint\n          uses:$(x)@x||true\n"),
    ]);
    expect(r.review.code).toBe(1);
    expect(r.review.messages[0]).toBe(`sensitive files changed after reviewedSha: ${wfPath}`);
  });
});
