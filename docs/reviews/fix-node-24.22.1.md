---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "2317c70da8a71aebdb0350a9ba05fd67e8c70758"
verdict: "approve"
mode: "fast"
---

# Review: fix/node-24.22.1

Date: 10-27-26.

## Scope
Branch fix/node-24.22.1, range 641427039a6c12212db151c1142712426f30ebd5..2317c70da8a71aebdb0350a9ba05fd67e8c70758 (one commit, #846). Delivers the Node 24.22.1 bump for Node2Shell (CVE-2026-111497): .nvmrc pinned to 24.22.1, engines floor >=24.22.1 <25, both Dockerfile stages on node:24.22.1-alpine by digest, scripts/ci/node-pins.test.ts to keep them in step, ADR-0001 amendment, and a narrow audit ignore for GHSA-mrhx-c7xc-m3w5 (zod 3 under @expo/cli only). Gate tier, fast path (39 reviewed lines).

## Findings summary
Critical 0, important 0, minor 2. No ruling ids in the context; no controller rulings.

## Cross-cutting checks
- CI uses the pin: every setup-node in ci.yml, promote.yml, project-sync.yml reads node-version-file .nvmrc. OK.
- New test runs in the gate: scripts/vitest.config.ts includes ci/**/*.test.ts, and the root config includes that project. Test run: 3 of 3 pass.
- Dependabot docker updates vs the exact pin: dependabot.yml watches /deploy weekly; tag bumps will fail node-pins until .nvmrc and engines move (minor M1).

## Answers
No controller questions.

## Remaining Minors
- M1 .github/dependabot.yml:35: Dependabot Docker tag bumps will be red by design until .nvmrc and engines follow; note this in ADR-0001 or the dependabot entry.
- M2 scripts/ci/node-pins.test.ts:17: name the 24.22.1 floor as a constant instead of inline 22/1.
