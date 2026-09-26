# Query Module 2.0 implementation master plan

Date: 09-25-26
Status: active
Spec: `docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md` (spec v2). Section numbers below (5.2, 12.7) refer to it.
Decisions: `docs/superpowers/specs/2026-09-25-review-decisions.md` (review log, frozen); new decisions go to `docs/decisions/` (ADRs).
Status grid: `docs/superpowers/plans/STATUS.md`.
Backlog: GitHub Issues on `BirchDesignLab/queryModule`.

## 1 Purpose and how to use this document

This is the one plan above all phase plans. It fixes how a solo developer runs two concurrent Claude Code sessions (three from M4) on two machines, pausing and resuming over weeks, without the sessions colliding.

It does not restate the spec. It says who builds what, in which order, where state lives, and what "done" means.

How to use it:

1. A session reads section 6 (session protocol) and follows it verbatim. Everything else is reference.
2. To find the current work, read `STATUS.md`, not this file.
3. To start a phase, find its row in section 4, write the phase plan named there, create its issues, then work them.
4. This file changes only by PR, only when the process changes, and each change retires or rewrites a section (balloon guard, 5.4). Scope and design changes go to an ADR, not here.

## 2 Tracks and machines

| Track | Machine | Session | Owns (writes) | Never edits |
|---|---|---|---|---|
| A platform | Linux laptop, Docker; also the deploy host | 1 | `packages/api`, `deploy/`, `.github/`, `scripts/ops/`, `scripts/mock-data/`, `scripts/ci/`, `scripts/migrations/`, `packages/config/mock/` | `apps/*`, `packages/web-ui`, `packages/tokens` |
| B web | Windows 11, PowerShell | 2 | `apps/web` (Vite + React DOM), `apps/host-simulator`, `packages/web-ui`, `packages/tokens`, `packages/client`, Playwright and axe suites (`apps/web/e2e/`) | `packages/api`, `deploy/` |
| Core | either | whichever claims the issue | `packages/core`, `packages/config/sites/`, `packages/config/locales/`, `packages/config/test/`, `packages/config/schema/`, contract files (section 8.2), `docs/testing/stories.json` | |
| D mobile (from M4) | Windows | 3 | `apps/mobile` (Expo), `packages/rn-ui`, Maestro flows (`apps/mobile/maestro/`) | `packages/api`, `deploy/` |

Rules:

1. A track is a role; the machine is its default host. A session may take a track on the other machine for work that needs no Docker or deploy access (for example Track A API code on Windows with `pnpm dev`). It declares that in `STATUS.md` Active sessions. Never two sessions on one track at once.
2. Core is small PRs from either track. The default claimant per Core cell is named in section 4; the other track may claim it if the default is busy and says so on the issue.
3. Contract first: a Zod schema, OpenAPI route, WebSocket event, audit type or config schema change lands in its own `contract` PR before any consumer (section 8).
4. Backend leads by half a milestone: while B builds M(n) UI, A builds the M(n+1) pipeline, so B never waits on a feed. Operationally in 3.4.
5. Shared root files (root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `biome.json`, `.nvmrc`, `.gitattributes`, `.gitignore`, `README.md`, `CLAUDE.md`) change only in their own `chore/` PR, one at a time (section 11).
6. `apps/mobile` placeholder shell exists from M0 for the `expo export` CI step (9.3). The P0 session creates it; Track D takes ownership at M4.

## 3 Levels and phasing

### 3.1 Levels

| Level | Unit | Lives in | Closed by |
|---|---|---|---|
| Milestone | M0 to M4; a release tag (8.4) | GitHub milestone; git tag `m<k>` | `promote.yml` with `milestone` input after the exit gate (12.7) |
| Phase | P0 to P3 inside a milestone grid | `STATUS.md` row; one phase plan file per track cell | its Gate cell holding on `main` |
| Task | one issue, one branch, one PR | GitHub issue; checkbox in the phase plan | squash merge with `Closes #n` |

Milestone to phase mapping. M0 and M1 share one grid (12.2): M0 = P0 and P1 (M0 exit is the P1 gate); M1 = P2 and P3. M2, M3 and M4 each have their own P0 to P3.

### 3.2 Ordering rules

1. Tracks run concurrently.
2. A track's phases run in order: its P(n+1) starts only when its own P(n) cell is `done`.
3. Same-numbered phases run concurrently across tracks.
4. A cross-track dependency attaches to a specific phase cell, never to a whole milestone. Section 4 lists each one as "B Pn cell needs A Pm item". A blocked task waits; the rest of the cell proceeds.
5. A phase gate holds when every cell in the row is `done` and the gate text in section 4 is verified on `main`.

### 3.3 Concurrency by phase

| Phase | Sessions | Notes |
|---|---|---|
| P0 contracts | 1, either machine | One owner session runs the whole P0 plan, all its cells in sequence. The other machine keeps working its previous phase (usually B finishing M(n-1) P3 while A runs M(n) P0). For M0 there is no previous phase: Windows does machine setup (section 9.2). |
| P1 to P3 | 2 | One per track. |
| M4 P1 to P3 | 3 | Track D is a second session on Windows. |

### 3.4 Backend lead

1. Target: Track A runs up to two phases ahead of Track B (half a milestone), counting across milestone boundaries (M1 P3, M2 P0, M2 P1).
2. Floor: every A item a B cell depends on (section 4) is merged on `main`, dark behind its flag if unfinished (5.8), before the B consumer merges.
3. Cap: A may be at most two phases ahead of B's active phase, and never starts a phase whose P0 contracts have not merged. Beyond the cap A takes hardening, security tests or Core issues in B's current phase.
4. Because A leads, A's session normally owns each milestone's P0.

## 4 Milestone phase grids

Each grid is reproduced verbatim from spec 12. The table under it adds, per cell, the phase plan file and, per row, the gate, how it is verified, cross-track dependencies and sensitive work.

