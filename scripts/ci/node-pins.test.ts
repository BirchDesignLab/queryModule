import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ADR-0001: .nvmrc, the engines floor and both Dockerfile stages name one Node release, so a
// security bump (24.22.1, Node2Shell CVE-2026-111497) cannot land in one place and miss another.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]) => readFileSync(resolve(root, ...p), "utf8");

const nvmrc = read(".nvmrc").trim();
const engines: string = JSON.parse(read("package.json")).engines.node;
const froms = [...read("deploy", "Dockerfile").matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);

describe("Node version pins", () => {
  it("pins .nvmrc to an exact 24.x release at or above the Node2Shell fix", () => {
    expect(nvmrc).toMatch(/^24\.\d+\.\d+$/);
    const [, minor, patch] = nvmrc.split(".").map(Number) as [number, number, number];
    expect(minor > 22 || (minor === 22 && patch >= 1)).toBe(true);
  });

  it("sets the engines floor to the .nvmrc release, below 25", () => {
    expect(engines).toBe(`>=${nvmrc} <25`);
  });

  it("builds and runs both Dockerfile stages on the .nvmrc release, pinned by digest", () => {
    expect(froms).toHaveLength(2);
    for (const from of froms)
      expect(from).toMatch(
        new RegExp(`^node:${nvmrc.replaceAll(".", "\\.")}-alpine@sha256:[0-9a-f]{64}$`),
      );
  });
});
