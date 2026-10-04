import { ROLES, type Role } from "@querymodule/core/contracts";

/** ADR-0011 item 6: admin and implementer open the console; only admin manages users. */
export const canOpenAdmin = (role: string | null | undefined): boolean =>
  role === "admin" || role === "implementer";
export const canManageUsers = (role: string | null | undefined): boolean => role === "admin";

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);
