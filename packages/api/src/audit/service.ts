import { type AuditEvent, AuditEventSchema } from "@querymodule/core/contracts";
import type { Clock } from "../clock";
import { auditEvent } from "../db/schema";
import type { Tx } from "../db/tx";
import type { AuditService } from "../seams";

/**
 * Validates the envelope and per-type details with one AuditEventSchema.parse, then inserts
 * through the caller's tx. It assigns id (autoincrement) and at (clock.now()); a throw rolls
 * back the caller's transaction (fail closed, spec 5.2).
 */
export function createAuditService(clock: Clock): AuditService {
  return {
    async record(tx: Tx, event: AuditEvent) {
      const e = AuditEventSchema.parse(event);
      const rows = await tx
        .insert(auditEvent)
        .values({
          type: e.type,
          at: clock.now(),
          correlationId: e.correlationId ?? null,
          partId: e.partId ?? null,
          actorUserId: e.actor.id,
          actorEmail: e.actor.email,
          actorRole: e.actor.role,
          credentialUserId: e.credentialUserId ?? null,
          identitySource: e.identitySource,
          hostSubject: e.hostSubject ?? null,
          details: e.details,
        })
        .returning({ id: auditEvent.id });
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("audit insert returned no id");
      return { id };
    },
  };
}
