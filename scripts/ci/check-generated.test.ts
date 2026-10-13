import { describe, expect, it } from "vitest";
import { findDrift, GENERATED_FILES, GENERATOR_SCRIPTS, type GitResult } from "./generated";

const stub =
  (by: Record<string, GitResult>) =>
  (args: string[]): GitResult =>
    by[args[0] ?? ""] ?? { status: 0, stdout: "" };

describe("findDrift", () => {
  it("fails closed when git diff exits non-zero (dubious ownership, no .git)", () => {
    const r = findDrift(stub({ diff: { status: 128, stdout: "" } }));
    expect(r).toEqual({ ok: false, reason: "git-failed", files: [] });
  });

  it("fails closed when git ls-files exits non-zero", () => {
    const r = findDrift(stub({ "ls-files": { status: 128, stdout: "" } }));
    expect(r).toEqual({ ok: false, reason: "git-failed", files: [] });
  });

  it("fails closed when git cannot be spawned (null status)", () => {
    const r = findDrift(stub({ diff: { status: null, stdout: "" } }));
    expect(r).toEqual({ ok: false, reason: "git-failed", files: [] });
  });

  it("passes when git succeeds with empty output", () => {
    expect(findDrift(stub({}))).toEqual({ ok: true });
  });

  it("reports changed and untracked generated files as drift", () => {
    const r = findDrift(
      stub({
        diff: { status: 0, stdout: `${GENERATED_FILES[0]}\n` },
        "ls-files": { status: 0, stdout: `${GENERATED_FILES[1]}\n` },
      }),
    );
    expect(r).toEqual({
      ok: false,
      reason: "drift",
      files: [GENERATED_FILES[0], GENERATED_FILES[1]],
    });
  });

  it("scopes both git calls to the generated files", () => {
    const seen: string[][] = [];
    findDrift((args) => {
      seen.push(args);
      return { status: 0, stdout: "" };
    });
    expect(seen).toHaveLength(2);
    for (const args of seen) expect(args.slice(-GENERATED_FILES.length)).toEqual(GENERATED_FILES);
  });
});

describe("what gen:check covers (#623 AW1 Q2)", () => {
  it("watches the generated client types, so drift from openapi.json is caught", () => {
    expect(GENERATED_FILES).toContain("packages/client/src/api/generated/openapi-types.ts");
  });

  it("regenerates the client types after the contracts, which they are derived from", () => {
    expect(GENERATOR_SCRIPTS).toEqual(["contracts:gen", "tokens:gen", "client:gen"]);
  });

  it("flags a stale generated client file as drift", () => {
    const stale = "packages/client/src/api/generated/openapi-types.ts";
    const r = findDrift(
      stub({
        diff: {
          status: 0,
          stdout: `${stale}
`,
        },
      }),
    );
    expect(r).toEqual({ ok: false, reason: "drift", files: [stale] });
  });
});