Plan file names, all under `docs/superpowers/plans/`:

- M0 and M1: `<date>-p0-contracts.md`, `<date>-track-<a|b>-p<n>.md` (the M0+M1 grid is one phase sequence, and Wave E fixed the first three names).
- M2 to M4: `<date>-m<k>-p0-contracts.md`, `<date>-m<k>-track-<a|b|d>-p<n>.md`. The milestone segment prevents collisions with M1 names.
- `<date>` is ISO `YYYY-MM-DD`, the day the plan is written (phase start). Core cells have no file of their own: their tasks sit in the named track plan (or the P0 plan).

"S" marks sensitive work (CLAUDE.md list): its issues carry the `sensitive` label, it is implemented on Opus 5.5 `medium`, and its PR needs the `sensitive-review` artifact (9.1).

### 4.1 M0 Skeleton and M1 Forms and terminal (spec 12.2)

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | Workspace skeleton; CI skeleton | Tokens skeleton; web shell scaffold | Config schema v1; audit catalogue with the query event schemas frozen (`submitted`, `acknowledged`, `sourceDispatched`, `sourceResponded`, `interrupted`, `partSkipped`); WS event schemas; OpenAPI skeleton | Typecheck and CI green; contracts frozen |
| P1 foundation | Docker secrets; encrypted SQLite; Better Auth + session limits + limiter, with the `loginSucceeded`, `loginFailed` and `logout` schemas; `/meta`; `/health`; locales route; WS heartbeat; image smoke; tunnel; release promote; `backup.sh` and `restore-test.sh` | Login screen; three theme modes; Playwright + axe + CSP check in CI | Rules engine + conditions | M0 exit: login live; heartbeat socket alive 10 min through the tunnel |
| P2 engine | Config load + validate CLI; `GET config`; policy function; idempotency; `POST queries` step-3 transaction with pending rows, per-request DEKs and audit | Generic field renderer; rules-driven form; shortcut engine | Canonicalisation; tokenize / parser / formatter; planner | Form works against `GET config`; parser property tests green |
| P3 flow | Mock adapter + fixture generator; `event_log`; WS `sourceStatus`; dispatch deadlines | Terminal UI; toggle with user-value draft; announcements; submit against real API | | M1 exit: A1 to A5 green; keyboard-only Playwright; live smoke |

| Phase | Plan files | Gate verified by | Cross-track dependencies | Sensitive (S) |
|---|---|---|---|---|
| P0 (M0) | All cells: `2026-09-25-p0-contracts.md`, one session. Order: workspace skeleton, CI skeleton (with the placeholder `apps/mobile` and the docs-only fast path, 11.2), contracts, tokens skeleton, web shell. | `pnpm verify` green on `main`; `ci` and `sensitive-review` jobs report on PRs; ruleset on `main` active (9.1); contract files merged; `docs/testing/stories.json` lists every M0 and M1 story; `scripts/ops/gh-setup-labels.sh` run. | none (single session) | CI skeleton and `.github/sensitive-paths`; audit catalogue |
| P1 (M0) | A: `2026-09-25-track-a-p1.md`. B: `2026-09-25-track-b-p1.md`. Core (rules engine): in B plan. | M0 row of 12.7: login smoke live; `smoke.sh --soak 10m` passes through the tunnel; auth limiter and lockout, WS upgrade rejections, log-capture tests green; axe on login; zero CSP violations; restore test; `docs/releases/m0.md`; promote `m0`. | B login e2e needs A: Better Auth routes, locales route, image boot smoke (CI steps 10 to 12). | A: secrets, encrypted SQLite, Better Auth and limiter, login audit schemas, WS upgrade checks, `promote.yml`, `backup.sh`, `restore-test.sh` |
| P2 (M1) | A: `<date>-track-a-p2.md`. B: `<date>-track-b-p2.md`. Core: canonicalisation and tokenize / parser / formatter in B plan; planner and the `validateSiteConfig` referential pass (4.1, needed by the validate CLI) in A plan. | Playwright: rules-driven form renders from live `GET /api/v1/config`; `packages/core/src/terminal/roundtrip.a5.test.ts` property tests green. | B rules-driven form needs Core P1 rules engine and A P2 `GET config`. A `POST queries` needs Core P2 canonicalisation and planner. | A: policy function, idempotency, step-3 transaction, DEKs, audit writes. Core: parser (terminal parser), planner (nested queries). |
| P3 (M1) | A: `<date>-track-a-p3.md`. B: `<date>-track-b-p3.md`. | M1 row of 12.7: A1 to A5 green and tagged; keyboard-only A1 and A4; route x caller matrix for config, queries, meta; unknown keys and hidden values rejected; `configHash` 409; axe in every scenario; live smoke; restore test; `docs/releases/m1.md`; promote `m1`. | B terminal UI needs Core P2 parser. B submit needs A P2 `POST queries`. Live smoke needs A P3 mock adapter and dispatch. A P3 output feeds B M2 P1 (lead). | A: mock adapter, `event_log`, `sourceStatus`, dispatch deadlines |

### 4.2 M2 Results and audit (spec 12.3)

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | | | ResponseMapping element union; `assessResult` signature; `resultHidden` and `resync` events; admin, ops and `sessionRevoked` audit schemas; OpenAPI for `GET queries`, admin audit and queries | Contracts frozen; OpenAPI diff reviewed |
| P1 feed | Replay by user seq with caps and `resync`; `GET queries` list and one, filtered by policy function and hidden rows; `Server-Timing`; ack-receipt metric | `packages/client` WS client with replay cursor and seq dedup; results list with per-source status; ack toast; correlation ID and ack time on each entry; announcer severity rules | Response mapper with precedence score and generic dump; `assessResult`; highlighter with `except` and Unicode boundaries | A6 green; socket-close-mid-dispatch replay test green |
| P2 audit | Sweeper with `sessionRevoked` on expiry (5.2); admin audit route with cursor paging, indexes, `auditViewed`, NDJSON export; `admin/queries` `includeHidden`; `scripts/ops/grant-role.ts`; `retention` config block; bearer REST + WS API tests | Summary/detail toggle; table elements (UX-016); severity badge with icon, text and colour on card, row and notification; admin audit viewer; terminal pane layout | `config:validate` resolves mapping paths against mock payloads | A7 to A9 green |
| P3 hardening | Security test matrix for M2 routes; backup restore test | Playwright STOLEN-in-detail-only test at 1024x768; type-while-result-arrives test; setOffline test | | M2 exit (12.7) |

