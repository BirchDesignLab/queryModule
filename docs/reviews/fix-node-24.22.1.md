---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "c36ee9a286953d79d2f1ae60b4b3843f82c7ac28"
verdict: "approve"
mode: "fast"
---

# Review: fix/node-24.22.1

Date: 10-27-26.

## Scope
Branch fix/node-24.22.1, range 641427039a6c12212db151c1142712426f30ebd5..c36ee9a286953d79d2f1ae60b4b3843f82c7ac28 (#846). Delivers the Node 24.22.1 bump for Node2Shell (CVE-2026-111497): .nvmrc pinned to 24.22.1, engines floor >=24.22.1 <25, both Dockerfile stages on node:24.22.1-alpine by digest, scripts/ci/node-pins.test.ts to keep them in step, ADR-0001 amendment, audit ignores for GHSA-mrhx-c7xc-m3w5 (zod 3 under @expo/cli) and GHSA-gcqx-w48m-w2h4 (deepmerge under @expo/config), and a lockfile-only undici 8.12.3 bump under jsdom. Gate tier, fast path (43 reviewed lines). Re-review after the round-1 artifact at 2317c70.

## Findings summary
Critical 0, important 0, minor 3. No ruling ids in the context; no controller rulings. Developer decision 10-27-26 (deepmerge ignore) kept as stands.

## Cross-cutting checks
- deepmerge ignore scope: in pnpm-lock.yaml only @expo/config depends on deepmerge 4.3.1. Mobile-only claim holds.
- undici bump: single undici 8.12.3, satisfies jsdom ^8.11.2, engines >=22.19.0. OK.
- Local Node matches the pin (v24.22.1); context records full pnpm verify green at c36ee9a.

## Answers
No controller questions.

## Remaining Minors
- M1 .github/dependabot.yml: Docker tag bumps go red on node-pins until .nvmrc and engines follow; note it in ADR-0001.
- M2 scripts/ci/node-pins.test.ts:19: name the 24.22.1 floor as a constant.
- M3 this artifact replaces the round-1 one (2317c70) and must be committed before push.
