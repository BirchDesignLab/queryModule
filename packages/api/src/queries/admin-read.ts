import type { AdminQueryDetail } from "@querymodule/core/contracts";
import { and, eq, isNotNull } from "drizzle-orm";
import { sourceResult } from "../db/schema";
import { type Tx, withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { actorOf, type Principal } from "../seams";
import { authorizeQueryAccess } from "./policy";
import { loadDetail } from "./read";

/**
 * adminViewed did not commit: the admin read answers 500 and decrypts nothing (SEC-012). The
 * message is fixed text; the cause is kept for the route to log by class only (spec 5.9).
 */
export class AdminViewedAuditError extends Error {
  constructor(cause: unknown) {
    super("admin query read: adminViewed not recorded", { cause });
    this.name = "AdminViewedAuditError";
  }
}

/** A credential-owner view by a principal that holds no delegated result of the request. */
export class CredentialOwnerViewError extends Error {
  constructor() {
    super("adminViewed: no delegated credential row for this principal");
    this.name = "CredentialOwnerViewError";
  }
}

/**
 * The admin read of one request (spec 5.1, 5.2 admin basis, 5.5; FR-063, SEC-012, SEC-014;
 * #713): null unless the access policy answers basis "admin" (an unknown or malformed id, or a
 * caller who is not an admin). Then one transaction writes adminViewed (viewerBasis admin) and
 * commits before any DEK is unwrapped; a failed write throws AdminViewedAuditError and nothing is
 * decrypted. The body is the owner's detail with every result's hidden flag. includeHidden is
 * recorded and has no other effect until result_visibility lands (M3 P2): no result is hidden.
 */
export async function readAdminQuery(
  d: AppDeps,
  principal: Principal,
  correlationId: string,
  includeHidden: boolean,
): Promise<AdminQueryDetail | null> {
  const access = await authorizeQueryAccess(d.db, principal, correlationId, "read", "admin");
  if (!access.ok || access.basis !== "admin") return null;
  try {
    await withTransaction(d.db, (tx) =>
      recordAdminViewed(tx, d, principal, correlationId, includeHidden, "admin"),
    );
  } catch (e) {
    throw new AdminViewedAuditError(e);
  }
  return loadDetail(d, correlationId, { view: "admin" });
}

/**
 * The one adminViewed writer (spec 4.7; SEC-012): viewerBasis from the caller's basis, never
 * "owner" (the owner's read writes no row, spec 5.2). Basis credentialOwner first checks, inside
 * the same transaction, that a source_result row of this request names the principal as
 * credential owner with a delegation id; an own-credential self read is not a credential-owner
 * view (the open #317 policy box, fixed with M3 delegation). Without one it throws
 * CredentialOwnerViewError and writes nothing (#561 binding box; M3's delegated route is its
 * first caller). Details hold identifiers and the flag only.
 */
export async function recordAdminViewed(
  tx: Tx,
  d: AppDeps,
  principal: Principal,
  correlationId: string,
  includeHidden: boolean,
  basis: "admin" | "credentialOwner",
): Promise<void> {
  if (basis === "credentialOwner") {
    const [row] = await tx
      .select({ resultId: sourceResult.resultId })
      .from(sourceResult)
      .where(
        and(
          eq(sourceResult.correlationId, correlationId),
          eq(sourceResult.credentialUserId, principal.userId),
          isNotNull(sourceResult.delegationId),
        ),
      )
      .limit(1);
    if (!row) throw new CredentialOwnerViewError();
  }
  await d.audit.record(tx, {
    type: "adminViewed",
    correlationId,
    actor: actorOf(principal),
    identitySource: principal.identitySource,
    ...(principal.hostSubject ? { hostSubject: principal.hostSubject } : {}),
    details: { correlationId, viewerBasis: basis, includeHidden },
  });
}