| Phase | Plan files | Gate verified by | Cross-track dependencies | Sensitive (S) |
|---|---|---|---|---|
| P0 | Core: `<date>-m2-p0-contracts.md`, one session (normally A). | Contract files merged; `oasdiff` output reviewed in the PR; `stories.json` has A6 to A9. | none | admin, ops and `sessionRevoked` audit schemas |
| P1 | A: `<date>-m2-track-a-p1.md`. B: `<date>-m2-track-b-p1.md`. Core (mapper, `assessResult`, highlighter): in B plan. | `submit.a6.test.ts` and `a6-ack.spec.ts` green; `packages/api/test/feed/replay.test.ts` green. | B WS client needs A M1 P3 `sourceStatus` and A M2 P1 replay. B results list needs A M2 P1 `GET queries`. | A: hidden-row filtering on read (delete-from-view), ack-receipt metric (acknowledgment) |
| P2 | A: `<date>-m2-track-a-p2.md`. B: `<date>-m2-track-b-p2.md`. Core (`config:validate` mapping paths): in A plan. | A7, A8, A9 tagged tests green (10.2). | B admin audit viewer needs A P2 admin audit route. B severity badge needs Core P1 `assessResult`. | A: sweeper audit, admin audit route and export, `includeHidden`, `grant-role.ts` |
| P3 | A: `<date>-m2-track-a-p3.md`. B: `<date>-m2-track-b-p3.md`. | M2 row of 12.7: A6 to A9; no cross-user events; replay excludes hidden; admin-only audit routes; bearer REST + WS; NVDA + Chrome pass recorded; smoke; restore test; `docs/releases/m2.md`; promote `m2`. | B STOLEN test needs A M1 P3 `ZZ-0001` mock payload. | A: security matrix, restore test |

### 4.3 M3 Workflow and compliance (spec 12.4)

| Phase | Track A (Linux) | Track B (Windows) | Core | Gate |
|---|---|---|---|---|
| P0 contracts | | | `SiteConfig.delegation` and `auth` blocks; credential and delegation audit types; `credentialsMissing` / `credentialsRejected` statuses; `delegationChanged` event; OpenAPI for credentials, delegations, `results/hide` | Contracts frozen; `features` flags for credentials, delegation, hide off in shipped site config |
| P1 credentials and MFA | Envelope credential store with AAD and `key_version`; canary check and lost-key runbook; `secure_delete` + checkpoint; `GET` list and per source; `PUT`/`DELETE` with step-up; `mock_credential_state`; TOTP + `mfaRequired`; user disable transaction | Credentials settings; credential status on cards with deep link and "retry this source"; TOTP enrolment; step-up prompt | | B4 green; raw-bytes credential scan and log-capture tests green |
| P2 multi-source, nested, hide | Nested parts with children cap and `skipped`; per-source and global caps; `results/hide` with `deletedFromView`; crypto-shred `scripts/ops/purge.ts` | Per-part, per-source status; nested grouping under one correlation ID; multi-select delete from view with confirm; property form | Nested `evaluateForm` on mapped values; type-field picklist filtering for B7 | B1, B2, B5, B7 green |
| P3 delegation | Request / approve with code and QR; rate-limited redemption; fresh auth or TOTP on approve; session binding and `sessionEnded` revoke; override rule; list, revoke, `me/delegated-queries`; audit filter actor or owner | Trainee request dialog with QR; officer approve screen; persistent trainee banner; delegation list and revoke | | M3 exit (12.7); flags on |

| Phase | Plan files | Gate verified by | Cross-track dependencies | Sensitive (S) |
|---|---|---|---|---|
| P0 | Core: `<date>-m3-p0-contracts.md`, one session. | Contract files merged; `packages/config/sites/*.json` have `credentials`, `delegation`, `resultHide` false; `stories.json` has B1 to B5, B7. | none | credential and delegation audit types; `auth` block |
| P1 | A: `<date>-m3-track-a-p1.md`. B: `<date>-m3-track-b-p1.md`. | `change.b4.test.ts`, `raw-bytes.test.ts`, `log-capture.test.ts` green. | B credentials settings needs A P1 credential routes. B TOTP enrolment and step-up prompt need A P1 TOTP and step-up. | A: all cells. B: credentials settings form (credential entry). |
| P2 | A: `<date>-m3-track-a-p2.md`. B: `<date>-m3-track-b-p2.md`. Core: nested `evaluateForm` in A plan; type-field filtering in B plan. | B1, B2, B5, B7 tagged tests green. | B nested grouping needs A P2 nested parts. B delete from view needs A P2 `results/hide`. B property form needs Core P2 type-field filtering. | A: nested parts, caps, hide and `deletedFromView`, `purge.ts`. Core: nested `evaluateForm`. |
| P3 | A: `<date>-m3-track-a-p3.md`. B: `<date>-m3-track-b-p3.md`. | M3 row of 12.7: B1 to B5, B7; credential non-disclosure; step-up; delegation failures with audit rows; hide owner-only; NVDA + Chrome; smoke; restore test; flags turned on in a separate config PR; `docs/releases/m3.md`; promote `m3`. | B delegation UI needs A P3 delegation routes. | A: all cells. B: trainee request and officer approve (delegated credentials). |

