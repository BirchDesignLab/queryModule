## 8 Deployment

### 8.1 Image

One image serves every site. A multi-stage Dockerfile runs `pnpm install --frozen-lockfile`, builds `packages/core`, `packages/tokens`, `packages/client`, `packages/web-ui`, `packages/api`, `apps/web` (Vite) and `scripts/ops` (compiled to JS), then copies the API bundle, production `node_modules`, the web build and the compiled ops scripts into a runtime stage `node:<lts>-alpine`, pinned by digest to the same major as `.nvmrc`. `apps/mobile` and `packages/rn-ui` are not in the image. The process runs as a non-root user (uid 10001) that can write only `/data`. The Docker healthcheck calls `GET /api/v1/health`. The process serves nothing until migrations are applied, both `audit_event` triggers are present (5.5), the credential canary decrypts (5.7) and the site config validates (5.8); any failure exits non-zero (fail closed).

Nothing site-specific is baked in. Read-only mounts supply it: `/config` holds `sites/`, `locales/` and `mock/<siteId>.json` (`SITE_CONFIG` names the site file), and `ADAPTER_DIR=/adapters` holds server-side adapters (5.4, 5.8, 7). A new site is a new volume, never a new image.

### 8.2 Secrets and the data volume

Secrets are Docker secret files under `/run/secrets/`. Environment variables name file paths only. No secret is in the image, in `.env`, or on `/data`.

| Secret file | Use |
|---|---|
| `DB_KEY` | libSQL `encryptionKey`; whole-database encryption (5.5) |
| `CREDENTIAL_KEY` | State-credential envelope (5.7); the request-DEK wrapping key is derived from it (5.5) |
| `BETTER_AUTH_SECRET` | Session signing (5.6) |
| `SEED_PASSWORD_SECRET` | Demo password derivation (8.5) |
| `TUNNEL_TOKEN` | cloudflared only; the app never mounts it |

Non-secret deploy config lives in `deploy/.env` (template `deploy/.env.example`, committed; `.env` is not): `PUBLIC_ORIGIN`, `SITE_CONFIG`, `ADAPTER_DIR`, `ALLOW_MOCK_SOURCES` (`true` only on the demo host, CI and dev; 5.4), the `frame-ancestors` and CORS allowlists (5.9), and the embedded-mode JWT issuer, audience and JWKS URL (5.6, 6.9).

`/data` holds the encrypted database and its WAL and nothing else. Copying the file off the laptop yields ciphertext; opening it without `DB_KEY` fails (tested, 10.4). Pragmas are set by the API (5.5). Copies of `DB_KEY`, `CREDENTIAL_KEY` and the backup private key (8.6) are held offline, off the laptop, and never stored alongside backups [open]. Losing `DB_KEY` with no offline copy loses the database; there is no recovery path.

### 8.3 Compose

The laptop runs `deploy/compose.yml` with three services, each `restart: unless-stopped`:

- `app`: `ghcr.io/birchdesignlab/querymodule:release`. Secrets per 8.2. Volumes `data:/data`, `./config:/config:ro`, `./adapters:/adapters:ro`. No published ports: cloudflared is the sole ingress, which is what makes `CF-Connecting-IP` trustworthy (5.6). `stop_grace_period: 30s`. Label `com.centurylinklabs.watchtower.enable=true`.
- `cloudflared`: tunnel token from the `TUNNEL_TOKEN` secret file, routing `querymodule.birchdesignlab.com` (HTTP and WebSocket) to `app:3000`. DNS is on Cloudflare, so the route creates the CNAME.
- `watchtower`: polls GHCR every five minutes, label-scoped to `app`, so it only follows the `release` tag named in the image reference. GHCR read-packages token from a read-only mounted Docker `config.json`.

On SIGTERM the app drains per 5.2: submits get 503, in-flight sources run to outcome or deadline, bounded by the maximum configured `timeoutMs` plus 5 s. `stop_grace_period: 30s` covers the 10 s default. A site that raises any `timeoutMs` above 20 s raises `stop_grace_period` with it; `docs/deploy.md` states this, and nothing enforces it [open]. Rows still `pending` after a hard kill become `interrupted` at the next startup (5.2).

