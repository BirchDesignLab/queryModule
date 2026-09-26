import { z } from "zod";

/** Closed feature catalogue (spec 5.8). Unlisted keys default false. */
export const FEATURES = ["credentials", "delegation", "resultHide", "adminAudit"] as const;
export const FeatureKeySchema = z.enum(FEATURES);
export type FeatureKey = z.infer<typeof FeatureKeySchema>;
