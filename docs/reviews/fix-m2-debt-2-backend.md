---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f23d11392f780745b6eb25da1b45b0abcdc157cd"
verdict: "approve"
---

# Review: fix/m2-debt-2-backend

Date: 10-17-26

## Scope

- Branch: `fix/m2-debt-2-backend`.
- Range: 3534de160133c7d831f88f6b8b7e1991ad39e6a4..f23d11392f780745b6eb25da1b45b0abcdc157cd.
- Review shape: tier slices (ADR-0007 as amended by #92). The gate slice ran first (Opus 5.5 medium, approve, 0 critical, 0 important) and the critical slice last (Opus 5.5 high). This is a fresh review after a prior approve at eb69a90 whose five minors were fixed in a735014 and f23d113.
- Critical slice: `packages/api/src/config/load.ts`, `packages/api/src/dispatch/dispatcher.ts`, `packages/api/src/dispatch/event-log.ts`, `packages/api/src/dispatch/outcome.ts`, `packages/api/src/queries/policy.ts`, `packages/api/src/queries/read.ts`, `packages/api/src/queries/route.ts`, `packages/api/src/startup.ts`, `packages/core/contracts/ws-events.schema.json`, `packages/core/src/contracts/ws.ts`, `packages/core/src/planner/index.ts`, `packages/core/src/planner/plan.test.ts`, `packages/core/src/planner/plan.ts`.

What the PR delivers (M2 DEBT-2, backend lane; mock data only):
- #574: no second fatal for a submit whose T1 commits after a fatal (C-C-m3); the SIGTERM drain calls `abortAll` past its bound, and a T2 cut off by the drain's DB close warns instead of failing closed (closeDb); the Better Auth setup refuses a password minimum below 12 (AW5 C-C-m1); WS upgrade default defined once, now in the gate-tier `packages/api/src/ws/limits.ts`; one config:validate line for an unreadable mock dir; spec drain line.
- #623: one part mapper and one purged rule shared by the detail read and the list, Map lookups, SEC-014 owner-only comments retagged to spec sections.
- #644: the config loader uses the tokens package's `tokensContrast`; `typeValuesOf` exported from the planner for the builder previews.
- #650: a known WS message with an unknown enum value is kept as "unknown" on client receipt (ADR-0013 amendment); the server stays strict; the heartbeat probe receives tolerantly too.
- #656: fixture policy counts any Unicode numeral (`\p{N}`) and any letter breaks a digit run; docs match.

## Findings summary

- Critical: 0. Important: 0. No fix pass was needed.
- Minor: critical slice 2 (C-m1, C-m2), open for a follow-up. Gate slice: see its report.
- Prior minors from the eb69a90 review (G-M1, C-C-m1 to C-C-m4): all fixed and confirmed (see Answers 1).
- Rulings kept as they stand: #574 C-C-m3; #574 closeDb (Manager 7, 10-17-26) parts (a) and (b) with the required sweep test; #574 AW5 C-C-m1 (Manager 7, 10-17-26); #574 G-G-m1, G-G-m2, G-G-m3; #623 Q1 and Q4; #644; #650 (developer ruling 10-14-26, ADR-0013 amendment); #656 (Manager 7, 10-17-26).
- Controller rulings: none were needed in this run.

## Cross-cutting checks

1. Risk: the new `packages/api/src/ws/limits.ts` sits outside any tier, so G-M1 is not closed. `.github/sensitive-paths:95` (`packages/api/src/ws/**`, gate) covers it.
2. Risk: moving the default breaks the deploy-env fallback or adds an import cycle. `env.ts:3` imports the leaf and `env.ts:107-111` falls back to it; `ws/server.ts:21` re-exports from `./limits`; `limits.ts` imports nothing. Pinned by `packages/api/test/ws/limits.test.ts` (60/60000, re-export identity, fallback with both vars unset).
3. Risk: the new heartbeat-probe test passes for the wrong reason. `heartbeat-probe.ts:70` fails a non-string frame; a typeless object parses to null and `isTypedMessage` is false, so both reach `finish(protocol)`. The test at `heartbeat-probe.test.ts:113` drives `onmessage` directly for the binary case.

Tests run at the head (Windows): api ws, dispatch, lifecycle and queries suites, 216 passed (2 process-level files skipped by their gate); client heartbeat 8 passed; `tsc -b` for packages/api clean; `biome check` on the f23d113 files clean.

## Answers to the controller's questions

1. All five fixes are correct and complete.
   - G-M1: the D-A9 default lives in `packages/api/src/ws/limits.ts:8`, gate tier; `env.ts:3` and `ws/server.ts:21` import it and env.ts no longer defines it; `packages/api/test/ws/limits.test.ts` pins the value, the re-export and the env fallback.
   - C-C-m1: one JSDoc block at `load.ts:48-52` documents both re-exports at `:53`; "color" in the touched docs. Identifiers `colourTokenChecks` and `config.notColourToken` keep their spelling (CLAUDE.md Language).
   - C-C-m2: `startup.ts:187-188` names the abortAll step (no row, no T2, rows pending for the sweep); `dispatcher.ts:73-76` and `:165` say abortAll runs on the fatal path and the drain past its bound.
   - C-C-m3: `heartbeat-probe.test.ts:113-122` fails a binary frame and a typeless object as protocol, through the intended branches.
   - C-C-m4: `fixture-policy.ts:24-30` rewrapped within 100 columns with "normalized" and "license"; doc still matches the code.

## Remaining Minors

- C-m1 `packages/api/src/startup.ts:189`: the C-C-m2 rewrap left one 107-character doc line (lineWidth 100). Rewrap it.
- C-m2 `packages/api/src/dispatch/dispatcher.ts:167`: "honouring" remains in a comment of a touched file. Change to "honoring".