### 8.4 Release tags, promote and rollback

CI pushes `sha-<commit>` and `latest` on every merge to `main` (9.3). Nothing deploys `latest`. Production runs the `release` tag.

`.github/workflows/promote.yml` (manual `workflow_dispatch`, inputs `sha`, optional `milestone` `m0` to `m4`):

1. Verify the `ci` workflow succeeded for `sha` on `main`.
2. For a milestone, run the story-tag gate for that milestone (10.2) and require `docs/releases/<milestone>.md` at `sha` (9.5).
3. Retag `sha-<commit>` as `release` by manifest copy (no rebuild). For a milestone, also push git tag `<milestone>` at `sha`.

Watchtower deploys the new `release` within five minutes. A milestone is a release tag (x6). After every promote the developer runs `scripts/ops/smoke.sh` against the live URL (8.7).

Rollback is a promote of an older sha. `release` then points at the older digest, so Watchtower cannot restore the bad image. Migrations are expand-then-contract (9.2): an older image runs on a newer schema, its migrator finds nothing to apply, and migrations are never rolled back.

### 8.5 Seed and demo accounts

`docker compose run --rm app node scripts/ops/seed.js` runs once against an empty database. It creates the users in `packages/api/src/seed/users.ts` (5.6) plus a non-admin `smoke` user. Each password is derived as HMAC-SHA256 of the email under `SEED_PASSWORD_SECRET` (5.6). It is printed once to that command's stdout, never to the service log, and is never committed. `docs/demo.md` lists usernames only. Roles beyond the seed go through `scripts/ops/grant-role.ts` (5.6). CI generates a random `SEED_PASSWORD_SECRET` per run and derives passwords the same way.

### 8.6 Backups and restore

`scripts/ops/backup.sh` runs nightly from a systemd timer on the laptop:

1. Take an online backup of the database into a staging volume, never `/data`, through `scripts/ops/backup.ts` inside the app container. The copy stays encrypted under `DB_KEY`.
2. Encrypt it again with `age` to a recipient public key. The private key is not on the laptop.
3. Upload it off-box with `rclone` to one configured remote (a Cloudflare R2 bucket for the demo) [open], then delete the local staging copy.
4. Prune remote copies older than 30 days.

Retention is 30 days. `docs/deploy.md` states that backups hold superseded and deleted credential ciphertext and crypto-shredded payload DEKs for up to 30 days (c048, 5.5), recoverable only with the `age` private key, `DB_KEY` and `CREDENTIAL_KEY` together.

`scripts/ops/restore-test.sh` fetches the newest backup, decrypts it, and starts a throwaway app container on it with no published ports. It then checks `/api/v1/health` (which proves the migrations, triggers and canary) and compares the `audit_event` row count and max id with the backup manifest. It runs at every milestone exit, and the result is recorded in `docs/releases/<milestone>.md`.

### 8.7 Smoke and runbooks

`scripts/ops/smoke.sh <baseUrl>`, run from the laptop:

1. `GET /api/v1/health` and `GET /api/v1/meta`.
2. Log in as `smoke`, with the password derived from the local `SEED_PASSWORD_SECRET` file.
3. Submit a plate query for `ZZ-0001` on the default site and expect 202 with a correlation ID.
4. Poll `GET /api/v1/queries/:correlationId` until no part-source is `pending`.
5. Open `/api/v1/ws` and receive one heartbeat.

`--soak 10m` holds the socket open with heartbeats for ten minutes; that is the M0 tunnel exit check (x11). Smoke runs after every promote and at every milestone exit.

**Lost `CREDENTIAL_KEY`.** The startup canary fails and the app refuses to serve (5.7). Runbook, documented in the header of `scripts/ops/lost-key.ts`:

1. Confirm the offline copy is also lost.
2. Provision a new `CREDENTIAL_KEY` secret file.
3. Run `lost-key.ts` with the new key mounted. It deletes every `state_credential` row with `credentialsInvalidated` (reason `keyLost`) per row, revokes active delegations, and writes a new canary (5.7). Because request DEKs are wrapped under a key derived from `CREDENTIAL_KEY` (5.5), stored values and payloads are now unreadable, so it also deletes all `request_key` rows and writes one `retentionPurged` with reason `keyLost` [open]. It ends with `wal_checkpoint(TRUNCATE)`.
4. Start the app. Users see `credentialsMissing` and re-enter credentials.

