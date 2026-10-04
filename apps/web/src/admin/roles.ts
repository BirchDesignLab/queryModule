import { ROLES, type Role } from "@querymodule/core/contracts";

/** ADR-0011 item 6: admin and implementer open the console; only admin manages users. */
export const canOpenAdmin = (role: string | null | undefined): boolean =>
  role === "admin" || role === "implementer";
export const canManageUsers = (role: string | null | undefined): boolean => role === "admin";

/**
 * AC-2: the console also follows the published feature flags (spec 5.8; the routes answer 404
 * when a flag is off). `features` is the cached live config's, undefined until it has loaded: the
 * Admin link waits for it, a page already open does not bounce on a missing config.
 */
type AdminFlags = { adminConfig: boolean; adminUsers: boolean } | undefined;
export const adminConfigOn = (features: AdminFlags): boolean => features?.adminConfig === true;
export const adminConfigOff = (features: AdminFlags): boolean =>
  features !== undefined && !features.adminConfig;
export const adminUsersOff = (features: AdminFlags): boolean =>
  features !== undefined && !features.adminUsers;

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);