### 4.4 M4 Mobile and host integration (spec 12.5)

| Phase | Track A (Linux) | Track B (Windows) | Track D (mobile) | Core | Gate |
|---|---|---|---|---|---|
| P0 contracts | Bearer session cold-start check | | Expo shell on `packages/client`; `rn-ui` skeleton | postMessage v1 message schemas, including `identityRequest` | `expo export` iOS and Android green; contracts frozen |
| P1 layouts and host | Better Auth Expo plugin with fallback; embedded-mode `IdentityService` (host JWT); `frame-ancestors` and CORS allowlists from deploy config | Mobile unit layout at 1024x768, 1366x768, 800x600; 7:1 day theme; orientation preference; 200% zoom and 320px reflow; iframe embed, postMessage v1 and `apps/host-simulator` | Login; query panel and condensed results on `rn-ui` | | C1 green on web; host-simulator Playwright test green |
| P2 native | Security tests for embedded identity | | Home-screen quick queries; OS autocomplete hints; font scaling to 2x; reduced motion; delete-from-view button; `announceForAccessibility`; Maestro flow | | C1 and C2 green on native |
| P3 exit | Backup restore test | Manual daylight check on the mobile unit theme | VoiceOver and TalkBack at largest text; Maestro results in `docs/releases/` | | M4 exit (12.7) |

| Phase | Plan files | Gate verified by | Cross-track dependencies | Sensitive (S) |
|---|---|---|---|---|
| P0 | All cells: `<date>-m4-p0-contracts.md`, one session. The A and D cells are small scaffold tasks inside it. | CI step 9 green for iOS and Android; postMessage schemas merged. | none (single session) | bearer cold-start check (session handling) |
| P1 | A: `<date>-m4-track-a-p1.md`. B: `<date>-m4-track-b-p1.md`. D: `<date>-m4-track-d-p1.md`. | `c1-mobile-unit.spec.ts` green at 1024x768, 1366x768, 800x600; host-simulator Playwright cases (6.9) green in CI with the simulator on its own origin. | B iframe embed and host simulator need A P1 embedded `IdentityService` and allowlists. D login needs A P1 Expo plugin. | A: all cells. B: host-simulator JWT signing and identity handoff. |
| P2 | A: `<date>-m4-track-a-p2.md`. D: `<date>-m4-track-d-p2.md`. B: no cell (B takes hardening or Later triage). | `quick-queries.c2.test.tsx` green; Maestro C1 and C2 flows pass on Expo Go, recorded. | D needs A P1 Expo plugin. | A: embedded identity security tests |
| P3 | A: `<date>-m4-track-a-p3.md`. B: `<date>-m4-track-b-p3.md`. D: `<date>-m4-track-d-p3.md`. | M4 row of 12.7: C1, C2; embedded JWT issuer, audience and JWKS rejections; frame-ancestors allowlist; VoiceOver + TalkBack at largest text; daylight check; smoke; restore test; `docs/releases/m4.md`; promote `m4`. | none new | A: restore test |

M4 deploy adds the host-simulator static container and its tunnel route to `host.querymodule.birchdesignlab.com` (6.9); Track A owns both.

### 4.5 Later (spec 12.6)

B6 add to supplemental, background push and FR-071 (C5), C3 and C4 scans, C6 voice spike, FR-045 aggregation spike, offline submit queue (NFR-003), audit hash chain.

No phase plans, no STATUS rows, no milestone. An item is scheduled only by an ADR that adds it to a milestone; that ADR PR adds the STATUS row. Ideas may be filed as issues with no milestone and no phase label.

### 4.6 Milestone exit ownership

The exit PR (`docs/release-m<k>`) is opened by whichever session reaches the exit gate second. Split of manual items:

| Item | Who | Where |
|---|---|---|
| `smoke.sh` against the live URL, `restore-test.sh` | Track A session, Linux | results in `docs/releases/m<k>.md` |
| NVDA + Chrome (M2, M3) | developer with Track B session, Windows | same file |
| VoiceOver + TalkBack, daylight check, Maestro (M4) | developer with Track D session | same file |
| `docs/site-config.md`, `docs/api.md`, `docs/demo.md` refresh (BR-005) | the exit PR author | exit PR |
| `gh workflow run promote.yml -f sha=<sha> -f milestone=m<k>` | developer, after the exit PR merges | Linux or Windows |

## 5 Three living artifacts and the balloon guard

### 5.1 Master grid: `docs/superpowers/plans/STATUS.md`

1. One table. Rows: milestone x phase. Columns: Track A | Track B | Track D | Core | Gate. Track D is `n/a` before M4.
2. Each cell is one line: status word (`planned` | `active` | `done` | `blocked`), link to the phase plan (plain file name until the plan exists), link to the GitHub issue filter for that cell. A `blocked` cell names the blocking issue.
3. Each track edits only its own column. The Core cell is edited by the session that merges the Core PR that changes its status. The Gate cell is edited by the session that verifies the gate.
4. Also holds: Active sessions (one row per machine and track) and Handoff notes (one subsection per track, overwritten, never appended).
5. Read at session start. Updated at session end, and inside any task PR that changes a cell status.

### 5.2 Backlog: GitHub Issues

1. One issue per task. No backlog files.
2. Labels (created by `scripts/ops/gh-setup-labels.sh`):

| Label | Meaning |
|---|---|
| `platform`, `web`, `core`, `mobile` | owning track (`mobile` = Track D) |
| `p0`, `p1`, `p2`, `p3` | phase |
| `sensitive` | touches a CLAUDE.md sensitive path; PR needs the `sensitive-review` artifact |
| `contract` | a contract-first PR (section 8) |
| `api-breaking` | PR label that lets `oasdiff breaking` pass (9.3); listed in release notes |