**Lost `DB_KEY`.** Restore from the offline copy of the key; without it the database and every backup are unreadable.

Covers SEC-006, SEC-007, SEC-010, SEC-012, NFR-003.

## 9 CI and repository process

### 9.1 Branches, ruleset and sensitive review

Each change gets a short-lived branch (`feat/`, `fix/`, `docs/`, `chore/`) and one PR, squash-merged. There are no direct commits to `main`. Self-merge is allowed once the required checks pass.

A GitHub ruleset on `main` requires a PR and the status checks `ci` and `sensitive-review`, and blocks force push and deletion. It requires linear history and has an empty bypass list. The v1 "no rulesets" decision is withdrawn.

`sensitive-review` is a job in `ci.yml`. `.github/sensitive-paths` lists globs for the sensitive areas in `CLAUDE.md` (credentials, delegation, audit, dispatch and adapters, terminal parser, write-back, delete-from-view, the migrations for their tables, `.github/`, `scripts/ci/`, `scripts/ops/`). If the PR diff touches none of them, the job passes. If it touches any, the PR must contain `docs/reviews/pr-<number>.md` with front matter `{ reviewer: "opus-5.5", effort, reviewedSha, verdict: "approve" }`, and no sensitive-path file may change in commits after `reviewedSha`. The Opus review seat writes the artifact and the developer commits it [open: file format]. The check proves a review was recorded, not that it was independent; section 14 covers that.

### 9.2 Dark merges and migrations

Unfinished capabilities merge behind the `features` block (5.8) set to `false` in every shipped site config, so their routes return 404 and their UI is hidden. Sensitive capabilities (`credentials`, `delegation`, `resultHide`, `adminAudit`, `embedded`) stay dark until their acceptance tests (10.2) pass on `main`. Turning one on is its own config PR. Test configs under `packages/config/test/` turn every flag on.

Migrations are generated by drizzle-kit, applied at startup, and follow expand-then-contract. Expand adds nullable or defaulted columns. A later release switches reads to them, and a release after that contracts. `audit_event` never contracts: no column is ever removed or renamed.

`scripts/ci/check-audit-migrations.ts` fails the build if any migration statement names `audit_event`, unless it is one of:

- the initial `CREATE TABLE` and `CREATE TRIGGER` statements;
- `ALTER TABLE audit_event ADD COLUMN` of a nullable column;
- `CREATE INDEX ... ON audit_event`.

drizzle-kit's table-rebuild pattern (`__new_audit_event`, `DROP TABLE audit_event`) always fails.

### 9.3 `ci.yml`

Triggers on pull requests and pushes to `main`. Concurrency is cancelled per ref. Runs on `ubuntu-latest` with `contents: read`, plus `packages: write` in the publish job on `main` only.

1. Checkout, pnpm with store cache, `pnpm install --frozen-lockfile`.
2. `biome ci`, `tsc -b`.
3. `pnpm config:validate`: runs every shipped site (default, and `example-ok` resolved through `extends`) through the shape schema, `validateSiteConfig` (4.1) and the fixture policy and mock checks (5.4).
4. Licence check (BR-006): `scripts/ci/check-licences.ts` over `pnpm licenses list --prod --json` for every runtime package [open: tool]. Allowlist: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC. Anything else fails unless `.github/licence-exceptions.json` lists the package, licence, reason and review date. A new runtime dependency with a licence outside the allowlist needs that entry in the same PR.
5. `vitest run --coverage` with per-directory thresholds (10.5).
6. Story-tag gate: `scripts/ci/check-story-tags.ts` (10.2).
7. Contract diff (x5, c114). Regenerate `packages/api/openapi.json` and `packages/core/contracts/ws-events.schema.json` (from the 4.7 Zod schemas). Fail if either differs from the committed copy, so every contract change shows in the PR diff. Run `oasdiff breaking` against the copy on `main`. A breaking change fails unless the PR carries the label `api-breaking`, and the next release notes must list it [open].
8. `apps/web` production build (Vite).
9. `apps/mobile`: `expo export --platform ios --platform android` from M0 (bundles only).
10. Docker image build (buildx, layer cache). Not pushed yet.
11. Boot smoke. Run the image with a fresh temp volume, CI-generated random secret files, the test deploy config and `ALLOW_MOCK_SOURCES=true`. Wait up to 60 s for `/api/v1/health`. `docker exec` runs `scripts/ops/check-triggers.js`, which asserts both `audit_event` triggers exist. Send SIGTERM and assert a clean exit inside the grace period.
12. Playwright against that running container. The `@smoke` subset runs first (login, plate `ZZ-0001` submit, ack and correlation ID visible), then the full suite. From M0, every scenario fails on any CSP violation. From M1, `@axe-core/playwright` runs in every scenario and fails on serious or critical violations. The M0 suite is login, the health page (authenticated WebSocket heartbeat, x11) and CSP.
13. Publish (push to `main` only, after steps 1 to 12 pass): log in to GHCR, push `sha-<commit>` and `latest`.

