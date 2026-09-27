import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLockfile, parseLockfileDocs } from "./lockfile";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseOne(yamlText: string): unknown {
  const docs = parseLockfileDocs(yamlText);
  expect(docs).toHaveLength(1);
  return docs[0];
}

describe("parseLockfileDocs: malformed YAML fails closed (critic:I2)", () => {
  it("throws on a duplicate mapping key that hides a tarball entry", () => {
    const text =
      "packages:\n" +
      "  foo@1.0.0:\n" +
      "    resolution: {integrity: sha512-abc==}\n" +
      "  foo@1.0.0:\n" +
      "    resolution: {tarball: https://example.com/foo.tgz}\n";
    expect(() => parseLockfileDocs(text)).toThrow();
  });

  it("throws on a YAML syntax error", () => {
    const text = "packages:\n  foo@1.0.0:\n    resolution: [1,2\n";
    expect(() => parseLockfileDocs(text)).toThrow();
  });

  it("throws on mis-indented content that drops a tarball entry", () => {
    const text =
      "packages:\n" +
      "  foo@1.0.0:\n" +
      "    resolution: {integrity: sha512-abc==}\n" +
      " bar@1.0.0:\n" +
      "    resolution: {tarball: https://example.com/bar.tgz}\n";
    expect(() => parseLockfileDocs(text)).toThrow();
  });
});

describe("checkLockfile: registry-only lockfile (#79 item 2)", () => {
  it("passes a flow-style resolution with integrity", () => {
    const doc = parseOne("packages:\n  foo@1.0.0:\n    resolution: {integrity: sha512-abc==}\n");
    expect(checkLockfile(doc)).toEqual({ packages: 1, offenders: [] });
  });

  it("passes a block-style resolution with integrity", () => {
    const doc = parseOne(
      "packages:\n  foo@1.0.0:\n    resolution:\n      integrity: sha512-abc==\n",
    );
    expect(checkLockfile(doc)).toEqual({ packages: 1, offenders: [] });
  });

  it("fails a block-style resolution with a tarball", () => {
    const doc = parseOne(
      "packages:\n  foo@1.0.0:\n    resolution:\n      tarball: https://example.com/foo.tgz\n",
    );
    expect(checkLockfile(doc)).toEqual({
      packages: 1,
      offenders: [{ key: "foo@1.0.0", kind: "tarball" }],
    });
  });

  it("fails a quoted-key resolution with a tarball", () => {
    const doc = parseOne(
      'packages:\n  "foo@1.0.0":\n    "resolution": {"tarball": "https://example.com/foo.tgz"}\n',
    );
    expect(checkLockfile(doc)).toEqual({
      packages: 1,
      offenders: [{ key: "foo@1.0.0", kind: "tarball" }],
    });
  });

  it("fails a git or directory resolution", () => {
    const doc = parseOne(
      "packages:\n" +
        "  foo@1.0.0:\n" +
        "    resolution: {commit: abc123, repo: https://example.com/foo.git, type: git}\n" +
        "  bar@1.0.0:\n" +
        "    resolution: {directory: ../bar, type: directory}\n",
    );
    const result = checkLockfile(doc);
    expect(result.packages).toBe(2);
    expect(result.offenders.map((o) => o.key).sort()).toEqual(["bar@1.0.0", "foo@1.0.0"]);
  });

  it("fails a package entry with no resolution at all", () => {
    const doc = parseOne("packages:\n  foo@1.0.0: {}\n");
    expect(checkLockfile(doc)).toEqual({
      packages: 1,
      offenders: [{ key: "foo@1.0.0", kind: "missing" }],
    });
  });

  it("fails an empty resolution object", () => {
    const doc = parseOne("packages:\n  foo@1.0.0:\n    resolution: {}\n");
    expect(checkLockfile(doc)).toEqual({
      packages: 1,
      offenders: [{ key: "foo@1.0.0", kind: "empty" }],
    });
  });

  it("fails closed when packages: is not a mapping", () => {
    const doc = parseOne("packages: []\n");
    expect(() => checkLockfile(doc)).toThrow();
  });

  it("fails closed when packages: is missing", () => {
    const doc = parseOne("lockfileVersion: '9.0'\nimporters:\n  .: {}\n");
    expect(() => checkLockfile(doc)).toThrow();
  });

  it("fails closed when packages: is empty", () => {
    const doc = parseOne("packages: {}\n");
    expect(() => checkLockfile(doc)).toThrow();
  });

  it("passes the real repo pnpm-lock.yaml", () => {
    const text = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
    const docs = parseLockfileDocs(text);
    expect(checkLockfile(docs)).toEqual(expect.objectContaining({ offenders: [] }));
  });
});
