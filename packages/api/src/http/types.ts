import type { Principal } from "../seams";

export type AppEnv = {
  Variables: { requestId: string; principal: Principal; assetHit?: boolean };
};
