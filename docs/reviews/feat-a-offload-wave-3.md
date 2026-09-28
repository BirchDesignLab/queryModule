---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "f0cd433dfb838a3399f07e8fb1653204699b4ef8"
verdict: "approve"
---

# Review: feat/a-offload-wave-3

Date: 09-28-26. Gate slice.

## Scope

Branch feat/a-offload-wave-3, range 4daab787986aba1203ee09daef03c8855ed38a1c..f0cd433dfb838a3399f07e8fb1653204699b4ef8. The wave delivers #217 (ops: grantRole no-op contract with injected clock, lost-key guard check inside the canary transaction and busy-checkpoint refusal, backup outDir guard for "..x" children, check-triggers open failure inside try), #74 (verify-gate CLI tidy-ups: strict config:validate args, forward-slash paths, clean read and parse errors, invalid-JSON locale and mock diagnostics, repo-bound stories.json paths, string-aware comment stripping) and the M2 fail-closed main guard (isMainModule in cli-io.ts).

## Findings summary

- Critical: 0. Important: 0. Minor: 3.
- Ledger rulings kept as stands: #217 developer rulings (no-op contract, guard in transaction, G-m1, G-m2); #74 ruler S1 (trailing // tag no longer counts); M2 developer ruling (only the three new guards use isMainModule, others in #220).
- No controller rulings needed.

## Cross-cutting checks

1. Gate CLIs invoked so isMainModule is false: package.json and ci.yml run all of them via tsx with the script as argv[1]; spawn tests cover the same invocation. No fail-open.
2. grantRole callers bypassing audit after the signature change: only the test file and a comment reference it. None.
3. strip-comments mis-scan: probed hasTaggedTest and isPureBarrel. Barrel gate holds; tag gate has one contrived fail-open shape (Minor 1).

## Answers to the controller's questions

1. Every no-op (grant of held role, revoke from a user-role user) returns before any write or audit; grant of "user" throws first; every real change updates and writes exactly one roleChanged row in the same transaction. No role change without a roleChanged row (SEC-010).
2. No changed CLI exits 0 without its check: isMainModule is realpath-resolved and case-insensitive on win32; unknown -- flags exit 2; read and parse failures print path and short reason only; zod output is one line. Unexpected fs errors still exit non-zero.
3. isPureBarrel cannot be fooled: code before any regex literal survives and fails the re-export match. hasTaggedTest can count a block-commented tag only when a quote in a regex literal or template hole precedes a /* opener on the same line; deferred in #220.

## Remaining Minors

1. strip-comments.ts: a stray quote (regex literal or template hole) hides a same-line /* opener, so a following block-commented tagged test counts. Deferred in #220 (strip-comments regex literal); add this case as its test.
2. config-migrate.ts: no spawn-level test that main() runs through isMainModule.
3. config-migrate.test.ts duplicates cli-io.test.ts through re-exports.
