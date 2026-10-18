import {
  type AuditEventType,
  type AuditReadRow,
  AuditReadRowSchema,
  EpochMsSchema,
} from "@querymodule/core/contracts";
import { and, asc, count, desc, eq, gt, gte, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { auditEvent } from "../db/schema";
import type { Tx } from "../db/tx";

/** The admin audit page size when the request names none (spec 5.1); the contract caps it at 200. */
export const AUDIT_PAGE_DEFAULT_LIMIT = 50;

/**
 * The export row cap (spec 5.1 is silent; a planner default): a filtered set above it answers 400
 * audit.exportTooLarge before anything is audited or streamed, so the admin narrows the window.
 */
export const AUDIT_EXPORT_MAX_ROWS = 100_000;

/** Rows per export read; each batch is one query and one stream chunk. */
export const AUDIT_EXPORT_BATCH = 500;

/** The page filters (spec 5.1): `user` is the actor OR the credential owner; window inclusive. */
export type AuditFilter = {
  user?: string;
  correlationId?: string;
  type?: AuditEventType;
  from: number;
  to: number;
};

/** The decoded cursor: the last row of the previous page, by the page order (at, id). */
const AuditCursorValueSchema = z.strictObject({ at: EpochMsSchema, id: z.int().min(1) });
export type AuditCursor = z.infer<typeof AuditCursorValueSchema>;

/** base64url(JSON) without padding, so it fits AuditCursorSchema (#690 m3). */
export function encodeAuditCursor(c: AuditCursor): string {
  return Buffer.from(JSON.stringify({ at: c.at, id: c.id }), "utf8").toString("base64url");
}

/** The cursor back to its position, or null for any cursor this route did not issue (400). */
export function decodeAuditCursor(s: string): AuditCursor | null {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(s)) return null;
  try {
    const parsed = AuditCursorValueSchema.safeParse(
      JSON.parse(Buffer.from(s, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A stored row the tolerant read schema refuses. The message is fixed text and the row's id the
 * only datum carried, so the route logs the id and the class, never row contents (spec 5.9).
 */
export class AuditRowReadError extends Error {
  constructor(readonly rowId: number) {
    super("audit read: stored row failed the read schema");
    this.name = "AuditRowReadError";
  }
}

type Row = typeof auditEvent.$inferSelect;

/** One stored row in the API shape; null columns are omitted, as the envelope leaves them out. */
function toReadRow(r: Row): AuditReadRow {
  const parsed = AuditReadRowSchema.safeParse({
    id: r.id,
    type: r.type,
    at: r.at,
    ...(r.correlationId === null ? {} : { correlationId: r.correlationId }),
    ...(r.partId === null ? {} : { partId: r.partId }),
    actor: { id: r.actorUserId, email: r.actorEmail, role: r.actorRole },
    ...(r.credentialUserId === null ? {} : { credentialUserId: r.credentialUserId }),
    identitySource: r.identitySource,
    ...(r.hostSubject === null ? {} : { hostSubject: r.hostSubject }),
    details: r.details,
  });
  if (!parsed.success) throw new AuditRowReadError(r.id);
  return parsed.data;
}

/** The filter conditions the page and the export share: window inclusive, user actor OR owner. */
function filterWhere(f: AuditFilter): SQL | undefined {
  return and(
    gte(auditEvent.at, f.from),
    lte(auditEvent.at, f.to),
    f.user === undefined
      ? undefined
      : or(eq(auditEvent.actorUserId, f.user), eq(auditEvent.credentialUserId, f.user)),
    f.correlationId === undefined ? undefined : eq(auditEvent.correlationId, f.correlationId),
    f.type === undefined ? undefined : eq(auditEvent.type, f.type),
  );
}

/**
 * One admin audit page (spec 5.1; SEC-012): newest first by (at DESC, id DESC), `at` within
 * [from, to] inclusive. `user` matches actor_user_id OR credential_user_id (two index scans over
 * audit_event_actor_at_idx and audit_event_credential_at_idx; no new index); `correlationId` the
 * envelope column (adminViewed sets it, #690 m2); `type` exact. A cursor continues strictly after
 * its (at, id). nextCursor names the page's last row when more rows follow, else null. Reads only:
 * the route writes auditViewed after this returns, so a page never holds its own row.
 */
export async function readAuditPage(
  db: Db | Tx,
  f: AuditFilter,
  cursor: AuditCursor | null,
  limit: number,
): Promise<{ events: AuditReadRow[]; nextCursor: string | null }> {
  const rows = await db
    .select()
    .from(auditEvent)
    .where(
      and(
        filterWhere(f),
        cursor === null
          ? undefined
          : or(
              lt(auditEvent.at, cursor.at),
              and(eq(auditEvent.at, cursor.at), lt(auditEvent.id, cursor.id)),
            ),
      ),
    )
    .orderBy(desc(auditEvent.at), desc(auditEvent.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last ? encodeAuditCursor({ at: last.at, id: last.id }) : null;
  return { events: page.map(toReadRow), nextCursor };
}

/**
 * The export bound (spec 5.1, 4.7; SEC-012): in one statement, `maxId` is the highest id in the
 * table now (0 when empty) and `count` the filtered rows. One statement reads one snapshot, so
 * every counted row has id <= maxId. Rows are append-only and ids only increase (triggers 0001),
 * so the rows later streamed with id <= maxId are exactly the `count` the route audits.
 */
export async function countAuditExport(
  db: Db | Tx,
  f: AuditFilter,
): Promise<{ maxId: number; count: number }> {
  // An aggregate without GROUP BY answers exactly one row, so the tuple type is exact.
  const [row] = (await db
    .select({
      count: count(),
      maxId: sql<number>`coalesce((SELECT max(${auditEvent.id}) FROM ${auditEvent}), 0)`,
    })
    .from(auditEvent)
    .where(filterWhere(f))) as [{ count: number; maxId: number }];
  return { maxId: Number(row.maxId), count: row.count };
}

/**
 * One export batch: the filtered rows with afterId < id <= maxId, oldest first by id, at most
 * `limit`. Each row parses with the tolerant read schema (AuditExportLineSchema is the same
 * schema); a refused row throws AuditRowReadError naming its id only.
 */
export async function readAuditExportBatch(
  db: Db | Tx,
  f: AuditFilter,
  at: { afterId: number; maxId: number; limit: number },
): Promise<AuditReadRow[]> {
  const rows = await db
    .select()
    .from(auditEvent)
    .where(and(filterWhere(f), gt(auditEvent.id, at.afterId), lte(auditEvent.id, at.maxId)))
    .orderBy(asc(auditEvent.id))
    .limit(at.limit);
  return rows.map(toReadRow);
}
