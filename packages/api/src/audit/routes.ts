import {
  type AdminAuditPage,
  AdminAuditPageSchema,
  AdminAuditQuerySchema,
  type AuditDetails,
  type ValidationError,
} from "@querymodule/core/contracts";
import type { Hono } from "hono";
import { adminGuard } from "../admin/access";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { apiError } from "../http/errors";
import type { AppEnv } from "../http/types";
import { errorFields } from "../log/error-fields";
import { actorOf } from "../seams";
import {
  AUDIT_PAGE_DEFAULT_LIMIT,
  type AuditFilter,
  AuditRowReadError,
  decodeAuditCursor,
  readAuditPage,
} from "./read";

const PATH = "/api/v1/admin/audit";

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
 * GET /api/v1/admin/audit (spec 5.1, 4.7; FR-064, SEC-010 to SEC-012; #711). In order: the admin
 * guard (adminAudit off 404 to every caller, 401, 403 passwordChangeRequired, 403 forbidden for
 * any role but admin); the query through AdminAuditQuerySchema, 400 validationFailed naming
 * parameters only (an empty from= or to= is 400: the epoch coercion would read it as 0, #561 Q2);
 * a cursor this route did not issue 400; the page read; then one transaction writes auditViewed
 * with the admin as actor, and only after it commits is the page answered. A read or audit
 * failure answers 500 internal with no rows (fail closed) and logs the stage, the error class and
 * a failing row's id only, never a filter value or cursor (spec 5.9).
 */
export function mountAdminAuditRoutes(app: Hono<AppEnv>, d: AppDeps): void {
  const guard = adminGuard(d, "adminAudit", ["admin"]);

  app.get(PATH, guard, async (c) => {
    const raw = c.req.query();
    for (const field of ["from", "to"] as const)
      if (raw[field] === "") return apiError(c, "validationFailed", undefined, fieldError(field));
    const q = AdminAuditQuerySchema.safeParse(raw);
    if (!q.success) return apiError(c, "validationFailed", undefined, queryErrors(q.error.issues));
    const cursor = q.data.cursor === undefined ? null : decodeAuditCursor(q.data.cursor);
    if (q.data.cursor !== undefined && cursor === null)
      return apiError(c, "validationFailed", undefined, fieldError("cursor"));
    const { user, correlationId, type, from, to } = q.data;
    const filter: AuditFilter = {
      ...(user === undefined ? {} : { user }),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(type === undefined ? {} : { type }),
      from,
      to,
    };

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

    const principal = c.get("principal");
    const details: AuditDetails<"auditViewed"> = {
      filters: {
        ...(user === undefined ? {} : { userId: user }),
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(type === undefined ? {} : { type }),
        from,
        to,
      },
      ...(q.data.cursor === undefined ? {} : { cursor: q.data.cursor }),
      rowCount: body.events.length,
    };
    try {
      await withTransaction(d.db, (tx) =>
        d.audit.record(tx, {
          type: "auditViewed",
          actor: actorOf(principal),
          identitySource: principal.identitySource,
          ...(principal.hostSubject ? { hostSubject: principal.hostSubject } : {}),
          details,
        }),
      );
    } catch (e) {
      d.logger.error("admin audit page failed", {
        stage: "audit",
        error: { name: errorFields(e).name },
      });
      return apiError(c, "internal");
    }
    return c.json(body, 200);
  });
}
