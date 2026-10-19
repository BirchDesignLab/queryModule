import type { Role } from "@querymodule/core/contracts";

// Usernames and roles only (spec 8.5). Generic names on the reserved example.test domain.
// persona: a stored layout override (spec 6.1: it beats the device heuristic), so the officer
// demo shows the mobile-unit layout on a desktop browser (D-A33). A persona is a persona key of
// the site (PersonaDef.key), checked against the shipped default site by seed.test.ts (#363).
export const DEMO_USERS: readonly {
  email: string;
  name: string;
  role: Role;
  persona?: string;
}[] = [
  { email: "dispatcher@example.test", name: "Demo Dispatcher", role: "user" },
  { email: "records@example.test", name: "Demo Records Clerk", role: "user" },
  {
    email: "mobileunit@example.test",
    name: "Demo Mobile Unit",
    role: "user",
    persona: "mobileUnit",
  },
  {
    email: "officer@example.test",
    name: "Demo Training Officer",
    role: "trainingOfficer",
    persona: "mobileUnit",
  },
  { email: "admin@example.test", name: "Demo Admin", role: "admin" },
  // ADR-0011 item 6: edits and publishes site config only.
  { email: "implementer@example.test", name: "Demo Implementer", role: "implementer" },
  { email: "smoke@example.test", name: "Smoke Test", role: "user" },
  // #781: a second account per role, so the audit console has a second actor to show.
  { email: "dispatcher2@example.test", name: "Demo Dispatcher 2", role: "user" },
  {
    email: "officer2@example.test",
    name: "Demo Training Officer 2",
    role: "trainingOfficer",
    persona: "mobileUnit",
  },
  { email: "implementer2@example.test", name: "Demo Implementer 2", role: "implementer" },
  { email: "admin2@example.test", name: "Demo Admin 2", role: "admin" },
];
