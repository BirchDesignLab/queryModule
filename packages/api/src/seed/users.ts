import type { Role } from "@querymodule/core/contracts";

// Usernames and roles only (spec 8.5). Generic names on the reserved example.test domain.
export const DEMO_USERS: readonly { email: string; name: string; role: Role }[] = [
  { email: "dispatcher@example.test", name: "Demo Dispatcher", role: "user" },
  { email: "records@example.test", name: "Demo Records Clerk", role: "user" },
  { email: "mobileunit@example.test", name: "Demo Mobile Unit", role: "user" },
  { email: "officer@example.test", name: "Demo Training Officer", role: "trainingOfficer" },
  { email: "admin@example.test", name: "Demo Admin", role: "admin" },
  { email: "smoke@example.test", name: "Smoke Test", role: "user" },
];
