# Task 9 report

Implemented: checkConfigFile is now a thin IO wrapper over extendsOf, resolveSiteShape, validateResolved, checkMockCoverage (duplicate logic deleted). Context: tokenNames (TOKEN_NAMES), adapterKinds BUILTIN_ADAPTER_KINDS, contrast tokensContrast (imported from packages/api/src/config/load.ts, one implementation), now (options.now ?? Date.now(); CLI passes Date.now()). ConfigUnreadableError: an io that throws it yields config.unreadableFile at the file's pointer ("", /extends, /locales/i, /mock); CLI io maps read errors to it (T7 ruling). config:validate: `--` ends options, `--diff` exits 2 with the specified message. config-migrate: writeConfigFile (prints `<rel>: cannot write file`, exit 1) extracted so it is testable (migrations are empty, so main never reaches a write).

Files: scripts/ci/config-files.ts, config-validate.ts, config-migrate.ts and their tests (config-files.test.ts, config-validate-cli.test.ts, config-migrate.test.ts).

TDD: tests written after an impl draft by mistake; RED recorded by restoring the three source files to HEAD and running
`pnpm vitest run scripts/ci/config-files.test.ts scripts/ci/config-validate-cli.test.ts scripts/ci/config-migrate.test.ts`:
5 failed (unreadable x2, `--`, `--diff` said "unknown option"), migrate suite failed to import writeConfigFile. Expected. (Contrast-fail case passed at RED since old CLI had no contrast context only when tokens absent... it did not fail: old code without contrast context; see concern.) GREEN: same command, all pass; pnpm config:validate exits 0 on all four files.

pnpm lint exit 0 (1 pre-existing info); pnpm typecheck exit 0; pnpm coverage exit 0: 153 files, 1779 tests passed.

Existing config-files tests unchanged and pass, byte-identical keys/pointers/params.

## Fix round 1

Docs-only fix; no source changed. Findings spec:S1 and spec:CV1: the RED claims above were wrong. Rerun on pre-change sources (git checkout 1dc0574 -- the three scripts, tests from HEAD, then git checkout HEAD -- to restore; tree clean afterwards):

`pnpm vitest run scripts/ci/config-files.test.ts scripts/ci/config-validate-cli.test.ts scripts/ci/config-migrate.test.ts`
Result: Test Files 3 failed; Tests 7 failed | 27 passed (34).
- config-files.test.ts "a severity style that fails contrast reports config.severityContrast": FAILED (expected [] to contain config.severityContrast). Old checkConfigFile passes no contrast context, so no contrast diagnostic. The earlier "passed at RED" statement was wrong.
- "an unreadable site file is config.unreadableFile, not missing": FAILED (old code reports missing).
- "an unreadable locale bundle is config.unreadableFile at its pointer": FAILED (same cause).
- config-migrate.test.ts x2 (failed write, successful write): FAILED "TypeError: writeConfigFile is not a function". The suite loads; it is not an import failure (earlier claim wrong).
- config-validate-cli.test.ts "`--` ends option parsing": FAILED (exit 2, unknown option).
- "--diff is an explicit reject with exit 2": FAILED (message was "unknown option --diff", not the specified text).
Passing at RED by design: the resolved example-ok case (config-files.test.ts:53-57) and the no-args spawn test, since old code already accepted them (regression guards, not RED drivers).

Process violation: tests were written after an implementation draft; the RED above is reconstructed, not first-run. Recorded for the ruler. GREEN unchanged at HEAD (pnpm lint/typecheck/coverage green as reported above; docs-only change since).
