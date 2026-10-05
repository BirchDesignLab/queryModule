import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixturePolicy } from "@querymodule/core/config";
import { type MockFile, MockFileSchema } from "@querymodule/core/contracts";
import { isMainModule } from "../ci/cli-io";
import * as builders from "./builders";
import { site as defaultSite } from "./sites/default";
import { site as exampleOkSite } from "./sites/example-ok";

/**
 * Mock data generator (spec 5.4, 10.8; FR-043, FR-044). Payloads are built by fixture-safe
 * builders, so the output passes the fixture policy by construction; generate() still checks.
 * Mock data only: never real records. Messages carry fixed text only (spec 5.9).
 *
 *   pnpm tsx scripts/mock-data/generate.ts <siteId>   write packages/config/mock/<siteId>.json
 *   pnpm tsx scripts/mock-data/generate.ts --check    exit 1 naming each file that differs
 */

const SITES: Readonly<Record<string, (b: typeof builders) => MockFile>> = {
  default: defaultSite,
  "example-ok": exampleOkSite,
};

/** The site ids the generator owns, one committed mock file each. */
export const MOCK_SITE_IDS: readonly string[] = Object.keys(SITES);

export const MOCK_DIR = new URL("../../packages/config/mock/", import.meta.url);
export const USAGE = "usage: generate.ts <siteId> | --check";

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

/**
 * 2-space JSON with arrays of scalars kept on one line ("latencyMs": [50, 400]), which is how
 * biome formats these files, so `pnpm lint` accepts the generated output unchanged.
 */
function format(v: unknown, indent: string): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every((x) => typeof x !== "object" || x === null)) {
      return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
    }
    const inner = `${indent}  `;
    const items = v.map((x) => `${inner}${format(x, inner)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  if (typeof v === "object" && v !== null) {
    const entries = Object.entries(v);
    if (entries.length === 0) return "{}";
    const inner = `${indent}  `;
    const items = entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${format(x, inner)}`);
    return `{\n${items.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(v);
}

/** The mock file text for a site: sorted keys, 2-space indent, LF, trailing newline. Deterministic. */
export function generate(siteId: string): string {
  const table = Object.hasOwn(SITES, siteId) ? SITES[siteId] : undefined;
  if (table === undefined) throw new Error("mock-data: unknown site id");
  const file = MockFileSchema.parse(table(builders));
  if (checkFixturePolicy(file).length > 0) throw new Error("mock-data: fixture policy violation");
  return `${format(sortKeys(file), "")}\n`;
}

/** File names under `dir` (a directory URL ending in "/", or a path) that are missing or differ from the generated text. */
export function checkMockFiles(dir: URL | string): string[] {
  const root = typeof dir === "string" ? dir : fileURLToPath(dir);
  return Object.keys(SITES)
    .map((id) => `${id}.json`)
    .filter((name) => {
      // A generator error (schema or fixture policy) throws here: it is a bug, not drift.
      const expected = generate(name.replace(/\.json$/, ""));
      try {
        return readFileSync(join(root, name), "utf8") !== expected;
      } catch {
        return true; // missing or unreadable file: out of date
      }
    });
}

export function main(args: string[]): number {
  if (args.length === 1 && args[0] === "--check") {
    const bad = checkMockFiles(MOCK_DIR);
    for (const name of bad) console.error(`mock-data: ${name} is out of date; run generate.ts`);
    return bad.length === 0 ? 0 : 1;
  }
  const id = args[0];
  if (args.length !== 1 || id === undefined || id.startsWith("-")) {
    console.error(USAGE);
    return 2;
  }
  try {
    writeFileSync(fileURLToPath(new URL(`${id}.json`, MOCK_DIR)), generate(id));
  } catch (e) {
    console.error(e instanceof Error && e.message.startsWith("mock-data:") ? e.message : USAGE);
    return 2;
  }
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) process.exit(main(process.argv.slice(2)));
