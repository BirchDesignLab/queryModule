import { parseAllDocuments } from "yaml";

export interface LockfileOffender {
  key: string;
  kind: string;
}

export interface LockfileCheckResult {
  packages: number;
  offenders: LockfileOffender[];
}

/**
 * Parses one or more concatenated YAML documents into plain JS values.
 * `pnpm-lock.yaml` under pnpm 12 is multi-document: a `---`-separated document
 * carries the pnpm self-manifest ahead of the workspace lockfile.
 */
export function parseLockfileDocs(text: string): unknown[] {
  const docs = parseAllDocuments(text, { merge: false });
  for (const d of docs) {
    if (d.errors.length > 0) {
      throw new Error(`unparsable YAML: ${d.errors[0].message}`);
    }
  }
  return docs.map((d) => d.toJS()).filter((d) => d !== null && d !== undefined);
}

function resolutionKind(resolution: unknown): string {
  if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution)) {
    return "missing";
  }
  const entries = Object.entries(resolution as Record<string, unknown>);
  if (
    entries.length === 1 &&
    entries[0][0] === "integrity" &&
    typeof entries[0][1] === "string" &&
    entries[0][1].length > 0
  ) {
    return "registry";
  }
  const keys = entries.map(([k]) => k).sort();
  return keys.length > 0 ? keys.join(",") : "empty";
}

/**
 * Checks that every `packages:` entry in a parsed lockfile document resolves
 * from the registry only: `resolution` is an object whose only key is a
 * non-empty `integrity` string, never a tarball URL, git repo, commit,
 * directory or local path.
 *
 * `doc` is one parsed YAML document, or an array of them (see
 * `parseLockfileDocs`); their `packages:` mappings are combined. Fails closed:
 * throws when no document has a `packages:` mapping, or every one is empty
 * (this repo's lockfile always has packages).
 */
export function checkLockfile(doc: unknown): LockfileCheckResult {
  const docs = Array.isArray(doc) ? doc : [doc];
  let sawPackages = false;
  let count = 0;
  const offenders: LockfileOffender[] = [];
  for (const d of docs) {
    if (d === null || typeof d !== "object") continue;
    const packages = (d as Record<string, unknown>).packages;
    if (packages === undefined) continue;
    sawPackages = true;
    if (packages === null || typeof packages !== "object" || Array.isArray(packages)) {
      throw new Error("packages: is not a mapping");
    }
    for (const [key, entry] of Object.entries(packages as Record<string, unknown>)) {
      count += 1;
      const resolution =
        entry !== null && typeof entry === "object"
          ? (entry as Record<string, unknown>).resolution
          : undefined;
      const kind = resolutionKind(resolution);
      if (kind !== "registry") offenders.push({ key, kind });
    }
  }
  if (!sawPackages || count === 0) {
    throw new Error("no packages: entries found");
  }
  return { packages: count, offenders };
}