3. Milestones: `M0 Skeleton`, `M1 Forms and terminal`, `M2 Results and audit`, `M3 Workflow and compliance`, `M4 Mobile and host integration`.
4. Every issue has exactly one track label (or `core`), exactly one phase label and one milestone. Milestone plus phase plus track label is the cell filter in `STATUS.md`.
5. Issue title: `<what> (<IDs>)`, for example `Idempotency-Key admission (FR-064, SEC-014)`. Body: plan task reference, requirement and story IDs verbatim, tests to write first, `Blocked by #n` lines for cross-track dependencies, sensitive yes or no.
6. The session that writes a phase plan creates that plan's issues (`gh issue create`) and writes each issue number into its plan checkbox.
7. Claim by self-assignment. Close on merge through `Closes #n`. An issue assigned with no branch activity for 7 days may be reclaimed with a comment.

### 5.3 Decisions: ADRs in `docs/decisions/`

1. One numbered file per decision that changes spec v2 or picks between options it left open. Rules and template: `docs/decisions/README.md`, `docs/decisions/0000-template.md`.
2. Frontmatter: `date` (MM-DD-YY), `status`, `track`, `phase`, `supersedes`.
3. When an ADR overrides the spec, the same PR adds one line under the affected spec section: `Overridden by ADR-NNNN.` The spec is otherwise not edited.
4. Starts near-empty. Phase plans record task-level choices; only spec-level changes become ADRs.

### 5.4 Phase plans and the balloon guard

1. Phase plan: written at phase start, checkboxes ticked during the phase (inside task PRs), frozen at the gate with a line `Frozen: MM-DD-YY` under its title. Frozen plans are never edited; later corrections go to the next plan or an ADR.
2. Balloon guard: **no new tracking file without retiring one.** A PR that adds a tracking file names, in its description, the tracking file it deletes or freezes.
3. Tracking files today: `STATUS.md` (permanent), phase plans (one per grid cell, frozen at gate), `docs/superpowers/_wip/WAVES.md` (retires at Wave F with `_wip/`).
4. Not tracking files, so outside the guard: specs, ADRs, `docs/releases/*.md`, `docs/reviews/pr-*.md` (CI artifacts), `docs/testing/stories.json` (CI input), product docs.

## 6 Session protocol

A Claude Code session follows this list verbatim. `<t>` is the track letter (`a`, `b`, `d`, or `core` for a Core issue).

### 6.1 Start

1. Identify machine and track. Confirm no other session holds this track (Active sessions in `STATUS.md`; if a row says `running` on the other machine, stop and ask the developer).
2. `git switch main` then `git pull --ff-only`.
3. `pnpm install --frozen-lockfile` if `pnpm-lock.yaml` changed since the last session.
4. Read `STATUS.md`: your track's column, your Handoff note, the Gate cells of your current and next phase.
5. If your Handoff note names a branch or draft PR, go to 7.2 (resume) instead.
6. Read your track's active phase plan. If your next cell is `planned`, its inputs are met (section 4 dependencies, P0 merged) and no plan exists: write the phase plan (file name from section 4), create its issues (5.2), set the cell `active` in the same PR, and merge that PR before task work.

### 6.2 Claim

7. List open unassigned issues in your cell, for example `gh issue list --milestone "M1 Forms and terminal" --label platform --label p2 --state open --search "no:assignee"`. Include `--label core` issues whose default claimant (section 4) is your track.
8. Pick the lowest-numbered issue with no open `Blocked by`. If every issue is blocked, set your cell `blocked` naming the blocker and take work per 3.4 rule 3.
9. `gh issue edit <n> --add-assignee @me`.
10. `git switch -c feat/<t>-<n>` (for example `feat/a-42`, `feat/core-57`).

### 6.3 Build

11. State the model and effort plan before dispatching any agent (CLAUDE.md), then use:

| Role | Model and effort |
|---|---|
| Enumeration, grep, pulling IDs from the spec | Haiku 4.5, effort n/a |
| Implement one ordinary task (TDD) | Sonnet 5 `medium` |
| Implement one sensitive task (S) | Opus 5.5 `medium` |
| Spec-compliance review of one task (cites FR-, UX-, SEC- IDs) | Sonnet 5 `medium` |
| Code-quality review of one task | Sonnet 5 `high` |
| Verify or refute one claim; run the suite | Sonnet 5 `low` |
| Critic on every phase that builds UI or touches sensitive code | Opus 5.5 `medium` |
| Whole-branch review of a sensitive PR (writes `docs/reviews/pr-<n>.md`) | Opus 5.5 `xhigh` |
| Whole-phase review at the gate, ordinary phase | Opus 5.5 `high` |

12. TDD per task: write the failing test, run it and see the expected failure, implement, run green, refactor. Story tests carry `[A1]`-style tags in the title; core tests keep one `describe` per requirement ID where one maps (10.1).
12a. Subagents share one session scratchpad. Every agent in a fan-out gets its own scratch path in its prompt (`<scratchpad>/<runId>/<label>/`) and writes scratch only there; an agent producing one file writes it straight to its final repo path. Agents that edit repo files in parallel run in `isolation: 'worktree'` or own disjoint paths named in the prompt. A worktree is cheap for git but costs a `pnpm install` each, so use it for large parallel edits, not two-file changes.
13. Stay inside your track's paths (section 2). A needed contract change stops the task: open a `contract` issue (section 8) and mark this one `Blocked by` it.
14. Run `pnpm verify` (biome, `tsc -b`, vitest with coverage, `config:validate`, contract regeneration check). Track B and D also run `pnpm e2e` for touched flows.
15. In the same branch: tick the task's checkbox in the phase plan; update your `STATUS.md` cell only if its status changed.

### 6.4 Ship

