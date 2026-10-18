import {
  AdminAuditExportQuerySchema,
  type AdminAuditPage,
  AdminAuditPageSchema,
  AdminAuditQuerySchema,
  AdminQueryQuerySchema,
  type AuditDetails,
  AuditExportLineSchema,
  type AuditReadRow,
  UUID7_PATTERN,
  type ValidationError,
} from "@querymodule/core/contracts";
import type { Hono } from "hono";
import { adminGuard } from "../admin/access";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { apiError } from "../http/errors";
import type { AppEnv } from "../http/types";
import { errorFields } from "../log/error-fields";
import { AdminViewedAuditError, readAdminQuery } from "../queries/admin-read";
import { actorOf } from "../seams";
import {
  AUDIT_EXPORT_BATCH,
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_PAGE_DEFAULT_LIMIT,
  type AuditFilter,
  AuditRowReadError,
  countAuditExport,
  decodeAuditCursor,
  readAuditExportBatch,
  readAuditPage,
} from "./read";

const PATH = "/api/v1/admin/audit";
const EXPORT_PATH = `${PATH}/export`;
const QUERY_PATH = "/api/v1/admin/queries/:correlationId";

/**
 * One error per top-level query parameter, in issue order, naming the parameter only. A
 * root-level issue (the window rule, an unknown parameter) names none: an unknown parameter's
 * name is client text, and no value is ever echoed (#561).
 */
function queryErrors(issues: readonly { path: readonly PropertyKey[] }[]): ValidationError[] {
  // A Set keeps first-seen order, so each parameter is named once, in issue order.
  const fields = new Set(issues.map((i) => (typeof i.path[0] === "string" ? i.path[0] : "")));
  return [...fields].map((field) =>
    field === ""
      ? { key: "validation.invalidBody" }
      : { key: "validation.invalidBody", params: { field } },
  );
}

const fieldError = (field: string): ValidationError[] => [
  { key: "validation.invalidBody", params: { field } },
];

/**
 * A present numeric parameter (from=, to=, and the page's limit=) that is not plain digits is
 * 400: the number coercion would read an empty or blank value as 0 and accept hex or exponent
 * forms (#561 Q2, AW2 critic W1, #755).
 */
function badNumberField<F extends string>(
  raw: Record<string, string>,
  fields: readonly F[],
): F | null {
  for (const field of fields) {
    const v = raw[field];
    if (v !== undefined && !/^\d+$/.test(v)) return field;
  }
  return null;
}

/** The parsed query's filters, absent ones left out. */
function filterOf(q: AuditFilter): AuditFilter {
  const { user, correlationId, type, from, to } = q;
  return {
    ...(user === undefined ? {} : { user }),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(type === undefined ? {} : { type }),
    from,
    to,
  };
}

/** The filters as audited (spec 4.7): ids, a type name and the window; `user` as userId. */
function auditedFilters(f: AuditFilter): AuditDetails<"auditViewed">["filters"] {
  const { user, ...rest } = f;
  return { ...(user === undefined ? {} : { userId: user }), ...rest };
}

/** One read audit row (SEC-012) in its own transaction, the admin as actor; throws on failure. */
async function recordRead(
  d: AppDeps,
  principal: AppEnv["Variables"]["principal"],
  e:
    | { type: "auditViewed"; details: AuditDetails<"auditViewed"> }
    | { type: "auditExported"; details: AuditDetails<"auditExported"> },
): Promise<void> {
  await withTransaction(d.db, (tx) =>
    d.audit.record(tx, {
      ...e,
      actor: actorOf(principal),
      identitySource: principal.identitySource,
      ...(principal.hostSubject ? { hostSubject: principal.hostSubject } : {}),
    }),
  );
}

/** Fixed text only: the stream's error reaches the HTTP layer, so it carries no row datum. */
class AuditExportStreamError extends Error {
  constructor() {
    super("audit export: read failed after the first byte");
    this.name = "AuditExportStreamError";
  }
}