`nightly.yml` runs Stryker mutation testing on `packages/api/src/{audit,credentials,delegation,dispatch}`. It is non-blocking and publishes its report as a workflow artifact. `promote.yml` is described in 8.4.

### 9.4 Dependabot

`.github/dependabot.yml` updates npm weekly (minor and patch grouped, majors separate), github-actions weekly and docker weekly (the runtime base digest). Security updates are on. Majors are reviewed and never auto-merged. Newest stable, no sitting on known advisories (`CLAUDE.md`).

### 9.5 Release notes and doc refresh

Every milestone exit PR adds `docs/releases/<milestone>.md` (BR-004), containing:

- a generated section from `pnpm config:validate --resolved --diff` against the previous milestone tag (config schema changes, new, renamed or removed keys, migration notes);
- API and WebSocket contract changes from the step 7 diff, including any `api-breaking` PRs;
- smoke, restore-test, manual accessibility and Maestro results (10.6, 10.7).

The same PR refreshes `docs/site-config.md`, `docs/api.md` and `docs/demo.md` (BR-005). `promote.yml` refuses a milestone without the notes file.

Covers BR-004, BR-005, BR-006, BR-007.

## 10 Testing strategy

### 10.1 Layers and conventions

| Layer | Tool | Location | Runs in |
|---|---|---|---|
| Core unit | Vitest; property tests for tokenize/format round trip and canonicalisation idempotency | colocated `packages/core/src/**/*.test.ts` | CI step 5 |
| Client | Vitest | `packages/client/src/**/*.test.ts` | CI step 5 |
| API | Vitest + Hono `app.request`, fresh libSQL database per test (in-memory; file-backed and encrypted where the test is about storage) | `packages/api/test/` | CI step 5 |
| Web components | Vitest + Testing Library (DOM) | `packages/web-ui`, `apps/web/src` | CI step 5 |
| Native components | React Native Testing Library (M4) | `packages/rn-ui` | CI step 5 |
| End to end | Playwright + axe against the built image | `apps/web/e2e/` | CI step 12 |
| Native flow | Maestro against Expo Go, manual per release (M4) | `apps/mobile/maestro/` | developer phone |

TDD for every task, per the superpowers workflow. Core tests keep one `describe` per requirement ID where one maps. The API has a shared helper that validates every response against its route's declared response schema, and every WebSocket event against its 4.7 schema (x5). `AuditService`, `IdentityService`, `EntityStore` and `EventBus` each have one contract suite that runs against every implementation (5.5).

Test data follows the fixture policy (5.4). `ZZ-0001` returns STOLEN. `ABC123` returns a clean no-record. `TIMEOUT` stalls exactly one of the two default sources. Names are synthetic.

### 10.2 Acceptance matrix

Each story's tests carry the story ID in the test title as `[A1]`. `scripts/ci/check-story-tags.ts` reads `docs/testing/stories.json` (story, milestone, test files). It fails CI when:

- any story in a milestone at or below the highest milestone git tag lacks a tagged test in a listed file; or
- run by `promote.yml` for milestone N, any story in milestone N lacks one.

