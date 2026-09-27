import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guardLockfile } from "./lockfile-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const OK = "    resolution: {integrity: sha512-kviIHft9h02q+7N2In7tSL9T/HRUSGw==}";

/** A lockfile with the tsx entry's resolution replaced by `lines`. */
function withTsx(...lines: string[]): string {
  return [
    "---",
    "lockfileVersion: '9.0'",
    "",
    "packages:",
    "",
    "  tsx@4.23.15:",
    ...lines,
    "    engines: {node: '>=18.0.0'}",
    "",
    "  yaml@2.8.1:",
    OK,
    "",
    "snapshots:",
    "",
    "  '@vitest/istanbul-lib-report@1.0.1':",
    "    dependencies:",
    "      '@querymodule/config': workspace:*",
    "",
  ].join("\n");
}

describe("pre-install lockfile guard (PR #83 review I1)", () => {
  it("passes this repository's real pnpm-lock.yaml", () => {
    expect(guardLockfile(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"))).toEqual([]);
  });

  it("passes a registry-only lockfile, LF or CRLF, with names containing 'repo' or '*'", () => {
    expect(guardLockfile(withTsx(OK))).toEqual([]);
    expect(guardLockfile(withTsx(OK).replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it.each([
    ["plain tarball", "    resolution: {tarball: https://example.invalid/tsx.tgz}"],
    ["quoted key", '    "resolution": {tarball: https://example.invalid/tsx.tgz}'],
    ["single-quoted key", "    'resolution': {tarball: https://example.invalid/tsx.tgz}"],
    ["extra spacing", "    resolution:  {tarball: https://example.invalid/tsx.tgz}"],
    ["spacing inside the flow map", "    resolution: { integrity: sha512-abc== }"],
    ["integrity plus tarball", "    resolution: {integrity: sha512-abc==, tarball: https://x}"],
    ["tagged value", "    resolution: !!map {tarball: https://example.invalid/tsx.tgz}"],
    ["trailing comment", `${OK} # ok`],
    ["empty integrity", "    resolution: {integrity: }"],
    ["directory", "    resolution: {directory: ../evil, type: directory}"],
    ["git repo", "    resolution: {commit: abc, repo: https://x/y.git, type: git}"],
  ])("rejects the %s form", (_name, line) => {
    expect(guardLockfile(withTsx(line)).length).toBeGreaterThan(0);
  });

  it("rejects a resolution split over several lines", () => {
    expect(guardLockfile(withTsx("    resolution:", "      tarball: https://x/t.tgz"))).not.toEqual(
      [],
    );
    expect(
      guardLockfile(
        withTsx("    resolution: {integrity: sha512-abc==,", "      tarball: https://x}"),
      ),
    ).not.toEqual([]);
  });

  it("rejects an escaped key that a YAML parser would read as resolution", () => {
    expect(
      guardLockfile(withTsx('    "r\\x65solution": {tarball: https://x/t.tgz}', OK)),
    ).not.toEqual([]);
  });

  it("rejects tarball, repo, commit, directory, path or type keys outside a resolution line", () => {
    for (const key of ["tarball", "repo", "commit", "directory", "path", "type"]) {
      expect(guardLockfile(withTsx(OK, `    ${key}: x`))).not.toEqual([]);
      expect(guardLockfile(withTsx(OK, `    '${key}': x`))).not.toEqual([]);
    }
  });

  it("rejects YAML tags, anchors, aliases, merge keys and explicit keys", () => {
    for (const extra of [
      "    engines: !!str x",
      "    engines: &a {node: x}",
      "    engines: *a",
      "    <<: *a",
      "    ? resolution",
      "    cpu: [!x arm64]",
    ]) {
      expect(guardLockfile(withTsx(OK, extra)), extra).not.toEqual([]);
    }
  });

  it("rejects YAML directives and document end markers, but allows '---'", () => {
    expect(guardLockfile(`%YAML 1.2\n${withTsx(OK)}`)).not.toEqual([]);
    expect(guardLockfile(`${withTsx(OK)}...\n`)).not.toEqual([]);
  });

  it("rejects tabs, NUL and alternative line breaks (NEL, LS, PS)", () => {
    for (const code of [0x09, 0x00, 0x85, 0x2028, 0x2029]) {
      const ch = String.fromCharCode(code);
      expect(guardLockfile(withTsx(OK, `    engines:${ch}{node: x}`))).not.toEqual([]);
    }
  });

  it("fails closed when no resolution line exists", () => {
    expect(guardLockfile("lockfileVersion: '9.0'\n")).not.toEqual([]);
  });

  it("runs in ci.yml with the runner's node, before pnpm/action-setup and Install", () => {
    const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
    const guard = ci.indexOf("run: node scripts/ci/lockfile-guard.mjs pnpm-lock.yaml");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(ci.indexOf("uses: pnpm/action-setup"));
    expect(guard).toBeLessThan(ci.indexOf("pnpm install"));
  });

  it("reports line numbers, never the offending value", () => {
    const out = guardLockfile(
      withTsx("    resolution: {tarball: https://example.invalid/tsx.tgz}"),
    );
    expect(out[0]).toMatch(/^line 7: /);
    expect(out.join("\n")).not.toContain("example.invalid");
  });
});
