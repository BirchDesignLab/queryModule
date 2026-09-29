---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "eb2571f35f360b7b0212fe8ad7c406527e062e37"
verdict: "approve"
mode: "fast"
---

# Review: feat/a-p3-wave-1

Date: 09-29-26. Fast path, one reviewer, 11 reviewed lines.

## Scope

Branch feat/a-p3-wave-1, range dda5c29..eb2571f (one commit, #338). The wave lists the request guards as gate tier in `.github/sensitive-paths`: `packages/api/src/http/security.ts` (X-Requested-With CSRF guard, security headers, body cap), `packages/api/src/http/web.ts` (CSP nonce header) and `packages/api/src/app.ts` (where that middleware is mounted), and pins all three as gate in `scripts/ci/sensitive-review.test.ts` (SEC-014 review coverage).

## Findings summary

- Critical: 0. Important: 0. Minor: 1.
- No ledger ruling contested. Checker ruling 09-29-26 (all three as gate, one comment line per entry) kept as stands and met.

## Cross-cutting checks

1. Other guards left ungated (#338 sweep): grep of `packages/api/src` for middleware definitions and mounts. Middleware exists only in `http/security.ts` and `http/session.ts` (already gate), mounted only in `app.ts` and `http/web.ts`. Nothing missing.
2. Shadowing or demotion of the new entries: read `tierOf`/`classifyOne` in `scripts/ci/sensitive-review.ts` against the shipped file. No critical, exempt or deps glob matches; each path resolves to gate. The pinned test passes at the head.

## Answers to the controller's questions

No controller questions.

## Remaining Minors

- m1 `.github/sensitive-paths:86-96`: the #338 entries split the "Auth and sessions" block, so `ws/**`, `seed/**`, `ops/**`, `deps.ts` and `events/**` now sit under the app.ts comment. Move the three entries after `events/**` or re-head the remaining lines. Tiering unaffected.
