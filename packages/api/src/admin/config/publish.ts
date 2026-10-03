import {
  type AuditEvent,
  type ConfigDocument,
  ConfigDocumentSchema,
  MAX_CHANGED_POINTERS,
  MESSAGE_KEY_PATTERN,
  type ValidationError,
} from "@querymodule/core/contracts";
import { and, eq } from "drizzle-orm";
import { ConfigLoadError, type LoadedConfig } from "../../config/load";
import { siteConfigVersion } from "../../db/schema";
import { withTransaction } from "../../db/tx";
import type { AppDeps } from "../../deps";
import { uuidv7 } from "../../ids";
import { actorOf, type Principal } from "../../seams";
import { activate } from "./activate";
import {
  documentOf,
  liveRow,
  nextVersion,
  siteIdOf,
  toConfigVersion,
  type VersionRow,
  validateDocument,
  versionRow,
} from "./draft";
import { parseStored } from "./store";

/** A pointer segment that fits the audit ConfigPointerSchema grammar once escaped. */
const SEGMENT = /^([A-Za-z0-9_.$-]|~[01])*$/;
const POINTER_MAX = 256;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function leaves(a: unknown, b: unknown, path: string[], out: string[][]): void {
  if (a === b) return;
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys)
      leaves(
        Object.hasOwn(a, k) ? a[k] : undefined,
        Object.hasOwn(b, k) ? b[k] : undefined,
        [...path, k],
        out,
      );
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      leaves(a[i], b[i], [...path, String(i)], out);
    return;
  }
  out.push(path);
}

const toPointer = (segments: readonly string[]) => segments.map((s) => `/${s}`).join("");

/** Drops duplicates and any pointer under another one in the list; sorted. */
function outermost(pointers: Iterable<string>): string[] {
  const set = new Set(pointers);
  return [...set]
    .filter((p) => {
      for (let q = p.slice(0, p.lastIndexOf("/")); ; q = q.slice(0, q.lastIndexOf("/"))) {
        if (q !== p && set.has(q)) return false;
        if (q === "") return true;
      }
    })
    .sort();
}

/**
 * ADR-0011 item 7: the JSON pointers at which `after` differs from `before`, never the
 * values. Key and index segments, RFC 6901 escaped; a leaf under a key outside the audit pointer
 * grammar (an arbitrary map key) is recorded as its deepest parent whose segments all fit, as is
 * a pointer over 256 characters; over MAX_CHANGED_POINTERS, the deepest pointers collapse to
 * their parents until the list fits. Lists compare by index.
 */
export function changedPointers(before: unknown, after: unknown): string[] {
  const paths: string[][] = [];
  leaves(before, after, [], paths);
  let segs = paths.map((path) => {
    const escaped = path.map((s) => s.replaceAll("~", "~0").replaceAll("/", "~1"));
    const bad = escaped.findIndex((s) => !SEGMENT.test(s));
    let kept = bad < 0 ? escaped : escaped.slice(0, bad);
    while (toPointer(kept).length > POINTER_MAX) kept = kept.slice(0, -1);
    return kept;
  });
  let out = outermost(segs.map(toPointer));
  while (out.length > MAX_CHANGED_POINTERS) {
    segs = out.map((p) => p.split("/").slice(1));
    const deepest = Math.max(...segs.map((s) => s.length));
    out = outermost(segs.map((s) => toPointer(s.length === deepest ? s.slice(0, -1) : s)));
  }
  return out;
}

/** What the diff compares: the resolved site config and the document's overlay and mock. */
function resolvedView(config: LoadedConfig, doc: ConfigDocument): unknown {
  return JSON.parse(
    JSON.stringify({ siteConfig: config.siteConfig, locales: doc.locales, mock: doc.mock }),
  );
}

export type PublishResult =
  | { ok: true; version: ReturnType<typeof toConfigVersion> }
  | { ok: false; code: "notFound" | "draftConflict" }
  | { ok: false; code: "validationFailed"; errors: ValidationError[] };

/** Validation errors for the 400 body: message keys and pointers only, never values. */
const refusal = (errors: { key: string; path: string }[]): PublishResult => ({
  ok: false,
  code: "validationFailed",
  errors: errors.map((e) => ({ key: e.key, params: { path: e.path } })),
});

type Prepared =
  | { ok: true; event: (row: VersionRow) => AuditEvent }
  | { ok: false; result: PublishResult };

/**
 * Validates `document` for activation over `live` and builds the configPublished event for the
 * row that will carry it. previousConfigHash and the diff's base come from the live snapshot,
 * which must be the live row's (else a publish is in flight: draftConflict).
 */
