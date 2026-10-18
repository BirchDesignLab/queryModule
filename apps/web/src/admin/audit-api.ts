import type { ApiClient } from "@querymodule/client";
import {
  type AdminAuditPage,
  AdminAuditPageSchema,
  type AdminQueryDetail,
  AdminQueryDetailSchema,
  type AuditEventType,
} from "@querymodule/core/contracts";

/**
 * The admin audit routes (SEC-012; spec 5.1) through the typed client, parsed against the
 * contract. Rows and request payloads are regulated data (spec 6.7): nothing here logs, caches or
 * stores a response; each goes straight to the caller, which holds it in component state. Every
 * call is a user action, so none carries `X-Background`.
 */

/** The filters of one audit read; `from` and `to` are inclusive epoch ms. */
export interface AuditFilters {
  user?: string;
  correlationId?: string;
  type?: AuditEventType;
  from: number;
  to: number;
}

/** Why a read gave no data: the status class, not the body (an error body carries no data). */
export interface AuditFetchError {
  kind: "validation" | "forbidden" | "notFound" | "failed";
}

/** How long the Blob URL outlives the click (some engines drop the download otherwise). */
export const REVOKE_DELAY_MS = 1000;
const FALLBACK_EXPORT_NAME = "audit-export.ndjson";
const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}$/;

function errorKind(status: number): AuditFetchError["kind"] {
  if (status === 400) return "validation";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  return "failed";
}

function filterQuery(f: AuditFilters) {
  return {
    ...(f.user === undefined || f.user === "" ? {} : { user: f.user }),
    ...(f.correlationId === undefined || f.correlationId === ""
      ? {}
      : { correlationId: f.correlationId }),
    ...(f.type === undefined ? {} : { type: f.type }),
    from: f.from,
    to: f.to,
  };
}

/** GET /api/v1/admin/audit: one page; `cursor` is the previous page's `nextCursor`. */
export async function fetchAuditPage(
  api: ApiClient,
  filters: AuditFilters,
  cursor?: string,
  limit?: number,
): Promise<AdminAuditPage | AuditFetchError> {
  try {
    const { data, response } = await api.GET("/api/v1/admin/audit", {
      params: {
        query: {
          ...filterQuery(filters),
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        },
      },
    });
    if (!response.ok) return { kind: errorKind(response.status) };
    const parsed = AdminAuditPageSchema.safeParse(data);
    return parsed.success ? parsed.data : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** The server's filename when it is a plain safe name, else a fixed one. */
function exportName(disposition: string | null): string {
  const match = disposition === null ? null : /filename="?([^";]+)"?/.exec(disposition);
  const name = match?.[1]?.trim();
  return name !== undefined && SAFE_NAME.test(name) ? name : FALLBACK_EXPORT_NAME;
}

/**
 * GET /api/v1/admin/audit/export: the NDJSON goes straight to a browser download through a Blob
 * URL revoked a moment after the click. Nothing is kept. True when a file was handed over.
 */
export async function downloadAuditExport(api: ApiClient, filters: AuditFilters): Promise<boolean> {
  try {
    const { data, response } = await api.GET("/api/v1/admin/audit/export", {
      params: { query: filterQuery(filters) },
      parseAs: "blob",
    });
    if (!response.ok || !(data instanceof Blob)) return false;
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportName(response.headers.get("content-disposition"));
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    return true;
  } catch {
    return false;
  }
}

/** GET /api/v1/admin/queries/{correlationId}: each call writes one `adminViewed` on the server. */
export async function fetchAdminQuery(
  api: ApiClient,
  correlationId: string,
  includeHidden: boolean,
): Promise<AdminQueryDetail | AuditFetchError> {
  try {
    const { data, response } = await api.GET("/api/v1/admin/queries/{correlationId}", {
      params: {
        path: { correlationId },
        query: { includeHidden: includeHidden ? "true" : "false" },
      },
    });
    if (!response.ok) return { kind: errorKind(response.status) };
    const parsed = AdminQueryDetailSchema.safeParse(data);
    return parsed.success ? parsed.data : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