/**
 * GET /api/v1/admin/audit (spec 5.1, 4.7; SEC-010 to SEC-012; #711). In order: the admin
 * guard (adminAudit off 404 to every caller, 401, 403 passwordChangeRequired, 403 forbidden for
 * any role but admin); the query through AdminAuditQuerySchema, 400 validationFailed naming
 * parameters only (an empty from= or to= is 400: the epoch coercion would read it as 0, #561 Q2);
 * a cursor this route did not issue 400; the page read; then one transaction writes auditViewed
 * with the admin as actor, and only after it commits is the page answered. A read or audit
 * failure answers 500 internal with no rows (fail closed) and logs the stage, the error class and
 * a failing row's id only, never a filter value or cursor (spec 5.9).
 *
 * GET /api/v1/admin/audit/export (spec 5.1, 4.7; SEC-010, SEC-012; #712): the same guard and
 * filters through AdminAuditExportQuerySchema (no cursor or limit). One read takes the bound
 * (the highest id now) and the filtered count; over AUDIT_EXPORT_MAX_ROWS answers 400
 * audit.exportTooLarge and writes nothing. Then one transaction writes auditExported (filters,
 * rowCount, format) and commits before the first batch is read; an audit failure answers 500
 * with nothing streamed. Rows with id <= bound stream oldest first by id as NDJSON, one batch per
 * pull, so rows written meanwhile (the export's own row included) are absent and the streamed
 * set is the audited count. A failure reading the first batch is still a 500; after the first
 * byte a failure errors the stream and logs the class and the last id streamed.
 *
 * GET /api/v1/admin/queries/:correlationId (spec 5.1, 5.2 admin basis, 5.5; FR-063, SEC-012,
 * SEC-014; #713): the same guard; a malformed correlation id or includeHidden (only "true" or
 * "false", absent is false) answers 400 validationFailed naming the parameter, an unknown id 404
 * notFound, both with no audit row. Then readAdminQuery commits adminViewed (viewerBasis admin)
 * before any DEK is unwrapped and answers the request with values and payloads. An audit, read
 * or decrypt failure answers 500 internal with no request data and logs the id, the stage and
 * the error class only, never a value or a payload (spec 5.9).
 */
