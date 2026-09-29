# Task 33 client half report (#358)

Implemented: debounced (150 ms) validateSiteConfig on every draft change in ConfigBuilder (useDraftChecks), diagnostics grouped by JSON pointer to the deepest existing control (draft.ts groupByControl), aria-invalid + aria-describedby message at each form control, section header issue count, polite summary region (data-testid draft-summary, no focus move), raw tab lists each diagnostic with its line (pointerLines, lineOf). Publish/history already disabled with focusable reason text from Task 31; kept and now tested by keyboard (shift+tab lands on reason).

Files: apps/web/src/admin/{ConfigBuilder.tsx, draft.ts, draft.test.ts, Diagnostics.test.tsx}, packages/config/locales/en.json (keys added: admin.config.issueCount, admin.config.shapeIssue, admin.config.raw.line).

TDD: RED `npx vitest run src/admin/Diagnostics.test.tsx src/admin/draft.test.ts` -> 5 failed (pointerLines not a function; missing draft-summary etc.), expected: no implementation. GREEN: 32/32 in src/admin.

Gates: pnpm lint clean; pnpm typecheck clean; pnpm coverage 203 files, 2713 passed 1 skipped; pnpm verify exit 0.

Self-review notes: seeded config already yields validation errors (conditionallyRequiredWithoutPosition), so tests compare against the baseline count. Diagnostics deduped by level/pointer/key/params. Plural key "issueCount.one" dropped: QueryForm.test unflattens en.json and breaks on prefix-colliding keys.
Concerns: (observation) seeded site config reports pre-existing errors in the browser check; Task 32/35 asserting "no errors" must account. Diagnostic keys (config.*) have no en.json text yet, so messages show the key; a follow-up could add texts.

## Fix round 1

- quality:Q1 (draft.ts pointerLines): rewritten with bounds; expect()/fail() throw on unterminated or malformed text (stray }, [,], missing colon, empty scalar); the existing catch returns an empty map. Tests: draft.test.ts "terminates with an empty map on ..." (6 cases). RED: unterminated array and stray } timed out at 5000 ms, [,] returned size 2. GREEN: draft.test.ts passes.
- quality:Q2 / critic:C1 / critic:CV2 (ConfigBuilder.tsx useDraftChecks): debounce doc and labels separately (stable references), memo deps [bundleState, settledDoc, settledLabels]. Test: ConfigBuilderIdle.test.tsx counts validateDraft calls across 1 s idle. RED: "expected 11 to be 5". GREEN: count stays constant.
- spec:S1 / critic:C2 (packages/config/locales/en.json): added en text for all 68 config.* keys core can emit (add only, params used as emitted). Tests: Diagnostics.test.tsx now asserts the text /Unknown query type "ZZZ"/ (RED before the keys existed); draft.test.ts scans packages/core/src/config for config.* keys and asserts each has en text.
- Commands: pnpm exec vitest run src/admin (apps/web): 5 files, 40 passed. pnpm lint clean; pnpm typecheck clean; pnpm coverage 204 files, 2721 passed, 1 skipped; pnpm verify passed (generated files match).
