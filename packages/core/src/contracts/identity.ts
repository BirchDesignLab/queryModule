import { z } from "zod";

export const ROLES = ["user", "trainingOfficer", "admin"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const IDENTITY_SOURCES = ["local", "host", "system"] as const;
export const IdentitySourceSchema = z.enum(IDENTITY_SOURCES);
export type IdentitySource = z.infer<typeof IdentitySourceSchema>;