async function prepare(
  d: AppDeps,
  principal: Principal,
  live: VersionRow,
  document: string,
  label: string,
  rollbackOf?: number,
): Promise<Prepared> {
  const snapshot = d.config.current();
  if (live.configHash === null || snapshot.configHash !== live.configHash)
    return { ok: false, result: { ok: false, code: "draftConflict" } };
  const candidate = parseStored(document, label);
  const checked = await validateDocument(d, candidate);
  if (!checked.ok) return { ok: false, result: refusal(checked.errors) };
  const config = checked.config;
  const pointers = changedPointers(
    resolvedView(snapshot, documentOf(live)),
    resolvedView(config, ConfigDocumentSchema.parse(candidate)),
  );
  const previousConfigHash = live.configHash;
  return {
    ok: true,
    event: (row) => ({
      type: "configPublished",
      actor: actorOf(principal),
      identitySource: principal.identitySource,
      ...(principal.hostSubject ? { hostSubject: principal.hostSubject } : {}),
      details: {
        siteId: row.siteId,
        versionId: row.id,
        version: row.version,
        configHash: config.configHash,
        previousConfigHash,
        changedPointers: pointers,
        ...(rollbackOf === undefined ? {} : { rollbackOf }),
      },
    }),
  };
}

const STALE: ReadonlySet<string> = new Set([
  "config.versionNotFound",
  "config.versionNotDraft",
  "config.versionChanged",
  "config.liveChanged",
]);

/** activate() refusals as API outcomes; a refusal leaves the old snapshot live. */
async function activateRow(
  d: AppDeps,
  row: VersionRow,
  event: AuditEvent,
  live: VersionRow,
): Promise<PublishResult> {
  try {
    await activate(d, row.version, event, { live: live.version, document: row.document });
  } catch (e) {
    if (!(e instanceof ConfigLoadError)) throw e;
    // The draft (saved in place, published or removed) or the live version moved between the
    // caller's read and activate's commit.
    if (STALE.has(e.reason)) return { ok: false, code: "draftConflict" };
    const key = MESSAGE_KEY_PATTERN.test(e.reason) ? e.reason : "config.schema";
    return refusal([{ key, path: e.path }]);
  }
  const published = await versionRow(d.db, row.siteId, row.version);
  if (!published) throw new Error(`store site ${row.siteId} version ${row.version} missing`);
  return { ok: true, version: toConfigVersion(published) };
}

/**
 * POST /admin/config/publish (ADR-0011 items 3 and 5): the shared draft, on the live base, fully
 * validated, activated through activate() with configPublished (BR-001; ADR-0011 item 7).
 */
export async function publishDraft(
  d: AppDeps,
  principal: Principal,
  draftVersion: number,
): Promise<PublishResult> {
  const siteId = siteIdOf(d);
  const live = await liveRow(d.db, siteId);
  const row = await versionRow(d.db, siteId, draftVersion);
  if (row?.status !== "draft" || row.rollbackOf !== null) return { ok: false, code: "notFound" };
  if (row.baseVersion !== live.version) return { ok: false, code: "draftConflict" };
  const p = await prepare(d, principal, live, row.document, `store site ${siteId} draft`);
  if (!p.ok) return p.result;
  return activateRow(d, row, p.event(row), live);
}

/**
 * POST /admin/config/versions/{version}/rollback (ADR-0011 items 3 and 5): version k's document
 * as a new version n+1 with rollback_of k, activated through activate(); k is never rewritten
 * and the shared draft is left as it is. A refused activation removes the new row (still a
 * draft, so it was never history).
 */
export async function rollbackTo(
  d: AppDeps,
  principal: Principal,
  version: number,
): Promise<PublishResult> {
  const siteId = siteIdOf(d);
  const live = await liveRow(d.db, siteId);
  const target = await versionRow(d.db, siteId, version);
  if (!target || target.status === "draft") return { ok: false, code: "notFound" };
  const label = `store site ${siteId} version ${version}`;
  const p = await prepare(d, principal, live, target.document, label, version);
  if (!p.ok) return p.result;
  const now = d.clock.now();
  const row = await withTransaction(d.db, async (tx) => {
    const [inserted] = await tx
      .insert(siteConfigVersion)
      .values({
        id: uuidv7(now),
        siteId,
        version: await nextVersion(tx, siteId),
        status: "draft",
        document: target.document,
        configHash: null,
        baseVersion: live.version,
        createdBy: principal.userId,
        createdAt: now,
        publishedBy: null,
        publishedAt: null,
        rollbackOf: version,
      })
      .returning();
    return inserted;
  });
  if (!row) throw new Error(`${label} rollback not written`);
  try {
    const result = await activateRow(d, row, p.event(row), live);
    if (!result.ok) await removeDraft(d, row);
    return result;
  } catch (e) {
    await removeDraft(d, row);
    throw e;
  }
}

async function removeDraft(d: AppDeps, row: VersionRow): Promise<void> {
  await withTransaction(d.db, async (tx) => {
    await tx
      .delete(siteConfigVersion)
      .where(and(eq(siteConfigVersion.id, row.id), eq(siteConfigVersion.status, "draft")));
  });
}
