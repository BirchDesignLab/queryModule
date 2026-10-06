---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "dcab06603fc760421bf2f769b5a1579641e86af3"
verdict: "approve"
---

# Review: feat/m2-a-p05-wave-4 (10-06-26)

## Scope

Branch feat/m2-a-p05-wave-4, range 092e9510d2693d9bebeec09f4cc1974701259374..dcab06603fc760421bf2f769b5a1579641e86af3. M2 P0.5 Track A wave 4: AW3 review minors (C-C-m1 T1 parses the 202 body before commit, C-C-m2 dispatcher timer clamp, C-C-m3 doc reflow, G-G-m1), WS upgrade limit and window from env, Task 11 #538 startup sweep, Task 12 #539 welcome.latestSeq from event_log, Task 13 #540 SIGTERM drain with 503 and bounded dispatch wait, and AW4 critic fixes (844d92a, 02d0c3b, a102439, 2a6e280, d5187ec). Gate slice first (approve, 0 open critical or important), critical slice last (this artifact's reviewer).

## Findings summary

Critical slice: 0 critical, 0 important, 3 minor. Gate slice: 0 open critical or important.

Rulings kept as they stand: RFC 6455 1011 stays server-local in WS_LOCAL_CLOSE; main.ts fail() calls RunningServer.close(), stop() is the drain; dispatcher timers clamped to MAX_TIMER_MS; WS upgrade limit from env; kill.test re-dispatch visibility, tsx-spawned lifecycle tests and the 35 s sleep accepted; closeDb under a hung T2 at the drain bound is an AW5 follow-up; Windows load flakes (#560) are not regressions; earlier AW3 rulings stand.

Carry before merge: confirm in the Linux CI log for the pushed head that kill.test.ts and drain-process.test.ts ran and passed (skipIf(win32)).

## Cross-cutting checks

1. 503 placed after admitSubmit: admission.ts writes nothing in admitSubmit, and replayResponse parses its own body, so dropping the route-level parse loses no validation. Clean.
2. Sweep against the write-once trigger (drizzle 0004) and the frozen interrupted audit contract (core contracts audit.ts): the update and the audit row both fit. Clean.
3. refuse() logging the caught error: errorFields with no fixed-text list gives name and driver or system code only, never the message. Clean.

## Answers to the controller's questions

No controller questions. Manager addition on spec :1362 (20 s) vs docs/deploy.md (18 s): add a PR-body note in this PR and fix the spec line in the next ordinary doc PR; the deploy doc is the tighter, operative statement, and 20 s would still give a 27 s worst case inside the 30 s grace.

## Remaining Minors

- C-m1: route.ts:126 is 127 columns and main.ts:25 has a ragged short line after the C-C-m3 reflow; reflow in a later doc pass.
- C-m2: spec :1362 says 20 s, docs/deploy.md:7 and startup.ts:149 say 18 s; PR-body note now, spec fix next ordinary PR.
- C-m3: route.ts:160, after a non-drain fatal a submit past the 503 check whose enqueue is refused calls d.fatal again and main.ts exits at once, skipping the explicit DB close; data-safe. Treat lifecycle.failed like draining there.
