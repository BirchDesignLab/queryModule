---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "ba438461561d0ceb7b4980cb062e28383a1d064f"
verdict: "approve"
mode: "fast"
---

# Review: fix/restore-test-secret-mounts

Date: 09-28-26

## Scope
Branch fix/restore-test-secret-mounts, range 8aad12a75fb5c4c177c85312655b349d55c90e0e..ba438461561d0ceb7b4980cb062e28383a1d064f (one commit, gate tier, 42 lines). Refs #135. The restore test (scripts/ops/restore-test.sh) now bind-mounts each of the five `app` secrets from deploy/compose.yml (DB_ENCRYPTION_KEY, CREDENTIAL_KEY, DATA_KEY, BETTER_AUTH_SECRET, SEED_PASSWORD_SECRET) read-only into /run/secrets, instead of the whole root-mode-700 secrets directory that uid 10001 could not enter. TUNNEL_TOKEN is not mounted. scripts/ops/restore-test.test.ts asserts that exact per-file set, read from compose, and no directory mount.

## Findings summary
Critical 0, important 0, minor 1. Rulings kept as stands: scope is only the mount change; T32 G-M1 stays on #237 for M1 P2; mount set matches compose `app` secrets. No controller rulings.

## Cross-cutting checks
- deploy/compose.yml, risk of mount set diverging from production: same five names for `app`; TUNNEL_TOKEN only on cloudflared. Match.
- packages/api/src/secrets.ts, risk of a missing required secret or a broken optional one: app reads exactly the five; SEED_PASSWORD_SECRET is optional (ENOENT only). Led to the minor below.

## Answers to the controller's questions
No controller questions. Context-excerpt questions: five mounts suffice; a missing SEED_PASSWORD_SECRET does not break `docker run` but creates a root-owned directory at the source and the app fails closed (see minor). The test fails against the old directory mount and against a missing or extra secret.

## Remaining Minors
- scripts/ops/restore-test.sh:31: `-v` creates a root-owned directory for a missing source file; with optional SEED_PASSWORD_SECRET absent the app fails closed on EISDIR and a stray directory is left in the secrets dir. Use `--mount type=bind,...,readonly` or skip absent files. Compose already requires the file on the deploy host.
