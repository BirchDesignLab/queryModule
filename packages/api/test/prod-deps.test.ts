import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

// [critic:T2] The image copies the api's production node_modules (spec 8.1), so
// dev tooling must never be reachable from the api's production dependency
// graph, including through optional peers that pnpm links into a snapshot.
const FORBIDDEN = ["vitest", "vite", "drizzle-kit", "esbuild", "react", "react-dom"];

type Deps = Record<string, string | { version: string }>;
interface Snapshot {
  dependencies?: Deps;
  optionalDependencies?: Deps;
}
interface Lockfile {
  importers?: Record<string, { dependencies?: Deps; optionalDependencies?: Deps }>;
  snapshots?: Record<string, Snapshot | null>;
}

function workspaceLockfile(): Lockfile {
  const text = readFileSync(resolve(import.meta.dirname, "../../../pnpm-lock.yaml"), "utf8");
  const docs = parseAllDocuments(text).map((d) => d.toJS() as Lockfile);
  const lock = docs.find((d) => d?.importers?.["packages/api"] !== undefined);
  if (lock === undefined) throw new Error("pnpm-lock.yaml has no packages/api importer");
  return lock;
}

function entries(deps: Deps | undefined): [string, string][] {
  return Object.entries(deps ?? {}).map(([name, v]) => [
    name,
    typeof v === "string" ? v : v.version,
  ]);
}

/** Every package name reachable from the api's production dependencies, peers included. */
function apiProdClosure(lock: Lockfile): Set<string> {
  const importer = lock.importers?.["packages/api"];
  const names = new Set<string>();
  const seen = new Set<string>();
  const queue = [...entries(importer?.dependencies), ...entries(importer?.optionalDependencies)];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [name, version] = next;
    if (version.startsWith("link:")) continue;
    names.add(name);
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const snap = lock.snapshots?.[key];
    if (snap === undefined) throw new Error(`pnpm-lock.yaml has no snapshot ${key}`);
    queue.push(...entries(snap?.dependencies), ...entries(snap?.optionalDependencies));
  }
  return names;
}

describe("api production dependency graph", () => {
  it("reaches @libsql/client, the one esbuild external", () => {
    expect(apiProdClosure(workspaceLockfile())).toContain("@libsql/client");
  });

  it("carries no dev tooling or react", () => {
    const closure = apiProdClosure(workspaceLockfile());
    expect(FORBIDDEN.filter((name) => closure.has(name))).toEqual([]);
  });
});
