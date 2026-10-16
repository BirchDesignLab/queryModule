# Security

> This runs on mock data only and is not connected to real state or national systems. It is still
> built to the standard a real connection and use would demand: encrypted credentials, a complete
> audit trail, and security controls rooted directly in CJIS rules.

## Scope

- Every source is a mock source that answers from canned files of fictitious records. There is no
  adapter for a real system, and the live demo holds no criminal justice information.
- Never enter real personal, vehicle, property or criminal justice data into the demo or into an
  issue. Use the demo accounts and the synthetic values in the [demo guide](docs/demo.md).
- The design aims at the CJIS Security Policy control areas, GDPR and the EU Cyber Resilience Act
  without certification (spec 2). Certification is not in scope.

## Reporting a vulnerability

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/BirchDesignLab/queryModule/security/advisories/new)
for this repository. Do not open a public issue. Include the affected path or URL, the steps to
reproduce, and what you expected to happen. You will get an answer in the advisory thread.

## The security model

Each control below is marked **built** (merged on `main` and covered by tests) or **planned** (with
its milestone). The design is in the [design spec v2](docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md),
sections 5.5 to 5.9; the requirement IDs (SEC-) are in the
[requirements definition](Requirements%20Definition%20-%20Query%20Module%20Usability%20Enhancements.md).

### Data at rest and keys

| Control | State |
|---|---|
| The whole database file is encrypted at rest with `DB_ENCRYPTION_KEY` | Built |
| Query values and source answers are stored only as ciphertext, each request under its own data key wrapped by `DATA_KEY`, so a request can be crypto-shredded | Built (the purge script is planned, M3 P2) |
| Keys come from Docker secret files, never from the image, `.env` or the data volume; the server refuses to start when a secret is missing or misplaced | Built |
| Key canaries: at startup the server proves `CREDENTIAL_KEY` and `DATA_KEY` decrypt their canary rows, or refuses to start | Built |
| A `Secret` type keeps secret values out of logs, errors and serialized output | Built |
| Users' own state-system credentials: entry, change and deletion, stored encrypted under `CREDENTIAL_KEY` with a key version, behind step-up authentication | Planned, M3 P1 |
| Credential key rotation procedure | Outside this design (a key version is recorded; no rotation procedure is built) |
| Encrypted nightly backups with an offline key, and a restore test at each milestone exit | Built ([deploying](docs/deploy.md)) |

### Audit trail

| Control | State |
|---|---|
| Every submit, dispatch, source response, sign-in, admin change and config publish writes an audit row | Built |
| Audit rows are append-only: database triggers refuse any update, delete or replace, and CI checks every migration and schema write | Built |
| Admin audit viewer with paging and export; viewing the audit is itself audited | Planned, M2 P2 |
| Audit of delete from view and of delegated-credential use | Planned, M3 |
| Audit hash chain | Later, not scheduled |

### Sign-in, sessions and the web surface

| Control | State |
|---|---|
| Email and password sign-in, with a minimum password length and a forced change of an admin-set temporary password | Built |
| Session limits: 30 minutes idle and 12 hours absolute by default, set per site | Built |
| Auth rate limits: an account locks for 15 minutes after 10 failures in 15 minutes; 100 requests per IP per 15 minutes | Built |
| A required `X-Requested-With` header on state-changing requests, a CORS origin allowlist (the sign-in routes also check Origin), and an Origin allowlist on the WebSocket upgrade | Built |
| A strict Content Security Policy with per-request nonces, `frame-ancestors 'none'`, a 32 KiB body cap and `no-store` on every API response | Built |
| Role-based access (user, training officer, implementer, admin) checked by a route-by-caller test matrix | Built |
| A query's results are visible only to its owner and to admins | Built |
| TOTP multi-factor sign-in and step-up | Planned, M3 P1 |
| Delegation: a training officer approves a trainee's queries, with a code, fresh authentication and revocation | Planned, M3 P3 |
| Embedded identity from a host page (signed host token, issuer, audience and key checks, frame allowlist) | Planned, M4 |

### Logs and mock data

| Control | State |
|---|---|
| A structured logger that drops secrets, key material, passwords, tokens and query values; log-capture tests prove it | Built |
| Mock sources run only where `ALLOW_MOCK_SOURCES=true` is set | Built |
| A fixture policy, enforced in code, so no mock record can look like a real person, vehicle or property | Built |

### Process

- Changes to credential, audit, dispatch, parser, config and review-gate code need a recorded Opus
  review before merge; CI enforces it ([contributing](CONTRIBUTING.md#review-tiers-adr-0007)).
- Dependencies are license-checked in CI and kept on the newest stable release; Dependabot raises
  updates, and `pnpm audit --prod` runs at every gate.
- Most code is written by AI agents under one developer's direction. An independent human security
  review is required before any handoff (spec 14).