Stories marked `later` are exempt until scheduled. A milestone exits when every story in it and earlier ones is green on `main`, smoke passes against the live URL (8.7), and that milestone's manual passes (10.6, 10.7) are recorded. A9, B3 and B5 are asserted at the API layer by reading `audit_event` rows field by field.

| Story | Given / When / Then (summary) | Layer | Test files | Milestone |
|---|---|---|---|---|
| A1 | Site default State TX; open plate form: only Plate, State=TX, Year, VIN shown (no expanded fields); Enter with plate submits. Table cases: A1 as written, State changed, Year typed (4.3 mode). | core, e2e | `packages/core/src/rules/evaluate-form.a1.test.ts`; `apps/web/e2e/a1-plate-form.spec.ts` (keyboard only) | M1 |
| A2 | State TX to OK: Plate Type appears, required, announced; back to TX: hidden, not required, value not submitted. | core, e2e + axe | `packages/core/src/rules/evaluate-form.a2.test.ts`; `apps/web/e2e/a2-conditional-fields.spec.ts` | M1 |
| A3 | Required field empty; submit: blocked, field marked with `aria-describedby` message, focus on first invalid, count announced. | core, e2e + axe | `packages/core/src/rules/validation.a3.test.ts`; `apps/web/e2e/a3-required.spec.ts` | M1 |
| A4 | `VEH.ABC123..26`: Plate=ABC123, State=TX, Year=2026 runs (clean no-record); `XYZ.123`: `unknownCommand` error tied to the terminal input. | core, e2e | `packages/core/src/terminal/parse.a4.test.ts`; `apps/web/e2e/a4-terminal.spec.ts` (keyboard only) | M1 |
| A5 | Toggle form and terminal: mode switches; positioned user values survive both ways; unpositioned fields kept with "n fields not shown". | core (property), e2e | `packages/core/src/terminal/roundtrip.a5.test.ts`; `apps/web/e2e/a5-toggle.spec.ts` | M1 |
| A6 | Submit: 202 with correlation ID and `acknowledgedAt` after commit; toast plus a copyable correlation ID and ack time on the request entry; notification when mock results return. | api, e2e | `packages/api/test/queries/submit.a6.test.ts`; `apps/web/e2e/a6-ack.spec.ts` | M2 |
| A7 | STOLEN and WANTED critical; response for `ZZ-0001` contains STOLEN: critical style plus marker; STOLEN only in a detail-only path still badges the card at 1024x768. | core, e2e | `packages/core/src/response/assess-result.a7.test.ts`; `apps/web/e2e/a7-highlight.spec.ts` | M2 |
| A8 | Mapping configured; results return: mapped summary elements render; expand shows detail (button `aria-expanded`); unmapped source falls back to generic dump. | core, e2e | `packages/core/src/response/map-response.a8.test.ts`; `apps/web/e2e/a8-mapping.spec.ts` | M2 |
| A9 | Submit: `submitted` per part (actor snapshot, queryType, type-field values, selected and dispatched sources, plateOnly, configHash), `acknowledged` (at), `sourceResponded` per source (status, latency, credential owner, adapter_kind), all epoch ms. | api | `packages/api/test/audit/query-audit.a9.test.ts` | M2 |
| B1 | Two default sources, `TIMEOUT` on one; submit: first `returned`, second `timedOut` at `timeoutMs` from ack; late settlement ignored. | api (fake timers), e2e | `packages/api/test/dispatch/timeout.b1.test.ts`; `apps/web/e2e/b1-multi-source.spec.ts` | M3 |
| B2 | Person query with `alsoRun` wanted check; submit: parts 0 and 1 under one correlation ID, `submitted` per part (origin, parent, fieldMap), results per part per source. | api, e2e | `packages/api/test/dispatch/nested.b2.test.ts`; `apps/web/e2e/b2-nested.spec.ts` | M3 |
| B3 | Trainee requests delegation; officer approves on own session with code; trainee query dispatches with officer's credentials; `source_result.credential_user_id` and `delegation_id` set; `submitted` actor is trainee, `sourceDispatched` and `sourceResponded` name the officer. Diverges from B3 wording: the officer approves on their own device using stored credentials instead of typing them into the trainee session (5.7). | api, e2e (two contexts) | `packages/api/test/delegation/delegated-query.b3.test.ts`; `apps/web/e2e/b3-delegation.spec.ts` | M3 |
| B4 | Stored credentials; change with step-up: next dispatch sends the new username (mock records it); `credentialsChanged` audited; raw-bytes scan finds no old ciphertext (10.4). | api | `packages/api/test/credentials/change.b4.test.ts` | M3 |
| B5 | Three results; hide two: list, single GET and replay exclude them; `source_result` rows intact; two `result_visibility` rows; one `deletedFromView` per real insert; repeat hide inserts and audits nothing; admin `includeHidden` returns them. | api, e2e | `packages/api/test/results/hide.b5.test.ts`; `apps/web/e2e/b5-delete-from-view.spec.ts` | M3 |
| B6 | Response; "Add to supplemental": mapped data written to the target record through `EntityStore`. | api (EntityStore contract) | `packages/api/test/writeback/supplemental.b6.test.ts` | later |
| B7 | Site-narrowed property type list; open property form: only enabled types listed; required fields follow selected type; disabled codes never appear. | core, e2e | `packages/core/src/rules/property-picklist.b7.test.ts`; `apps/web/e2e/b7-property.spec.ts` | M3 |
| C1 | Mobile-unit and mobile personas; results return: condensed summary cards; orientation preference persists across logout and login. | e2e (1024x768, 1366x768, 800x600), Maestro | `apps/web/e2e/c1-mobile-unit.spec.ts`; `apps/mobile/maestro/c1-condensed.yaml` | M4 |
| C2 | CAD Mobile opens: quick-access query types one tap from home; targets at least 48x48 and grow with OS font scale to 2x. | rn component, Maestro | `packages/rn-ui/src/quick-queries.c2.test.tsx`; `apps/mobile/maestro/c2-quick-queries.yaml` | M4 |

