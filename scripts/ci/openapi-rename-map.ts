/**
 * Rename-aware input for the oasdiff breaking step (#171, BR-007, spec 9.3 step 7).
 *
 * The OpenAPI generator names an unnamed schema after its route (`getConfig200___schema0`),
 * so registering a name for it (#95) reads as a removed component. `renameToBase` maps a head
 * component onto a base component only when their canonical JSON is identical (sorted keys,
 * `$ref`s rewritten through the renames found so far, iterated to a fixed point) and the match
 * is unique on both sides. Anything else is left alone, so a real change still reaches oasdiff.
 *
 * CLI: pnpm tsx scripts/ci/openapi-rename-map.ts <base> <head> <out>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isMainModule, readJsonFile } from "./cli-io";

export type OpenApiDoc = {
  components?: { schemas?: Record<string, unknown> };
  [key: string]: unknown;
};

const PREFIX = "#/components/schemas/";

function rewrite(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "$ref" && typeof v === "string" && v.startsWith(PREFIX)) {
        out[k] = PREFIX + (map.get(v.slice(PREFIX.length)) ?? v.slice(PREFIX.length));
      } else out[k] = rewrite(v, map);
    }
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function renameToBase(
  base: OpenApiDoc,
  head: OpenApiDoc,
): { doc: OpenApiDoc; renames: [string, string][] } {
  const baseSchemas = base.components?.schemas ?? {};
  const headSchemas = head.components?.schemas;
  if (!headSchemas) return { doc: head, renames: [] };

  const baseBodies = new Map<string, string[]>();
  for (const [name, schema] of Object.entries(baseSchemas)) {
    if (name in headSchemas) continue;
    const key = canonical(schema);
    baseBodies.set(key, [...(baseBodies.get(key) ?? []), name]);
  }

  const map = new Map<string, string>();
  const renames: [string, string][] = [];
  for (let changed = true; changed; ) {
    changed = false;
    const claims = new Map<string, string[]>();
    for (const [name, schema] of Object.entries(headSchemas)) {
      if (name in baseSchemas || map.has(name)) continue;
      const hit = baseBodies.get(canonical(rewrite(schema, map)));
      if (hit?.length !== 1 || hit[0] === undefined) continue;
      claims.set(hit[0], [...(claims.get(hit[0]) ?? []), name]);
    }
    for (const [target, names] of claims) {
      const [only] = names;
      if (names.length !== 1 || only === undefined) continue;
      map.set(only, target);
      renames.push([only, target]);
      changed = true;
    }
  }
  if (map.size === 0) return { doc: head, renames: [] };

  const doc = rewrite(head, map) as OpenApiDoc;
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(
    (doc.components as { schemas: Record<string, unknown> }).schemas,
  )) {
    schemas[map.get(name) ?? name] = schema;
  }
  (doc.components as { schemas: Record<string, unknown> }).schemas = schemas;
  return { doc, renames };
}

function main(argv: string[]): number {
  const [basePath, headPath, outPath] = argv;
  if (!basePath || !headPath || !outPath) {
    console.error("usage: openapi-rename-map.ts <base> <head> <out>");
    return 2;
  }
  const read = (p: string) => readJsonFile((f) => readFileSync(f, "utf8"), p);
  const b = read(basePath);
  const h = read(headPath);
  if (!b.ok || !h.ok) {
    console.error(
      `cannot load OpenAPI documents: ${!b.ok ? b.reason : ""} ${!h.ok ? h.reason : ""}`,
    );
    return 1;
  }
  const { doc, renames } = renameToBase(b.value as OpenApiDoc, h.value as OpenApiDoc);
  for (const [from, to] of renames) console.log(`renamed ${from} -> ${to}`);
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) process.exit(main(process.argv.slice(2)));