16. Push the branch (the developer approves pushes, global CLAUDE.md) and open the PR: `gh pr create --title "<type>(<t>): <what> (#<n>)" --body-file <draft>`. Body: story IDs and requirement IDs verbatim, `Closes #<n>`, the test that failed first and now passes, sensitive yes or no, dependency PRs.
17. If the PR carries `sensitive`: run the Opus 5.5 `xhigh` whole-branch review; it writes `docs/reviews/pr-<PR number>.md` with front matter `{ reviewer: "opus-5.5", effort, reviewedSha, verdict: "approve" }`; fix findings first; commit the artifact; push. No sensitive-path file may change after `reviewedSha` (9.1).
18. `gh pr checks <PR> --watch` until `ci` and `sensitive-review` are green.
19. Squash merge: `gh pr merge <PR> --squash --delete-branch`. Self-merge is allowed; a sensitive PR merges only once `sensitive-review` passes on its artifact.
20. Confirm the issue closed (`gh issue view <n>`). `git switch main`, `git pull --ff-only`.

### 6.5 Close out

21. More open issues in your cell: back to step 7.
22. Cell empty: set your cell `done` (small `docs/status-<t>-<yyyymmdd>` PR, or inside the last task PR).
23. Gate check: if every cell in the row is `done`, verify the gate (section 4 "Gate verified by"), run the whole-phase review, then in one PR: set Gate `done`, add `Frozen: MM-DD-YY` to each phase plan of the row. A milestone exit gate also follows 4.6.
24. Next phase: if its inputs are met, go to step 6 and open the next phase plan. Otherwise take work per 3.4.
25. Ending the session: follow 7.1.

## 7 Pause and resume

### 7.1 Pause (end of any session)

1. Never leave uncommitted work. Either finish and merge the task, or commit it to its branch with message `wip: <state>` and push it as a draft PR (`gh pr create --draft`), with the developer's OK to push.
2. Update `STATUS.md` in a `docs/status-<t>-<yyyymmdd>` PR and merge it, so the other machine sees it on `main`:
   - Active sessions row: state `paused`, current phase, last update `MM-DD-YY HH:mm`.
   - Your track's Handoff note, overwritten, with exactly these lines:

```
- Issue: #<n> <title>
- Branch / PR: feat/<t>-<n> / #<pr> (draft) or none
- Last green: `pnpm verify` at <short sha> on <branch>
- Next step: <the next unchecked checkbox in the phase plan, quoted>
- Blocked by: #<n> or none
- Local-only state: none, or what must be recreated (e.g. `pnpm dev` seed)
- Notes: one line, or none
```

3. Do not leave notes anywhere else (balloon guard). Conversation context does not survive; only `main`, branches, issues and PRs do.

### 7.2 Resume (any machine)

1. `git switch main`, `git pull --ff-only`, `pnpm install --frozen-lockfile`.
2. Read `STATUS.md` Active sessions and your track's Handoff note.
3. On the other machine: confirm the remaining work needs no Docker or deploy access (section 2 rule 1); if it does, stop and leave it for Linux.
4. `gh pr checkout <pr>` (or `git switch feat/<t>-<n>`), then `git pull origin main` to merge `main` in. No rebase; the squash merge flattens history.
5. `pnpm verify`. Confirm it matches "Last green", then continue at "Next step".
6. Set your Active sessions row to `running` and clear the Handoff note in your next PR.

## 8 Contract change procedure

### 8.1 Steps

1. Open an issue labelled `contract`, `core`, the requesting track's label, the phase label and the milestone. Title `Contract: <what> (<IDs>)`. Body: consumers on each track, the change, additive or breaking, affected audit or event types.
2. The task that needs it is marked `Blocked by #<contract issue>`.
3. Branch `feat/core-<n>`. The PR touches contract files only (8.2), with tests. No handler, adapter, store or UI code.
4. Tests: every new or changed schema has parse and reject cases; audit `details` stay additive-only (a field may be added as optional, never removed or retyped, 4.7); a `SiteConfig` breaking change bumps `CONFIG_SCHEMA_VERSION` and adds a `migrateConfig` step with its own test (5.8).
5. Regenerate derived files with `pnpm contracts:gen` and commit them; CI step 7 fails on any drift. A breaking OpenAPI change needs the `api-breaking` label and a release-note line.
6. Audit, credential, dispatch or parser schemas add the `sensitive` label and the review artifact (6.4 step 17).
7. Merge. Each track merges `main` into its open branches (`git pull origin main`). Implementation follows in separate PRs.

### 8.2 Contract files

| File | Content |
|---|---|
| `packages/core/src/contracts/**` | Zod schemas and inferred types: API request and response bodies, route definitions, WS messages, postMessage v1, audit event `details`, `ApiError`, version constants (4.7) |
| `packages/core/src/config/**` schema files | `SiteConfig`, `ClientSiteConfig`, `FEATURES`, `migrateConfig` steps (4.1, 5.8) |
| `packages/api/openapi.json` | generated; Core-owned carve-out inside `packages/api` |
| `packages/core/contracts/ws-events.schema.json` | generated (9.3 step 7) |
| `packages/config/schema/site-config.schema.json` | generated, shape only (4.1) |
| `packages/config/sites/*.json`, `packages/config/test/*.json` | only the edits needed to keep configs valid, or to set `features` flags |
| `docs/testing/stories.json` | story rows for the milestone |

Route definitions (method, path, request and response schemas, access, `x-feature`) live in core so a route's contract can merge before its handler. The generator that writes `openapi.json` is Track A code (`scripts/ci/`). The M0 P0 plan settles how the route x caller matrix (10.3) treats a route whose contract has merged but whose handler has not; if that needs an OpenAPI extension beyond `x-feature` and `x-requires`, it is ADR 0001.

### 8.3 Why this is safe

1. `packages/core` is pure: no IO, no network, no storage. A contract PR cannot change runtime behaviour of a deployed process on its own.
2. Core carries a 95% line and branch threshold (10.5) and every schema has tests.
3. `tsc -b` compiles every consumer against the new contract in the same CI run, so a break shows up in the contract PR, not in the other track's next task.
4. Generated OpenAPI and WS schema diffs are visible in the PR and gated by `oasdiff`.
5. After P0 the contracts are "frozen": they still change, but only through this procedure, one change per PR.

