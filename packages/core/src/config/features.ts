import { z } from "zod";

/** Closed feature catalogue (spec 5.8). Unlisted keys default false. */
/** adminConfig and adminUsers gate the admin console routes (ADR-0011); off in shipped sites. */
export const FEATURES = [
  "credentials",
  "delegation",
  "resultHide",
  "adminAudit",
  "adminConfig",
  "adminUsers",
] as const;
export const FeatureKeySchema = z.enum(FEATURES);
export type FeatureKey = z.infer<typeof FeatureKeySchema>;
