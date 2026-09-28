---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "407214e3dc5411dff54ae5797c553fb12740aa35"
verdict: "approve"
---

# Review: feat/b-p1-wave-8

Date: 09-28-26. Gate slice.

## Scope

Branch feat/b-p1-wave-8, range f4fbeda4d7bade87e847e394608f6ecbc7286a68..407214e3dc5411dff54ae5797c553fb12740aa35. First pass: workflow run wf_4da9d9ef-db5 over f4fbeda..5beea41 (Task 28 #131 deploy-pull and compose, Task 33 #136 smoke and WS soak). This re-review covers the fix commit 407214e (`git diff 09dde88 407214e`); 09dde88 merges origin/main e83c340 (#226, board data and SVGs, ordinary). Gate files: scripts/ops/deploy-pull.sh, scripts/ops/smoke.sh, scripts/ops/ws-soak.ts. Also read: the new scripts/ops/deploy-pull.test.ts and smoke.test.ts, docs/deploy.md, deploy/compose.yml, deploy/.env.example, deploy/systemd/deploy-pull.service, plan derivePassword (plan line 4062) and the runtime Dockerfile outline (plan 4375-4389).

## Findings summary

- First pass: Critical 0, Important 3, Minor 5.
- I1 (deploy-pull never applies): fixed. deploy-pull.sh:12-16 compares `docker image inspect -f {{.Id}}` of the tag from `docker compose config --images app` with `docker inspect -f {{.Image}}` of the running container; both are image IDs in the same `sha256:` form, and a missing container yields `have=""`, which applies. ADR-0002 and spec 8.3 govern over the plan code (ruler).
- I2 (secrets on argv): fixed. The password is derived by `node -e` reading the secret file itself (argv holds only the path and the email); the body reaches curl on stdin from the `printf` builtin (`--data-binary @-`); the cookie reaches ws-soak.ts through `QM_COOKIE` (environment only, readable by the same uid). Nothing secret remains on any process argv.
- I3 (`sudo cat` under the timer): fixed. With no `SEED_PASSWORD_SECRET_FILE`, smoke.sh derives inside the app container (`docker compose -f <repo>/deploy/compose.yml exec -T app node -e ...` over /run/secrets); the image runs as uid 10001, the secret's owner. `-f` makes the project directory deploy/ and the project name is fixed (`name: querymodule`), so it resolves the same container from the timer and from any cwd. deploy/.env.example does not set `SEED_PASSWORD_SECRET_FILE`, so the EnvironmentFile cannot divert the timer to the host-file branch.
- M1: fixed. `if timeout ... && bash smoke.sh; then ... else echo FAILED; exit 1; fi` keeps errexit off only in the condition; smoke.sh runs in its own bash with its own `set -e`, so any step failure lands in the else branch and logs.
- M2: fixed. `: "${PUBLIC_ORIGIN:?}"` runs before the pull.
- M3: fixed. Bodies are captured, then grepped from a here-string.
- M4: fixed by documentation (docs/deploy.md and the smoke.sh header name Node 24 and a root `pnpm install`).
- M5: fixed in both smoke.sh (`${base%/}`) and ws-soak.ts.
- New: 0 Critical, 0 Important, 3 Minor (below).

## Cross-cutting checks

1. `node -e` argv: with `-e`, `process.argv` is `[execPath, ...args]`, so argv[1] is the file path and argv[2] the email. Correct.
2. Derivation: HMAC-SHA256 keyed by the trimmed secret over the lowercase email, `digest("base64url")`: unpadded, url alphabet, 43 chars; matches derivePassword (plan 4062) with readSecretFile's trim. smoke.test.ts checks the body against an independent HMAC with a newline-terminated secret file (trim covered).
3. Tests: deploy-pull.test.ts "applies ... (G-I1)" and "no container" fail against the old `compose images` comparison; smoke.test.ts "QM_COOKIE" fails against the old ws-soak (argv cookie would be taken, not exit 2). Both files pass locally at 407214e (7 tests).
4. Gate-file regressions: none. The `here=` resolution works for the systemd ExecStart (absolute path) and for the relative invocations in docs/deploy.md.

## Answers

1. The derivation matches derivePassword (43 chars, base64url, no padding, lowercase email, trimmed key). Nothing prints or logs the secret, password or cookie, and none of them sits on argv any more; the secret never leaves the container on the deploy host.
2. ws-soak.ts is unchanged apart from the cookie source and trailing-slash strip: stale-nonce pongs ignored, fail at two consecutive misses, early close fails, zero pongs exits 1; no cookie exits 2.
3. A failed health wait or smoke now logs `deploy-pull: FAILED app -> <id>` and exits 1; the new image stays running and the next run reports no change (rollback stays a manual promote, ADR-0002). `$PUBLIC_ORIGIN` comes from the EnvironmentFile and is checked before the pull. The apply path is now reached when the tag moves.

## Remaining Minors

1. smoke.test.ts: the login test would also pass against the old openssl pipeline; neither argv freedom nor the `docker compose exec` branch (G-I3) is exercised. Host verification in B9 and the Linux host step covers the exec branch; consider a stubbed `docker` case.
2. deploy-pull.test.ts "refuses to run without PUBLIC_ORIGIN" would also pass against the old script, which failed earlier at `cd ~/git/queryModule/deploy` on the test machine.
3. deploy-pull.sh: a failure before the apply (pull, `config --images`, image inspect) still exits under `set -e` without a `deploy-pull:` line (journal only). Confirm on the host that `docker compose config --images app` filters to the one service in the installed Compose version; if it prints both images, the inspect fails there. smoke.sh run off-host without `SEED_PASSWORD_SECRET_FILE` fails at the docker step (no secret exposed); docs/deploy.md could say that off-host runs need the variable.
