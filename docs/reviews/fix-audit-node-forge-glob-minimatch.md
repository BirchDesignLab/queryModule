---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "f7ee2c5a49cf9c247a75dd2e1be77d95f805fafa"
verdict: "approve"
mode: "fast"
---

# Review: fix/audit-node-forge-glob-minimatch

Date: 11-06-26.

## Scope

Branch fix/audit-node-forge-glob-minimatch, range 1657249683c96a41c79c62a7c3eee2ec9852f329..f7ee2c5a49cf9c247a75dd2e1be77d95f805fafa (one commit). Restores a green `pnpm audit --prod`: node-forge 1.4.0 to 1.4.3 in pnpm-lock.yaml, removes the GHSA-86w9-cpqp-85rv ignore, adds ignores for GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch) in pnpm-workspace.yaml.

## Findings summary

Critical 0, important 0, minor 1. No rulings or controller rulings apply.

## Cross-cutting checks

1. An ignore hiding a path outside mobile tooling: pnpm-lock.yaml consumers of glob 13.0.6 and minimatch 10.2.6 are only @expo/* packages and glob itself, and expo is an importer dependency of apps/mobile only. minimatch 5.1.9 (via @redocly/openapi-core) is below the advisory range.
2. Advisory facts and audit state: GitHub advisory data confirms each range and fix version in the comments. `corepack pnpm audit --prod` at head exits 0.
3. Avoidable ignore or broken range: newest @expo/cli 58.1.19 and @expo/fingerprint 0.21.9 still declare glob ^13 and minimatch ^10. node-forge 1.4.3 is the latest, fits ^1.4.0 for both consumers, and its lock integrity matches the registry. #492 is open.

## Answers to the controller's questions

1. Yes. The two ignores (pnpm-workspace.yaml:22-29) are single IDs with correct ranges, every affected path runs through apps/mobile > expo > @expo/*, and newest Expo packages still exclude the patched majors. Removing GHSA-86w9-cpqp-85rv is correct: its range is <=1.4.0, 1.4.3 is installed (pnpm-lock.yaml:3487), and audit stays green.

## Remaining Minors

- m1. Issue #492 title still names node-forge and not glob or minimatch (pnpm-workspace.yaml:24, :28). Retitle it and add the two IDs.
