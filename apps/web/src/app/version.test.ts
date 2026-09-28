import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version.js";

describe("APP_VERSION feeds the minClientVersion check (spec 6.7)", () => {
  it("equals apps/web/package.json version", () => {
    // jsdom's global URL breaks `new URL(relative, import.meta.url)` passed straight to
    // readFileSync under the "web" jsdom test environment (T20/IC1 precedent).
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