## 9 Machine setup

Root scripts are the interface between machines. The M0 P0 workspace skeleton creates them; they must run identically in PowerShell and bash (Node scripts, no shell-specific syntax):

| Script | Does |
|---|---|
| `pnpm dev` | API on `http://localhost:3000` plus Vite on `http://localhost:5173`, default site, `ALLOW_MOCK_SOURCES=true`, `NODE_ENV=development`. First run creates random dev secret files in `.dev/secrets/` and the encrypted SQLite file `.dev/dev.db` (both gitignored), seeds demo users and prints their passwords once. Delete `.dev/` to reset. |
| `pnpm dev:api`, `pnpm dev:web` | each half alone |
| `pnpm verify` | `biome ci`, `tsc -b`, `vitest run --coverage`, `config:validate`, contract regeneration check |
| `pnpm contracts:gen` | regenerate the derived contract files (8.2) |
| `pnpm e2e` | Playwright + axe against a local production build served by the API |
| `pnpm image:smoke` | Linux only: CI steps 10 to 12 locally (build image, boot on a temp volume, check triggers, Playwright `@smoke`) |

### 9.1 Linux laptop (Track A, deploy host)

Assumes Ubuntu 24.04 LTS.

Base tools and Node 24 LTS per ADR-0001 (version pinned by `.nvmrc`; pnpm pinned by `packageManager` in root `package.json`):

```bash
sudo apt-get update
sudo apt-get install -y git curl wget ca-certificates gnupg openssl age rclone unzip
curl -fsSL https://fnm.vercel.app/install | bash
exec "$SHELL"
fnm install 24 && fnm default 24
corepack enable
git config --global core.autocrlf input
```

Docker Engine and the compose plugin:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker compose version
```

GitHub CLI:

```bash
wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
sudo apt-get update && sudo apt-get install -y gh
gh auth login
```

Clone and run the API locally (no Docker needed for development):

```bash
mkdir -p ~/git && cd ~/git
gh repo clone BirchDesignLab/queryModule && cd queryModule
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
pnpm image:smoke        # from M0 P1
```

Secrets as files (8.2). Outside the repo, never on `/data`, never in `.env`. The app container runs as uid 10001, so its secret files are owned by that uid:

```bash
sudo install -d -m 700 /opt/querymodule/secrets
for k in DB_ENCRYPTION_KEY CREDENTIAL_KEY DATA_KEY BETTER_AUTH_SECRET SEED_PASSWORD_SECRET; do
  openssl rand -base64 32 | sudo tee "/opt/querymodule/secrets/$k" >/dev/null