### 10.3 Security tests (API)

Each test is required from the milestone that introduces its route or feature. Files live under `packages/api/test/security/`.

- **Route by caller matrix** (`route-matrix.test.ts`). It is generated from `openapi.json`, so a route with no matrix row fails. Expectations:
  - anonymous: 401;
  - another user's correlation ID or result IDs (GET, hide, retry): 404;
  - non-admin on `admin/*`: 403;
  - missing `X-Requested-With` on a state-changing route: 403;
  - disabled feature: 404;
  - `GET /api/v1/config` without a session: 401, and the body matches the `ClientSiteConfig` allowlist (no `Source.server`).
  
  Policy-function positives are asserted too: an admin view writes `adminViewed`, the delegating officer gets read-only access, and hide is owner-only.
- **WebSocket** (`ws-auth.test.ts`). Upgrade is rejected with no session, an expired session, a foreign Origin, a missing Origin with a cookie, or a bearer token in the query string. It is accepted with a missing Origin and a bearer token in `Authorization`. No event crosses users. The socket closes on logout, expiry and revocation, and nothing is pushed after logout.
- **Credential non-disclosure** (`credentials-disclosure.test.ts`). The list and per-source GET bodies never contain the secret, ciphertext, IV or auth tag. PUT and DELETE without step-up are rejected. A row copied from officer to trainee (swapped AAD) fails decryption, writing `credentialsInvalidated` and producing `credentialsMissing`.
- **Log capture** (`log-capture.test.ts`). Captures the logger and error reporter across a submit, a credential PUT, a delegation approval and an adapter that throws with its request config. Asserts that no FieldDef value, secret plaintext, `DB_KEY` or `CREDENTIAL_KEY` material, or session token appears, and that `Secret<T>` redacts under `JSON.stringify`, `String()` and `util.inspect`.
- **Delegation failures** (`delegation-failures.test.ts`). Covers:
  - a wrong code;
  - a request past 5 minutes;
  - approval without fresh auth or TOTP;
  - an officer lacking the delegator role;
  - an officer missing credentials for a source (the error names it);
  - a revoked or expired delegation;
  - a trainee session ending (`sessionEnded`);
  - the code-redemption rate limit.
  
  Each asserts that no active delegation resolves and that the expected audit rows exist.
