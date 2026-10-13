---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "7663d7939f4c9e83e70a6ee22c8cdcbf221989b6"
verdict: "approve"
mode: "fast"
---

# Review: fix/m2-a-p1-minors-2

Date: 10-13-26

## Scope
Branch fix/m2-a-p1-minors-2, range 0ea7fa030d6989da916797ead5ab6d5fcce893b6..7663d7939f4c9e83e70a6ee22c8cdcbf221989b6. Delivers: gen:check also regenerates and compares the client API types (root client:gen, GENERATOR_SCRIPTS contracts:gen, tokens:gen, client:gen; #623); tighter smoke step 4 assertions (#620); ws replay tests with shared helpers, no fixed sleeps and a gate test that catches a missing owner filter; spec 10.4 test path and plan wording fixes. Gate slice 44 lines (package.json, scripts/ci/check-generated.ts, scripts/ci/generated.ts, scripts/ci/check-generated.test.ts, scripts/ops/smoke.test.ts); no critical path touched.

## Findings summary
Critical 0, Important 0, Minor 2. No ledger rulings or controller rulings needed. Windows load flake ruling kept as stands.

## Cross-cutting checks
1. .github/workflows/ci.yml:137-166: gen:check runs in the test job after pnpm install --frozen-lockfile; client devDependencies openapi-typescript and tsx are installed. Fine.
2. packages/client/src/api/render-api-types.ts:8: reads the local openapi.json by file URL, no external refs, LF output under .gitattributes. Fine.
3. scripts/ci/changed-paths.mjs: a change only to packages/client/src/api/generated/* is neither docs_only nor board_only, so the test job runs. Fine.

## Answers to the controller's questions
1. Yes. gen:check is the test job's "Generated files match" step (ci.yml:164-166, not the checks job), after the frozen install (ci.yml:154). Client gen:api needs only installed devDependencies and the local openapi.json, no network. A client-generated-only change keeps docs_only and board_only false (changed-paths.mjs:10-20, 33-35), so the job runs.
2. Yes. Client types derive from openapi.json, which contracts:gen writes, so client:gen runs after it (generated.ts:14); tokens:gen is independent.

## Remaining Minors
- scripts/ci/check-generated.test.ts:69-70: template literal spans a raw newline; use `\n` as at lines 32-33.
- scripts/ci/check-generated.test.ts:66-76: the stale-client drift test duplicates the generic drift test; the membership test at 58-60 is the real guard.