done
sudo chown 10001:10001 /opt/querymodule/secrets/{DB_ENCRYPTION_KEY,CREDENTIAL_KEY,DATA_KEY,BETTER_AUTH_SECRET,SEED_PASSWORD_SECRET}
sudo chmod 400 /opt/querymodule/secrets/*
```

1. Copy `DB_ENCRYPTION_KEY`, `CREDENTIAL_KEY` and `DATA_KEY` to offline storage off the laptop, never beside backups (8.2). They are the only recovery path.
2. Cloudflare tunnel token (developer, in the Cloudflare dashboard: Zero Trust, Networks, Tunnels, create tunnel, public hostname `querymodule.birchdesignlab.com` to `http://app:3000`). Save the token without echoing it: `sudo sh -c 'umask 077; cat > /opt/querymodule/secrets/TUNNEL_TOKEN'`, paste, Ctrl+D. Then give it to the cloudflared image user: `sudo chown 65532:65532 /opt/querymodule/secrets/TUNNEL_TOKEN` (verify the uid with `docker image inspect cloudflare/cloudflared --format '{{.Config.User}}'`).
3. GHCR read token for the deploy-pull timer (ADR-0002; developer creates a fine-grained PAT with read packages only): `sudo install -d -m 700 /opt/querymodule/ghcr` then `sudo DOCKER_CONFIG=/opt/querymodule/ghcr docker login ghcr.io -u <github-user> --password-stdin` and paste the token.
4. Backups: `rclone config` (remote for the R2 bucket), and put only the `age` recipient public key on the laptop; `age-keygen` runs on another machine.

Deploy (from M0 P1, when `deploy/` exists):

```bash
cd ~/git/queryModule/deploy
cp .env.example .env          # set PUBLIC_ORIGIN; SITE_CONFIG unset; ALLOW_MOCK_SOURCES=true on the demo host
docker compose pull
docker compose up -d
docker compose run --rm app node scripts/ops/seed.js    # once, empty DB; store printed passwords in a password manager
bash ../scripts/ops/smoke.sh https://querymodule.birchdesignlab.com
sudo cp systemd/querymodule-backup.service systemd/querymodule-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now querymodule-backup.timer
```

Promote and roll back (8.4): `gh workflow run promote.yml -f sha=<full sha> [-f milestone=m<k>]`, `gh run watch`, wait for the deploy-pull timer (at most five minutes), then `bash scripts/ops/smoke.sh https://querymodule.birchdesignlab.com`. Rollback is the same command with an older sha.

### 9.2 Windows 11 (Track B, Track D from M4)

PowerShell. No Docker needed: the real API runs locally with `pnpm dev` on SQLite.

```powershell
winget install --id Git.Git -e
winget install --id Schniz.fnm -e
winget install --id GitHub.cli -e
# open a new PowerShell window, then:
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force | Out-Null }
Add-Content $PROFILE 'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression'
. $PROFILE
fnm install 24; fnm default 24
corepack enable
git config --global core.autocrlf false
gh auth login
Set-Location C:\git
gh repo clone BirchDesignLab/queryModule
Set-Location C:\git\queryModule
pnpm install --frozen-lockfile
```

Run and test:

```powershell
pnpm dev                                              # real API on :3000 (SQLite in .dev\), Vite on :5173
pnpm --filter ./apps/web exec playwright install chromium
pnpm verify
pnpm e2e
bash scripts/ops/gh-setup-labels.sh                   # Git Bash is on PATH after Git install
```

`core.autocrlf false` relies on `.gitattributes` (`* text=auto eol=lf`) from the P0 skeleton. Windows Firewall may prompt for Node on first `pnpm dev`; allow private networks only.

Expo Go (Track D, from M4):

1. Install Expo Go on the phone from its app store. Keep its SDK in lockstep with `apps/mobile` (14).
2. Phone and laptop on the same private Wi-Fi.
3. `$env:EXPO_PUBLIC_API_URL = "http://<windows-lan-ip>:3000"; pnpm --filter ./apps/mobile exec expo start`, then scan the QR code. If the LAN blocks it: `pnpm --filter ./apps/mobile exec expo start --tunnel`.
4. Maestro flows (`apps/mobile/maestro/`) run manually per release (10.7).

## 10 Definition of done

### 10.1 Per task

1. A test was written first and seen failing; the PR body names it.
2. Story tests carry the story tag (`[A1]`) and appear in `docs/testing/stories.json`; requirement IDs appear verbatim in the PR body and, for core, in `describe` names.
3. Security tests from 10.3 exist for any route or feature this task introduces.
4. From M1, every Playwright scenario touched runs axe and passes (no serious or critical violations); from M0, zero CSP violations.
5. Coverage thresholds hold (10.5): 100% branches in `packages/api/src/{audit,credentials,delegation,dispatch}`, core 95%, API 85%, client 85%.
6. `pnpm verify` green locally; `ci` and `sensitive-review` green on the PR.
7. Unfinished capability merged dark behind its `features` flag (5.8).
8. Fixtures follow the fixture policy (5.4); nothing resembles a real person, vehicle or property record.
9. When the task creates the first file of a sensitive area, the same PR adds its path to the CLAUDE.md sensitive list and to `.github/sensitive-paths`.
10. Phase plan checkbox ticked; `STATUS.md` cell updated if its status changed; issue closed by the merge.

### 10.2 Per phase

1. Every issue in the row closed.
2. Gate verified on `main` as written in section 4.
3. Whole-phase review done (Opus 5.5 `high`, or `xhigh` if the phase has sensitive work); findings fixed or filed as issues in the next phase.
4. Opus critic ran on any phase that built UI or touched sensitive code.
5. Every deviation from spec v2 has an ADR.
6. Phase plans frozen; Gate cell `done`.
7. Exit phases also: everything in 12.7 and 4.6, including `docs/releases/m<k>.md`, docs refresh, smoke, restore test and promote.

## 11 Risks to the concurrency model

| Risk | Mitigation |
|---|---|
| Lockfile conflicts: both tracks add dependencies | Dependency additions go in their own `chore/deps-<name>` PR, merged before the task that uses them. Never hand-resolve `pnpm-lock.yaml`: take `main`'s copy, run `pnpm install`, commit. Merge Dependabot PRs at session start, not mid-task. |
| Shared root files edited on both machines | Section 2 rule 5: root files change only in their own `chore/` PR. Root scripts are fixed in M0 P0 (section 9). |
| Core barrel file conflicts (`index.ts` edited by both tracks) | Core exposes subpath exports per module (`@querymodule/core/rules`, `/terminal`, `/contracts`), set up in M0 P0; no shared barrel. |
| `STATUS.md` conflicts: a row holds both tracks' cells on one line | Status edits are small and frequent. On conflict take `main`'s file and re-apply only your own cell. Handoff notes are per-track subsections, so they never share a line. |
| `stories.json` edited by both tracks | Each milestone's P0 writes every story row with its test paths from 10.2; tracks only add paths later. |
| Drift between machines: Node, pnpm, line endings, native binaries | `.nvmrc` plus `engines` and `engine-strict`; `packageManager` pins pnpm through corepack; `--frozen-lockfile` everywhere; `.gitattributes` `eol=lf`; libSQL prebuilt binaries for win32-x64 and linux-x64 both exercised (Windows by `pnpm dev`, Linux by CI). CI on `ubuntu-latest` is the authority when local results differ. |
| Local e2e on Windows differs from CI (no image) | `pnpm e2e` runs against a production build served by the API, the closest non-Docker equivalent; `@smoke` against the image runs in CI and in `pnpm image:smoke` on Linux. |
| Docs-only PRs (`STATUS.md`, handoff, ADRs) wait on the full pipeline | M0 P0 CI skeleton includes a changed-paths check: when only `docs/**` or `*.md` changed, heavy steps skip but `ci` and `sensitive-review` still report, so the ruleset is satisfied. |
| Backend lead drifts: A builds far ahead against contracts B has not exercised | Lead cap in 3.4; contracts change only through section 8; A's routes are exercised by API tests validated against the response schemas (10.1). |
| Two sessions take the same track, or the same issue | Active sessions row checked at start (6.1 step 1); claim by assignment before branching (6.2 step 9). |
| ADR number collision from parallel PRs | Take the next free number at branch time; on conflict the later PR renumbers before merge. |
| Sensitive-review bottleneck (Opus `xhigh` per sensitive PR) | Keep sensitive PRs small, one task each; non-sensitive work in the same cell proceeds while a review runs. |
| Push discipline versus the global "ask before push" rule | Pushes happen only at 6.4 step 16, 7.1 step 1 and status PRs; the session asks the developer each time. |
| Node runtime drift | ADR-0001 pins Node 24 LTS; P0 verifies `expo export` and `@libsql/client` on 24. A later major needs a new ADR plus one `chore/` PR updating `.nvmrc`, `engines` and the image base. |
| Lost context between sessions | State lives only in `main`, issues, PRs and the Handoff note (7.1); plans are frozen at gates, so a fresh session trusts them. |
