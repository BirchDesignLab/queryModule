---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f9bb61daebb5dba006a63a3e13a87dd8bda0fb37"
verdict: "approve"
---

# Review: feat/a-p2-wave-2

Date: 09-28-26.

## Scope

Branch feat/a-p2-wave-2, base ce962f6 (origin/main, merged at 887e2b2) to f9bb61d. Track A P2 Wave A2, Tasks 5 to 10: the shared config load chain in core (resolve, validate), the API loader on that chain with `buildDeps` (Task 7), one `configLoaded` audit row per server start in `bootstrap` (Task 8, critical, SEC-010, SEC-012, BR-001), and the config CLIs moved onto the shared chain (Task 9, #220). Mixed PR: critical slice (`packages/api/src/startup.ts`) and gate slice (deps.ts, api tsconfig, `scripts/ci/config-*`, `scripts/ops/*`). Fix pass 3748170..f9bb61d.

## Findings summary

Critical 0. Important 2. Minor 3. All five ADDRESSED in the fix pass; none kept as stands.

- G-I1 (important): config:validate crashed with a stack echoing the value on a non-hex theme override or a string locale bundle. Resolved: the loader's pre-checks are now one exported `preResolvedChecks` used by both the loader and the CLI, and `checkConfigFile` maps any other throw to `config.schema` at the root with no message.
- G-I2 (important): config:validate printed ok for a severity style naming a non-colour token, which the loader refuses. Resolved: shared `colourTokenChecks` (UX-011), run by both under the same condition.
- G-M1, C-m1, C-m2 (minor): CLI io now treats only ENOENT as missing; ops scripts call a new `loadDeps` so configLoaded rows count server starts only; the audit-failure test now proves the failed start closed its handle.

Ruler rulings kept as stands: none. Controller rulings in force and respected: Task 6 (one pinned `config.conditionallyRequiredWithoutPosition` warning), Task 7 (only ENOENT reads as missing, in loader and CLI), Task 5 T5/quality:CV1 (CLI copy removed in Task 9), Task 7 progress-r2-1 (closed, no code change).

## Cross-cutting checks

1. A server start skipping configLoaded after the bootstrap split: `startServer` still calls `bootstrap`; only `scripts/ops/seed.ts` and `scripts/ops/grant-role.ts` call `loadDeps`.
2. A test or smoke check counting configLoaded rows from ops scripts: none outside startup.test.ts; boot-smoke.sh has no match.
3. Sensitive-paths coverage: no new files; startup.ts (critical) and `scripts/ops/**` (gate) are listed; load.ts stays ordinary.

## Answers to the controller's questions

None were posed for this re-review.

## Remaining Minors

Carried from the context excerpt for the follow-up issue: Task 9 unreadable-file reporting scope; config-migrate `main` exit(1) branch not reachable in tests (no migrations); raw line breaks in two template literals; the startup audit-failure path logs no "startup refused" line (main.ts writes the fatal line). The CLI io read-error mapping now has unit coverage through `configIo`.