- **Auth limiter and sessions** (`auth-limits.test.ts`). 10 failures in 15 minutes per account locks it for 15 minutes. 100 per 15 minutes per IP, keyed on `CF-Connecting-IP`. Lockout is audited. Limiter state survives a restart. `mfaRequired` blocks non-auth routes until enrolment. Idle 30 minutes and absolute 12 hours are checked with a fake clock.
- **Storage** (`storage.test.ts`). Opening the database file without `DB_KEY` fails. A mismatched `CREDENTIAL_KEY` fails the canary and startup refuses to serve. `UPDATE` and `DELETE` on `audit_event` abort. Dropping a trigger makes startup refuse to serve.
- **Raw bytes** (`raw-bytes.test.ts`). Runs on a database opened without whole-DB encryption, so the scan sees the column layer. After a credential change and a delete plus checkpoint, the old ciphertext, username and secret bytes are absent from the database and WAL files.
- **Mock gate** (`mock-gate.test.ts`). A source with no `kind` fails to load. A `mock` kind fails startup when `ALLOW_MOCK_SOURCES` is not `true`. `adapter_kind` is recorded on `source_result` and in `sourceResponded`.
- **Submit guards** (`submit-guards.test.ts`). `configHash` mismatch returns 409. Unknown field keys return 400. A posted `mode` mismatch returns 400. Hidden field values are neither persisted nor dispatched. A replayed `Idempotency-Key` returns the original 202 with no new rows.

### 10.4 Pipeline and durability tests (API)

- **Replay** (`packages/api/test/feed/replay.test.ts`). Submit a two-source query with staggered mock latency, close the socket after the first event, and reconnect with the last `seq`. Each missed event arrives exactly once, in `seq` order. More than 500 events due, or a cursor older than 24 hours, yields `resync`. Hidden results are not replayed. The client high-water-mark dedup is tested in `packages/client/src/ws/dedup.test.ts`.
- **Timeouts and nesting** (`dispatch/*.test.ts`, fake timers). B1 and B2 as above. Status is write-once from `pending`. A nested part failing validation becomes `skipped` with `partSkipped` while the parent proceeds. Per-source (4) and global (32) caps are enforced. There are no retries.
- **Concurrency** (`dispatch/concurrency.test.ts`). 20 parallel submits from 5 users against a file-backed WAL database. Each gets a 202 and, per part, `submitted`, `acknowledged` and one `pending` row per (part, source). No `SQLITE_BUSY` reaches a caller (c071).
- **Kill during dispatch** (`lifecycle/kill.test.ts`). Spawns the built server as a child process on a file database, submits to a slow mock source, and sends SIGKILL after the 202. On restart the sweep marks those rows `interrupted` with one `interrupted` audit row each and an `event_log` entry, and nothing is re-dispatched.
- **SIGTERM drain** (`lifecycle/drain.test.ts`). SIGTERM during dispatch: a new submit gets 503, in-flight sources reach an outcome, and the process exits 0 within the drain bound.
- **Audit fields** (`audit/fields.test.ts`). For every `AuditEventType` (4.7), trigger the event and assert each field of its details schema plus the SEC-010, SEC-011 and SEC-012 fields (actor snapshot, credential owner, epoch ms, integer id order). This asserts on audit rows as well as executing the code that writes them (x10).
- **Offline** (`apps/web/e2e/offline.spec.ts`). `context.setOffline(true)`: submit stays focusable with `aria-disabled` and a visible reason; on reconnect, pending rows are refetched over HTTP.

### 10.5 Coverage and mutation

| Directory | Threshold |
|---|---|
| `packages/api/src/audit`, `credentials`, `delegation`, `dispatch` | 100% branches |
| `packages/core` | 95% lines and branches |
| `packages/api` (rest) | 85% lines |
| `packages/client` | 85% lines and branches |

`apps/web`, `packages/web-ui` and `packages/rn-ui` carry no threshold. Logic belongs in `packages/client`, and those packages are covered by e2e and axe. Stryker runs nightly and non-blocking on the four sensitive API directories (9.3).

### 10.6 Accessibility

`@axe-core/playwright` runs in every Playwright scenario from M1 and fails on serious or critical violations (9.3). Named Playwright cases:

- keyboard-only A1 and A4 flows from M1 (c046);
- typing while a result arrives, asserting that focus, the input value and the live-region text are unchanged (6.6);
- 1920x1080 at 200% zoom, where the persona does not change;
- 320 CSS px reflow;
- the mobile-unit viewports 1024x768, 1366x768 and 800x600 (6.3).

Manual passes, recorded in `docs/releases/<milestone>.md`:

- NVDA with Chrome at the M2 and M3 exits;
- VoiceOver and TalkBack at the largest text size at the M4 exit;
- a daylight readability check of the mobile-unit day theme at the M4 exit (6.3).

### 10.7 Native

`expo export` for iOS and Android runs from M0 (9.3). From M2, API tests cover bearer auth on REST and on the WebSocket upgrade (`packages/api/test/security/bearer.test.ts`). The Maestro flows for C1 and C2 run manually against Expo Go at each release from M4, with results in `docs/releases/`. The Better Auth Expo plugin fallback (14) triggers if the token is not restored after a cold start, which the Maestro flow checks first.

### 10.8 Config and fixture validation

`packages/core/src/config/validate.test.ts` holds one failing fixture per `validateSiteConfig` rule. `scripts/mock-data/generate.test.ts` holds one per fixture-policy rule:

- a real-format plate;
- a VIN that passes the ISO 3779 check digit;
- a plausible DOB;
- a non-synthetic name or address.

Both assert the JSON path in the error. `config:validate` runs over every shipped site and mock file in CI step 3, including mapping-path resolution against mock defaults and scenarios.

Covers FR-043, FR-044, FR-064, NFR-003, NFR-004, SEC-010, SEC-011, SEC-012, SEC-013.

## Writer notes (remove at assembly)

(a) [open] tags
- 8.2: offline escrow of `DB_KEY`, `CREDENTIAL_KEY` and the age private key, not stored with backups.
- 8.3: `stop_grace_period: 30s`, with the "raise it when `timeoutMs` > 20 s" rule documented but not enforced.
- 8.6: off-box target is one rclone remote (R2 for the demo).
- 8.7: `lost-key.ts` also deletes `request_key` rows and writes `retentionPurged` (reason `keyLost`), because 5.5 derives the DEK wrapping key from `CREDENTIAL_KEY`; 5.7's lost-key text does not mention this. Alignment is needed at assembly.
- 9.1: format of the `docs/reviews/pr-<n>.md` review artifact.
- 9.3 step 4: licence tool is `pnpm licenses list` plus a script, in place of the `license-checker` package the decision names (unmaintained); allowlist unchanged.
- 9.3 step 7: `api-breaking` label bypass for breaking OpenAPI diffs.

(b) Assumptions about other sections
- Secret file names `DB_KEY`, `CREDENTIAL_KEY`, `SEED_PASSWORD_SECRET` (5.5, 5.6, 5.9). `BETTER_AUTH_SECRET` and `TUNNEL_TOKEN` are named here.
- `GET /api/v1/health` returns 200 only after migrations, trigger check, canary and config pass (5.1 calls it liveness).
- SIGTERM drain bound = max `timeoutMs` + 5 s and 503 on submit (5.2).
- Feature names `credentials`, `delegation`, `resultHide`, `adminAudit`, `embedded` (5.8).
- `X-Requested-With` missing returns 403 (5.9).
- WS event JSON Schema exported from 4.7 Zod schemas to `packages/core/contracts/ws-events.schema.json`.
- `scripts/ops/grant-role.ts`, `purge.ts`, `lost-key.ts`, `disable-user.ts` from 5.5 to 5.7. Seed password = HMAC-SHA256(email) per 5.6.
- Persona, announcer and viewport subsection numbers 6.1, 6.3 and 6.6 per the numbering plan.
- Fixture examples `ZZ-0001` (STOLEN), `ABC123` (clean), `TIMEOUT` on one of two default sources (5.4).
- Section 14 carries the independence-of-review and Expo plugin fallback risks referenced from 9.1 and 10.7.

(c) Decision lines not placed
- c069 hash chain is deferred per the decision; not placed.
- Length exceeds 2.5x v1 because the required acceptance matrix and the security test list are new content.
