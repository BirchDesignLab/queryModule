---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "c1f86496bb1e7ab772ca0826bf9d1de93355488e"
verdict: "approve"
mode: "fast"
---

# Review: feat/core-98

Date: 09-27-26.

## Scope

Branch feat/core-98, range a6cdcd8e338f893ea57e0c46aa69d369cd5f84ae..c1f86496bb1e7ab772ca0826bf9d1de93355488e
(one commit). Delivers the #98 P0 phase-review contract tightenings under master plan 8:

- C-M1: audit envelope `credentialUserId` must equal `details.credentialOwnerUserId` on sourceDispatched and
  sourceResponded (absent envelope when the owner is null), SEC-011.
- C-M3: sourceResponded `status` derived from SourceStatusSchema minus pending and interrupted.
- C-M5: BoundedId and HostSubject patterns built from their length constants.
- C-M7: `packages/core/src/contracts/version.ts` and `packages/core/contracts/ws-events.schema.json` listed under
  [critical] in `.github/sensitive-paths`; CLAUDE.md kept in step.

Fast path: 28 changed lines in critical and gate files, one reviewer.

## Findings summary

- Critical: 0. Important: 0. Minor: 1.
- Controller ruling kept as stands: C-M1 equality is `(credentialUserId ?? null) === details.credentialOwnerUserId`.

## Cross-cutting checks

1. Generated JSON drift: rendered openapi.json, ws-events.schema.json and site-config.schema.json from the head in
   memory and compared with the committed files; all three byte-identical.
2. C-M7 globs: both named files exist; the sensitive-review parser reads literal paths per section, so they resolve
   to critical.
3. Master plan 8 procedure: tests present, audit details additive-only holds, no regeneration needed. The PR also
   touches `.github/sensitive-paths` and CLAUDE.md, which the user's request scoped into this PR (C-M7).

## Answers to the controller's questions

1. C-M1 is consistent with spec 4.7 and 5.2 step 3: `credential_user_id?` is an optional envelope column, the details
   owner is null when no credential applies and is copied from the step-3 snapshot, so null owner means absent
   envelope and a delegated row names the officer in both (story B3). Rule at audit.ts:266-276.
2. C-M3 and C-M5 leave generated JSON byte-identical: verified by in-memory generation (check 1); pattern sources and
   flags unchanged, status enum members and order unchanged.

## Remaining Minors

- audit.ts:199, 266-276: envelope `credentialUserId` stays unconstrained on submitted, acknowledged, interrupted and
  partSkipped; decide per type in the Track A audit writer task or a follow-up contract issue.
