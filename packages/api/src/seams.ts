import type { AuditActor, AuditEvent, Role, WsEvent } from "@querymodule/core/contracts";
import type { Tx } from "./db/tx";

export interface Principal {
  userId: string;
  /** Null when the stored address fails AuditActorSchema (see auth/identity.ts). */
  email: string | null;
  role: Role;
  sessionId: string;
  identitySource: "local" | "host";
  hostSubject?: string;
  authenticatedAt: number;
  stepUpAt?: number;
  hostTokenExp?: number;
}

/** Writes one audit row through the caller's transaction; never opens its own. */
export interface AuditService {
  record(tx: Tx, event: AuditEvent): Promise<{ id: number }>;
}

export interface IdentityService {
  resolve(req: Request): Promise<Principal | null>;
}

export interface EventBus {
  publish(userId: string, event: WsEvent): void;
  subscribe(userId: string, handler: (e: WsEvent) => void): () => void;
  onSessionEnded(sessionId: string, handler: () => void): () => void;
}

export interface EntityStore {
  appendSupplemental(
    principal: Principal,
    target: { recordType: string; recordId: string },
    resultIds: string[],
  ): Promise<void>;
}

export const actorOf = (p: Principal): AuditActor => ({
  id: p.userId,
  email: p.email,
  role: p.role,
});
