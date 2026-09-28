---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "f2859225555c6fa4c208a2981a8ce0dc14c0d779"
verdict: "approve"
mode: "fast"
---

# Review: feat/b-p1-wave-5

Date: 09-27-26

## Scope
Branch feat/b-p1-wave-5, range 1a6460664e24a78b3ef785be7b5d9612210c6cec..f2859225555c6fa4c208a2981a8ce0dc14c0d779. Wave B5 (plan Tasks 20 to 25): web-ui live announcer, TextField and focusFirstInvalid, theme and persona hooks; web composition root, bootstrap, MSW test kit, sign-in screen, routes with auth gate, home and connection status. Only gate path: apps/web/vitest.config.ts (reviewedLines 19, fast path).

## Findings summary
Critical 0, important 0, minor 1.
- Rulings kept as stands: controller carry 09-27-26 (replace P0 vitest config, widened include), T23 critic:C1 (production sourcemaps stay off), T20/IC1 and T23/IC1 (fileURLToPath under jsdom).
- No controller rulings needed.

## Cross-cutting checks
1. Root workspace: projects glob apps/*/vitest.config.ts picks web once; coverage thresholds unchanged. Web run: 10 files, 35 tests passed.
2. Widened include: all 10 matches under apps/web/src are tests; helpers in src/test do not match; the one Node-API test (version.test.ts) passes under jsdom.
3. Gate file dependency: vitest.config.ts now merges apps/web/vite.config.ts, which .github/sensitive-paths leaves ordinary (minor M1).

## Answers
1. mergeConfig brings in react plugin, __APP_VERSION__ define, html.cspNonce, build and server blocks. Proxy and server settings need a dev server that vitest does not start; cspNonce only touches index.html, which no test loads; define is required by version.test.ts. MSW with onUnhandledRequest "error" blocks any real network call. Tests are not weakened and need no running API.
2. Yes: picked up once, name "web", root coverage thresholds unchanged.
3. No non-test files and no jsdom-breaking Node-only tests.

## Remaining Minors
- M1: apps/web/vitest.config.ts inherits the ordinary-tier apps/web/vite.config.ts, so an ungated edit can change the test run. Add apps/*/vite.config.ts to the gate tier in a later gate PR, or accept.
