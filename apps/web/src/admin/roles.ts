/** ADR-0011 item 6: admin and implementer open the console; only admin manages users. */
export const canOpenAdmin = (role: string | null | undefined): boolean =>
  role === "admin" || role === "implementer";
export const canManageUsers = (role: string | null | undefined): boolean => role === "admin";
