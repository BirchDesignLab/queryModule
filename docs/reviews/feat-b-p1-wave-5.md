---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "8ebd5d30bf178dc80bd3da75fcb1b2167415f11a"
verdict: "approve"
mode: "fast"
---

# Review: feat/b-p1-wave-5

Date: 09-27-26

## Scope
Branch feat/b-p1-wave-5, range 529bd2e4cbee0ec45fbd5492bfa293beff96ab98..8ebd5d30bf178dc80bd3da75fcb1b2167415f11a (merge head; origin/main 529bd2e merged in, so the diff is B5 only). Wave B5 (plan Tasks 20 to 25): web-ui live announcer, TextField and focusFirstInvalid, theme and persona hooks; web composition root, bootstrap, MSW test kit, sign-in screen, routes with auth gate, home and connection status. Only gate path: apps/web/vitest.config.ts (reviewedLines 19, fast path). Re-review at the merge head so reviewedSha matches the pushed head; the gate file is unchanged since the earlier approval at f285922.

## Findings summary
Critical 0, important 0, minor 1.
- Rulings kept as stands: controller carry 09-27-26 (replace P0 vitest config, widened include), T23 critic:C1 (production sourcemaps stay off), T20/IC1 and T23/IC1 (fileURLToPath under jsdom).
- Controller ruling (checker, B5 push, item 4): M1 goes to A3; no B5 change.

## Cross-cutting checks
1. Merged main vs the web project: root vitest.config.ts, biome.json and tsconfig files unchanged by the merge; ci.yml adds api guard steps only; sensitive-paths adds scripts/ci/check-schema-writes.ts. Nothing touches apps/web.
2. React bump from main: specifiers moved to ^19.2.8, but the lockfile still resolves apps/web and packages/web-ui to react 19.3.0 with react-dom 19.3.0. No version split.
3. Web project at head: vitest run --project web, 10 files, 35 tests passed; vitest list shows each file once under [web].

## Answers
1. The gate file still holds. It is byte-identical to f285922, and nothing main brought in (root projects and coverage, biome, ci.yml, react specifier) changes how it behaves.
2. mergeConfig brings in the react plugin, the __APP_VERSION__ define, html.cspNonce, build and server blocks. Proxy and server settings need a dev server that vitest does not start; cspNonce only touches index.html, which no test loads; define is required by version.test.ts. MSW with onUnhandledRequest "error" blocks any real network call. Tests are not weakened and need no running API.
3. Yes: the root glob apps/*/vitest.config.ts picks the web project once, name "web" unchanged.

## Remaining Minors
- M1: apps/web/vitest.config.ts inherits the ordinary-tier apps/web/vite.config.ts, so an ungated edit can change the test run. Owned by A3 (**/vite.config.ts into the gate tier).
