import { UUID7_PATTERN } from "@querymodule/core/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { queryRequest, sourceResult } from "../db/schema";
import type { Tx } from "../db/tx";
import type { Principal } from "../seams";

export type QueryAction = "read" | "hide";
/** Which route is asking: the owner's routes, the admin route, or the officer's delegated view. */
export type AccessRoute = "own" | "admin" | "delegated";
export type Access =
  | { ok: true; basis: "owner" | "admin" | "credentialOwner"; resultIds: "all" | string[] }
  // callers answer 404, never 403 (spec 5.2)
  | { ok: false };

const DENY: Access = { ok: false };

/**
 * The one query access policy (spec 5.2, SEC-014). Reads query_request part 0 and
 * source_result only; writes nothing. The admin route audits adminViewed itself (M2 P2).
 */
export async function authorizeQueryAccess(
  db: Db | Tx,
  principal: Principal,
  correlationId: string,
  action: QueryAction,
  route: AccessRoute,
): Promise<Access> {
  // The correlation ID is an identifier, not a capability: a malformed one is simply not found.
  if (!UUID7_PATTERN.test(correlationId)) return DENY;
  switch (route) {
    case "own": {
      const owner = await ownerOf(db, correlationId);
      return owner === principal.userId ? { ok: true, basis: "owner", resultIds: "all" } : DENY;
    }
    case "admin": {
      if (action !== "read" || principal.role !== "admin") return DENY;
      return (await ownerOf(db, correlationId)) === undefined
        ? DENY
        : { ok: true, basis: "admin", resultIds: "all" };
    }
    case "delegated": {
      if (action !== "read") return DENY;
      const rows = await db
        .select({ resultId: sourceResult.resultId })
        .from(sourceResult)
        .where(
          and(
            eq(sourceResult.correlationId, correlationId),
            eq(sourceResult.credentialUserId, principal.userId),
          ),
        )
        .orderBy(sourceResult.resultId);
      return rows.length === 0
        ? DENY
        : { ok: true, basis: "credentialOwner", resultIds: rows.map((r) => r.resultId) };
    }
    default:
      return DENY;
  }
}

async function ownerOf(db: Db | Tx, correlationId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: queryRequest.userId })
    .from(queryRequest)
    .where(and(eq(queryRequest.correlationId, correlationId), eq(queryRequest.partId, 0)));
  return row?.userId;
}
