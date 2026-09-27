import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledPaths } from "../src/paths";

const roots: string[] = [];
const root = (): string => {
  const r = mkdtempSync(join(tmpdir(), "qm-paths-"));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("bundledPaths", () => {
  it("finds config, migrations and web next to the image dist directory", () => {
    const r = root();
    for (const d of ["dist", "config", "drizzle", "web"]) mkdirSync(join(r, d));
    expect(bundledPaths(join(r, "dist"))).toEqual({
      configDir: join(r, "config"),
      migrationsDir: join(r, "drizzle"),
      webDist: join(r, "web"),
    });
  });
  it("finds them two levels up for ops scripts, with no web build", () => {
    const r = root();
    for (const d of ["scripts/ops", "config", "drizzle"])
      mkdirSync(join(r, d), { recursive: true });
    expect(bundledPaths(join(r, "scripts/ops"))).toEqual({
      configDir: join(r, "config"),
      migrationsDir: join(r, "drizzle"),
      webDist: null,
    });
  });
  it("fails closed when config or migrations are missing", () => {
    const r = root();
    mkdirSync(join(r, "dist"));
    mkdirSync(join(r, "config"));
    expect(() => bundledPaths(join(r, "dist"))).toThrow(/not found/);
  });
});
