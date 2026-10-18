import type { Principal } from "../seams";

export type AppEnv = {
  Variables: {
    requestId: string;
    principal: Principal;
    assetHit?: boolean;
    /** Monotonic ms at POST /api/v1/queries receipt (markReceipt), where the ack span starts. */
    receivedMono: number;
  };
};