export function mountAdminAuditRoutes(app: Hono<AppEnv>, d: AppDeps): void {
  const guard = adminGuard(d, "adminAudit", ["admin"]);

  app.get(PATH, guard, async (c) => {
    const raw = c.req.query();
    const badNumber = badNumberField(raw, ["from", "to", "limit"] as const);
    if (badNumber) return apiError(c, "validationFailed", undefined, fieldError(badNumber));
    const q = AdminAuditQuerySchema.safeParse(raw);
    if (!q.success) return apiError(c, "validationFailed", undefined, queryErrors(q.error.issues));
    const cursor = q.data.cursor === undefined ? null : decodeAuditCursor(q.data.cursor);
    if (q.data.cursor !== undefined && cursor === null)
      return apiError(c, "validationFailed", undefined, fieldError("cursor"));
    const filter = filterOf(q.data);

    let body: AdminAuditPage;
    try {
      const page = await readAuditPage(
        d.db,
        filter,
        cursor,
        q.data.limit ?? AUDIT_PAGE_DEFAULT_LIMIT,
      );
      body = AdminAuditPageSchema.parse(page);
    } catch (e) {
      d.logger.error("admin audit page failed", {
        stage: "read",
        ...(e instanceof AuditRowReadError ? { rowId: e.rowId } : {}),
        error: { name: errorFields(e).name },
      });
      return apiError(c, "internal");
    }

    const details: AuditDetails<"auditViewed"> = {
      filters: auditedFilters(filter),
      ...(q.data.cursor === undefined ? {} : { cursor: q.data.cursor }),
      rowCount: body.events.length,
    };
    try {
      await recordRead(d, c.get("principal"), { type: "auditViewed", details });
    } catch (e) {
      d.logger.error("admin audit page failed", {
        stage: "audit",
        error: { name: errorFields(e).name },
      });
      return apiError(c, "internal");
    }
    return c.json(body, 200);
  });

  app.get(QUERY_PATH, guard, async (c) => {
    const correlationId = c.req.param("correlationId");
    if (!UUID7_PATTERN.test(correlationId))
      return apiError(c, "validationFailed", undefined, fieldError("correlationId"));
    const q = AdminQueryQuerySchema.safeParse(c.req.query());
    if (!q.success) return apiError(c, "validationFailed", undefined, queryErrors(q.error.issues));
    try {
      const detail = await readAdminQuery(
        d,
        c.get("principal"),
        correlationId,
        q.data.includeHidden === "true",
      );
      if (detail === null) return apiError(c, "notFound");
      return c.json(detail, 200);
    } catch (e) {
      const audit = e instanceof AdminViewedAuditError;
      d.logger.error("admin query read failed", {
        correlationId,
        stage: audit ? "audit" : "read",
        error: { name: errorFields(audit ? e.cause : e).name },
      });
      return apiError(c, "internal");
    }
  });

  app.get(EXPORT_PATH, guard, async (c) => {
    const raw = c.req.query();
    const badNumber = badNumberField(raw, ["from", "to"] as const);
    if (badNumber) return apiError(c, "validationFailed", undefined, fieldError(badNumber));
    const q = AdminAuditExportQuerySchema.safeParse(raw);
    if (!q.success) return apiError(c, "validationFailed", undefined, queryErrors(q.error.issues));
    const filter = filterOf(q.data);
    const fail = (stage: string, e: unknown, at: { lastId?: number } = {}) =>
      d.logger.error("admin audit export failed", {
        stage,
        ...at,
        ...(e instanceof AuditRowReadError ? { rowId: e.rowId } : {}),
        error: { name: errorFields(e).name },
      });

    let bound: { maxId: number; count: number };
    try {
      bound = await countAuditExport(d.db, filter);
    } catch (e) {
      fail("count", e);
      return apiError(c, "internal");
    }
    if (bound.count > AUDIT_EXPORT_MAX_ROWS)
      return apiError(c, "validationFailed", undefined, [{ key: "audit.exportTooLarge" }]);

    try {
      await recordRead(d, c.get("principal"), {
        type: "auditExported",
        details: { filters: auditedFilters(filter), rowCount: bound.count, format: "ndjson" },
      });
    } catch (e) {
      fail("audit", e);
      return apiError(c, "internal");
    }

    const { maxId } = bound;
    const batch = (afterId: number) =>
      readAuditExportBatch(d.db, filter, { afterId, maxId, limit: AUDIT_EXPORT_BATCH });
    let first: AuditReadRow[];
    try {
      first = await batch(0);
    } catch (e) {
      fail("read", e);
      return apiError(c, "internal");
    }

    const encoder = new TextEncoder();
    const chunk = (rows: readonly AuditReadRow[]) =>
      encoder.encode(
        rows.map((r) => `${JSON.stringify(AuditExportLineSchema.parse(r))}\n`).join(""),
      );
    let lastId = first.at(-1)?.id ?? 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (first.length > 0) controller.enqueue(chunk(first));
        if (first.length < AUDIT_EXPORT_BATCH) controller.close();
      },
      // One batch per pull: a slow reader holds the next read back, and a client abort cancels
      // the stream, so no further pull runs (an enqueue after the cancel is a no-op error the
      // stream drops).
      async pull(controller) {
        let rows: AuditReadRow[];
        try {
          rows = await batch(lastId);
        } catch (e) {
          // The status is already sent: error the stream so the client sees a truncated
          // transfer; the audit row already records the count offered.
          fail("stream", e, { lastId });
          controller.error(new AuditExportStreamError());
          return;
        }
        if (rows.length > 0) controller.enqueue(chunk(rows));
        lastId = rows.at(-1)?.id ?? lastId;
        if (rows.length < AUDIT_EXPORT_BATCH) controller.close();
      },
    });
    return c.body(body, 200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${filter.from}-${filter.to}.ndjson"`,
    });
  });
}
