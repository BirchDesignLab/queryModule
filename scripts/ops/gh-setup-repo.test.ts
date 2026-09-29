import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// gh-setup-repo.sh (Task 28, #29, spec 9.1 and 9.4, ADR-0008): the ruleset on
// main and the security settings. A stub `gh` on PATH logs every call and
// answers the reads, so no test ever reaches GitHub.
const script = resolve(dirname(fileURLToPath(import.meta.url)), "gh-setup-repo.sh");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(args: string[], opts: { existingId?: string; login?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gh-setup-repo-"));
  dirs.push(dir);
  const log = join(dir, "calls.log");
  const bodies = join(dir, "bodies.log");
  const stub = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log.replaceAll("\\", "/")}"
case "$*" in
  "auth token -u "*) echo "stub-token" ;;
  "api user --jq .login") echo "${opts.login ?? "BirchDesignLab"}" ;;
  "api repos/O/R/rulesets --jq"*) echo "${opts.existingId ?? ""}" ;;
  *"--input -"*) cat >> "${bodies.replaceAll("\\", "/")}"; echo '{}' ;;
  *) echo '{}' ;;
esac
`;
  writeFileSync(join(dir, "gh"), stub);
  chmodSync(join(dir, "gh"), 0o755);
  const r = spawnSync("bash", [script.replaceAll("\\", "/"), ...args], {
    encoding: "utf8",
    timeout: 25_000,
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, GH_TOKEN: "" },
  });
  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  return { ...r, calls: read(log).split("\n").filter(Boolean), bodies: read(bodies) };
}

const writes = (calls: string[]) => calls.filter((c) => / -X (PUT|POST|PATCH|DELETE) /.test(c));

// Each run forks bash and several stub gh processes; under the full suite on
// Windows (Git Bash) that outgrows the 5s default, so this matches the other
// scripts/ops shell tests: 30s per test, 25s per spawn so a hang still fails.
describe("gh-setup-repo.sh (Task 28, SEC-020)", { timeout: 30_000 }, () => {
  it("dry run by default: prints the ruleset and planned writes, makes none", () => {
    const r = run(["O/R"]);
    expect(r.status, r.stderr).toBe(0);
    expect(writes(r.calls)).toEqual([]);
    expect(r.stdout).toContain("dry run");
    expect(r.stdout).toContain("would create ruleset main");
    expect(r.stdout).toContain('"context": "sensitive-review"');
  });

  it("acts as --as <login> through GH_TOKEN and refuses a token for another account", () => {
    const ok = run(["--as", "BirchDesignLab", "O/R"]);
    expect(ok.calls[0]).toBe("auth token -u BirchDesignLab");
    const bad = run(["--as", "BirchDesignLab", "O/R"], { login: "someone-else" });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("someone-else");
    expect(writes(bad.calls)).toEqual([]);
  });

  it("--apply creates the ruleset: squash only, ci and sensitive-review, linear, no bypass", () => {
    const r = run(["--apply", "O/R"]);
    expect(r.status, r.stderr).toBe(0);
    expect(writes(r.calls)).toEqual([
      "api -X POST repos/O/R/rulesets --input -",
      "api -X PUT repos/O/R/vulnerability-alerts",
      "api -X PUT repos/O/R/automated-security-fixes",
    ]);
    const body = JSON.parse(r.bodies);
    expect(body.bypass_actors).toEqual([]);
    expect(body.enforcement).toBe("active");
    const rule = (t: string) => body.rules.find((x: { type: string }) => x.type === t);
    expect(rule("pull_request").parameters.allowed_merge_methods).toEqual(["squash"]);
    expect(rule("required_status_checks").parameters.required_status_checks).toEqual([
      { context: "ci" },
      { context: "sensitive-review" },
    ]);
    for (const t of ["deletion", "non_fast_forward", "required_linear_history"])
      expect(rule(t), t).toBeDefined();
  });

  it("--apply updates an existing ruleset in place", () => {
    const r = run(["--apply", "O/R"], { existingId: "42" });
    expect(writes(r.calls)[0]).toBe("api -X PUT repos/O/R/rulesets/42 --input -");
  });

  it("rejects unknown options and a malformed repo", () => {
    expect(run(["--force"]).status).toBe(2);
    expect(run(["not a repo"]).status).toBe(2);
  });
});
