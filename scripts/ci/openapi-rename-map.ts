/**
 * Rename-aware input for the oasdiff breaking step (#171, BR-007, spec 9.3 step 7).
 *
 * The OpenAPI generator names an unnamed schema after its route (`getConfig200___schema0`),
 * so registering a name for it (#95) reads as a removed component. `renameToBase` maps a head
 * component onto a base component only when their canonical JSON is identical (sorted keys,
 * `$ref`s rewritten through the renames found so far, iterated to a fixed point) and the match
 * is unique on both sides. A schema that refers to itself (a recursive tree) is compared with
 * its own name standing in for each candidate base name in turn. Discriminator `mapping`
 * values are rewritten like `$ref`s. Mutually recursive schemas (A refers to B, B to A) are
 * never mapped: neither body can match first. Anything else is left alone, so a real change
 * still reaches oasdiff.
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

type SchemaMap = Record<string, unknown>;

/** `#/components/schemas/<name>` through the renames; any other string is returned as is. */
function rewriteRef(ref: string, map: ReadonlyMap<string, string>): string {
  if (!ref.startsWith(PREFIX)) return ref;
  const name = ref.slice(PREFIX.length);
  return PREFIX + (map.get(name) ?? name);
}

function rewriteDiscriminator(d: Record<string, unknown>, map: ReadonlyMap<string, string>) {
  const { mapping, ...rest } = d;
  const out = rewrite(rest, map) as Record<string, unknown>;
  if (mapping !== null && typeof mapping === "object")
    out.mapping = Object.fromEntries(
      Object.entries(mapping).map(([m, t]) => [m, typeof t === "string" ? rewriteRef(t, map) : t]),
    );
  return out;
}

function rewrite(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "$ref" && typeof v === "string") out[k] = rewriteRef(v, map);
      else if (k === "discriminator" && v !== null && typeof v === "object")
        out[k] = rewriteDiscriminator(v as Record<string, unknown>, map);
      else out[k] = rewrite(v, map);
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

  /** The one base component `name` equals under the renames so far, or undefined. */
  const matchFor = (name: string, schema: unknown, map: ReadonlyMap<string, string>) => {
    const hit = baseBodies.get(canonical(rewrite(schema, map)));
    if (hit !== undefined) return hit.length === 1 ? hit[0] : undefined;
    if (!JSON.stringify(schema).includes(`"${PREFIX}${name}"`)) return undefined;
    // Recursive: its own $refs name `name`, the base body's name the base component, so try
    // each unmatched base name as the stand-in and keep a unique match.
    const found = [...baseBodies.values()].flat().filter((candidate) => {
      const body = rewrite(schema, new Map(map).set(name, candidate));
      return canonical(body) === canonical(baseSchemas[candidate]);
    });
    return found.length === 1 ? found[0] : undefined;
  };

  const map = new Map<string, string>();
  const claimed = new Set<string>();
  const renames: [string, string][] = [];
  for (let changed = true; changed; ) {
    changed = false;
    const claims = new Map<string, string[]>();
    for (const [name, schema] of Object.entries(headSchemas)) {
      if (name in baseSchemas || map.has(name)) continue;
      const target = matchFor(name, schema, map);
      if (target === undefined || claimed.has(target)) continue;
      claims.set(target, [...(claims.get(target) ?? []), name]);
    }
    for (const [target, names] of claims) {
      const [only] = names;
      if (names.length !== 1 || only === undefined) continue;
      map.set(only, target);
      claimed.add(target);
      renames.push([only, target]);
      changed = true;
    }
  }
  if (map.size === 0) return { doc: head, renames: [] };

  const doc = rewrite(head, map) as OpenApiDoc;
  const components = doc.components as { schemas: SchemaMap };
  components.schemas = Object.fromEntries(
    Object.entries(components.schemas).map(([name, schema]) => [map.get(name) ?? name, schema]),
  );
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
