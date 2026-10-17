---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "eb69a901a758a9d56bfdcf24ef918e06f6824bf2"
verdict: "approve"
---

# Review: fix/m2-debt-2-backend

Date: 10-17-26

## Scope

- Branch: `fix/m2-debt-2-backend`.
- Range: 3534de160133c7d831f88f6b8b7e1991ad39e6a4..eb69a901a758a9d56bfdcf24ef918e06f6824bf2.
- Review shape: tier slices (ADR-0007 as amended by #92). The gate slice ran first (Opus 5.5 medium, approve, 0 critical, 0 important) and the critical slice last (Opus 5.5 high). This is a fresh review after a prior approve at c59b7b9 whose two minors were fixed in eb69a90.
- Critical slice: `packages/api/src/config/load.ts`, `packages/api/src/dispatch/event-log.ts`, `packages/api/src/dispatch/outcome.ts`, `packages/api/src/queries/policy.ts`, `packages/api/src/queries/read.ts`, `packages/api/src/queries/route.ts`, `packages/api/src/startup.ts`, `packages/core/contracts/ws-events.schema.json`, `packages/core/src/contracts/ws.ts`, `packages/core/src/planner/index.ts`, `packages/core/src/planner/plan.test.ts`, `packages/core/src/planner/plan.ts`.

What the PR delivers (M2 DEBT-2, backend lane; mock data only):
- #574: no second fatal for a submit whose T1 commits after a fatal (C-C-m3); the SIGTERM drain calls `abortAll` past its bound, and a T2 cut off by the drain's DB close warns instead of failing closed (closeDb); the Better Auth setup refuses a password minimum below 12 (AW5 C-C-m1); WS upgrade default defined once, one config:validate line for an unreadable mock dir, spec drain line (gate items).
- #623: one part mapper and one purged rule shared by the detail read and the list, Map lookups, SEC-014 owner-only comments retagged to spec sections.
- #644: the config loader uses the tokens package's `tokensContrast`; `typeValuesOf` exported from the planner for the builder previews.
- #650: a known WS message with an unknown enum value is kept as "unknown" on client receipt (ADR-0013 amendment); the server stays strict; the heartbeat probe now receives tolerantly too.
- #656: fixture policy counts any Unicode numeral (`\p{N}`) and any letter breaks a digit run; docs match.

## Findings summary

- Critical: 0. Important: 0. No fix pass was needed.
- Minor: critical slice 4 (C-m1 to C-m4), gate slice 1 (G-M1), all open for a follow-up.
- Prior minors from the c59b7b9 review: both fixed in eb69a90 and confirmed (see Answers 1).
- Rulings kept as they stand: #574 C-C-m3; #574 closeDb (Manager 7, 10-17-26) parts (a) and (b) with the required sweep test; #574 AW5 C-C-m1 (Manager 7, 10-17-26); #574 G-G-m1, G-G-m2, G-G-m3; #623 Q1 and Q4; #644; #650 (developer ruling 10-14-26, ADR-0013 amendment); #656 (Manager 7, 10-17-26).
- Controller rulings: none were needed in this run.

## Cross-cutting checks

1. Risk: the drain's `abortAll` writes rows or starts a T2. `abortAll` (dispatcher.ts:277-289) drops queued jobs without a report and marks running jobs done before aborting them; a later settlement returns at dispatcher.ts:162-163, and `report()` (dispatcher.ts:118) is the only path to `onOutcome`. No row, no T2. Pinned by dispatcher.test.ts:517 and :532.
2. Risk: the route's new `failed` branch could hide a refusal that should fail closed. `fatal` sets `lifecycle.failed` before it aborts dispatch (deps.ts:186-187), as does the fatal close (startup.ts:287-288); the drain's `abortAll` runs with `draining` set and `failed` clear. A refusal with neither flag still throws `DispatchRefusedError` into the fail-closed backstop (route.ts:173).
3. Risk: moving `tokensContrast` to the tokens package (#644) drops the hex-only guard. The tokens copy keeps the identical hex-only `value` and filters `failures` overrides through `hexOnly`, which is stricter; the loader still rejects a non-#rrggbb override first (load.ts:81-88). No new trust boundary: the loader already imported the tokens contrast functions.
4. Gate slice (from its report): the WS upgrade rate-limit default now lives in `packages/api/src/env.ts`, which is ordinary tier (G-M1).

Tests run at the head (Windows): api queries, dispatch and lifecycle suites, 199 passed (2 process-level files skipped by their gate); drain.test.ts all 13 pass; client heartbeat and feed 73 passed; core fixture-policy and planner 141 passed.

## Answers to the controller's questions

1. Both fixes are correct and complete. The FIXTURE_LEAF_KEYS doc (fixture-policy.ts:26-29) and docs/site-config.md now match the code: hasDigitRun (fixture-policy.ts:158) keeps only `\p{L}\p{N}` after NFKC and tests `\p{N}{4,}`, so a letter breaks a run; freeText (fixture-policy.ts:185) rejects any `\p{N}`. The heartbeat probe (heartbeat-probe.ts:70-80) parses through `parseServerMessage`: a non-string frame, invalid JSON or a typeless JSON value fails as protocol; an unknown type is skipped; an unknown status or reason reads as "unknown" and is ignored; a known type that breaks its schema reports `onInvalid` and fails as protocol. Pinned by heartbeat-probe.test.ts:85 and :106.
2. Yes. The warn path needs all three of `draining`, `!failed` and `db.$client.closed` (outcome.ts:181); any other T2 failure logs and calls `d.fatal` (outcome.ts:188-189), and a T2 failing with the DB still open during the drain stays fail closed (drain.test.ts:372). The cut-off row stays pending and the next start's sweep settles it interrupted, with audit (drain.test.ts:317). `abortAll` in the drain (startup.ts:230) writes no rows and starts no T2 (cross-cutting check 1). Residual accepted by the ruling: a genuine T2 fault whose rollback overlaps closeDb also warns, and its row is still swept with audit.

## Remaining Minors

- C-m1 `packages/api/src/config/load.ts:48-52`: two stacked JSDoc blocks; the one-liner at :48 documents nothing. Merge into one block; "colour" at :93 can be fixed as touched.
- C-m2 `packages/api/src/startup.ts:181-192`: the `createDrainStop` doc omits the `abortAll` step; `dispatcher.ts:73` and `:162` still describe abortAll as fatal-path only. Doc drift.
- C-m3 `packages/client/src/heartbeat/heartbeat-probe.ts:70-79`: no test for a non-string frame or a typeless JSON object; behavior is right by inspection.
- C-m4 `packages/core/src/config/fixture-policy.ts:24-29`: one overlong line, and "normalised" and "licence" remain in the touched block.
- G-M1 `packages/api/src/env.ts:33` (gate slice, plan-mandated by #574 G-G-m1): the WS upgrade rate-limit default sits in an ordinary-tier file. Add env.ts to the gate tier or pin 60/60000 with a gate-tier test.
