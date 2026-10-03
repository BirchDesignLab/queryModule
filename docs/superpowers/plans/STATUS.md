# Status

Master grid for Query Module 2.0. Process: `2026-09-25-implementation-master-plan.md` (sections 5 to 7).
Read at session start. Update at session end, and in any task PR that changes a cell. Each track edits only its own column.

## Legend

- Status words: `planned` | `active` | `done` | `blocked` (name the blocking issue). `next` marks the phase to start first.
- Plan: a link once the phase plan exists; until then its future file name in code text. `<date>` is ISO `YYYY-MM-DD`, the day the plan is written.
- `issues`: GitHub issue filter for that cell (milestone + phase label + track label). Gate `all`: every issue in the phase.
- `n/a`: no cell in the spec 12 grid. Track D starts at M4.
- P0 is one session: its Track A, Track B and Core cells share one plan.

## Grid

| Milestone | Phase | Track A (Linux) | Track B (Windows) | Track D (mobile) | Core | Gate |
|---|---|---|---|---|---|---|
| M0 | P0 contracts | done · [plan](2026-09-25-p0-contracts.md) · [issues][m0-p0] | done · [plan](2026-09-25-p0-contracts.md) · [issues][m0-p0] | n/a | done · [plan](2026-09-25-p0-contracts.md) · [issues][m0-p0] | done · Typecheck and CI green; contracts frozen · [all][m0-p0] |
| M0 | P1 foundation | done · [plan](2026-09-25-track-a-p1.md) · [issues][m0-p1-a] | done · [plan](2026-09-25-track-b-p1.md) · [issues][m0-p1-b] | n/a | done · in B plan · [issues][m0-p1-c] | done · M0 exit · [all][m0-p1] |
| M1 | P2 engine | done · [plan](2026-09-28-track-a-p2.md) · [issues][m1-p2-a] | done · [plan](2026-09-28-track-b-p2.md) · [issues][m1-p2-b] | n/a | done · in A and B plans · [issues][m1-p2-c] | done · Form on `GET config`; parser property tests · [all][m1-p2] |
| M1 | P3 flow | active · [plan](2026-09-29-track-a-p3.md), UI-first re-plan (ADR-0011, ADR-0012); AC0, client-only builder and preview, design system and cloud pass done (#384 to #446); next AC1 (#349, #350) · [issues][m1-p3-a] | active · [plan](2026-09-29-track-b-p3.md), UI-first re-plan (ADR-0012); waves B1 to B8, design system and cloud pass done (#344 to #446); open #377, #382 · [issues][m1-p3-b] | n/a | n/a | planned · M1 exit (v1 demo, ADR-0012); needs AC1, AC2 and the core-loop e2e (#362) · [all][m1-p3] |
| M2 | P0 contracts | n/a | n/a | n/a | planned · `<date>-m2-p0-contracts.md` · [issues][m2-p0] | planned · Contracts frozen; OpenAPI diff reviewed · [all][m2-p0] |
| M2 | P0.5 dispatch (ADR-0012) | planned · `<date>-m2-track-a-p0-5.md` · [issues][m2-p05-a] | planned · `<date>-m2-track-b-p0-5.md` · [issues][m2-p05-b] | n/a | n/a | planned · A4 clean no-record; smoke 1 to 5 · [all][m2-p05] |
| M2 | P1 feed | planned · `<date>-m2-track-a-p1.md` · [issues][m2-p1-a] | planned · `<date>-m2-track-b-p1.md` · [issues][m2-p1-b] | n/a | planned · in B plan · [issues][m2-p1-c] | planned · A6; replay test · [all][m2-p1] |
| M2 | P2 audit | planned · `<date>-m2-track-a-p2.md` · [issues][m2-p2-a] | planned · `<date>-m2-track-b-p2.md` · [issues][m2-p2-b] | n/a | planned · in A plan · [issues][m2-p2-c] | planned · A7 to A9 · [all][m2-p2] |
| M2 | P3 hardening | planned · `<date>-m2-track-a-p3.md` · [issues][m2-p3-a] | planned · `<date>-m2-track-b-p3.md` · [issues][m2-p3-b] | n/a | n/a | planned · M2 exit · [all][m2-p3] |
| M3 | P0 contracts | n/a | n/a | n/a | planned · `<date>-m3-p0-contracts.md` · [issues][m3-p0] | planned · Contracts frozen; flags off · [all][m3-p0] |
| M3 | P1 credentials and MFA | planned · `<date>-m3-track-a-p1.md` · [issues][m3-p1-a] | planned · `<date>-m3-track-b-p1.md` · [issues][m3-p1-b] | n/a | n/a | planned · B4; raw-bytes and log-capture · [all][m3-p1] |
| M3 | P2 multi-source, nested, hide | planned · `<date>-m3-track-a-p2.md` · [issues][m3-p2-a] | planned · `<date>-m3-track-b-p2.md` · [issues][m3-p2-b] | n/a | planned · in A and B plans · [issues][m3-p2-c] | planned · B1, B2, B5, B7 · [all][m3-p2] |
| M3 | P3 delegation | planned · `<date>-m3-track-a-p3.md` · [issues][m3-p3-a] | planned · `<date>-m3-track-b-p3.md` · [issues][m3-p3-b] | n/a | n/a | planned · M3 exit; flags on · [all][m3-p3] |
| M4 | P0 contracts | planned · `<date>-m4-p0-contracts.md` · [issues][m4-p0] | n/a | planned · `<date>-m4-p0-contracts.md` · [issues][m4-p0] | planned · `<date>-m4-p0-contracts.md` · [issues][m4-p0] | planned · `expo export` green; contracts frozen · [all][m4-p0] |
| M4 | P1 layouts and host | planned · `<date>-m4-track-a-p1.md` · [issues][m4-p1-a] | planned · `<date>-m4-track-b-p1.md` · [issues][m4-p1-b] | planned · `<date>-m4-track-d-p1.md` · [issues][m4-p1-d] | n/a | planned · C1 on web; host-simulator test · [all][m4-p1] |
| M4 | P2 native | planned · `<date>-m4-track-a-p2.md` · [issues][m4-p2-a] | n/a | planned · `<date>-m4-track-d-p2.md` · [issues][m4-p2-d] | n/a | planned · C1 and C2 on native · [all][m4-p2] |
| M4 | P3 exit | planned · `<date>-m4-track-a-p3.md` · [issues][m4-p3-a] | planned · `<date>-m4-track-b-p3.md` · [issues][m4-p3-b] | planned · `<date>-m4-track-d-p3.md` · [issues][m4-p3-d] | n/a | planned · M4 exit · [all][m4-p3] |

## Active sessions

| Machine | Track | Current phase | State | Last update |
|---|---|---|---|---|
| Linux laptop | Host lane (host steps only) | M1 P3 | idle (15b83d2 promoted, smoke green) | 09-30-26 |
| Windows 11 | B (`C:\git\queryModule`) | M1 P3 | paused | 10-01-26 14:38 |
| Windows 11 | A (`C:\git\queryModule-a4`; M1 finish, single session, no A/B lanes or manager) | M1 P3 | paused (next: AC2) | 10-03-26 06:54 |
| Windows 11 | Checker (`C:\git\queryModule-checker-p3`) | M1 P3 | running | 10-01-26 14:38 |
| Cloud (claude.ai/code) | UI lanes, ordinary tier only | M1 P3 | paused until AC2 | 09-30-26 |

From M4 add a row: Windows 11, D. State is `running`, `paused` or `idle`; time as `MM-DD-YY HH:mm`.

## Handoff notes

Overwrite your track's note at pause using the seven-line format in the master plan 7.1; clear it on resume.

### Track A

- Issue: #351 Admin config API (Task 27), then #352 (Task 28), #353 (Task 29): wave AC2
- Branch / PR: none (AC2 not started); AC1 #498, AM1 #500, chore #501 merged
- Last green: `pnpm verify` at 48f17eb (#500) on Windows
- Next step: rule the Task 28 forced-password-change mechanism, then AC2 briefs and one sdd-wave (Tasks 27 critical, 28 gate, 29 critical behaviour)
- Blocked by: none
- Local-only state: `.superpowers/sdd/track-a-p3/handover.md` (start brief), `progress.md` ledger
- Notes: M1 finishes as one session (developer 10-02-26). AC2 carries #497 C-m1 (migration 0008), the #351 comment (MFA refusal, configPublished, supersede first) and signInCount, lastSignInAt, distinctIps on the admin user list. Then AC3, #377, M1 exit (ADR-0012, Task 17).

### Track B

- Issue: #377 Terminal test minors from B2 and AX reviews
- Branch / PR: none
- Last green: `pnpm verify` at d2450cd on main
- Next step: #377 on a local session (critical tier); #382's remaining minors after it
- Blocked by: none
- Local-only state: none
- Notes: the cloud UI lanes (#418 to #446) are paused until AC2; their handover briefs are in the M1P3 MANAGER 3 chat.

### Track D

[m0-p0]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M0+Skeleton%22+label%3Ap0
[m0-p1]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M0+Skeleton%22+label%3Ap1
[m0-p1-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M0+Skeleton%22+label%3Ap1+label%3Aplatform
[m0-p1-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M0+Skeleton%22+label%3Ap1+label%3Aweb
[m0-p1-c]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M0+Skeleton%22+label%3Ap1+label%3Acore
[m1-p2]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M1+Forms+and+terminal%22+label%3Ap2
[m1-p2-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M1+Forms+and+terminal%22+label%3Ap2+label%3Aplatform
[m1-p2-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M1+Forms+and+terminal%22+label%3Ap2+label%3Aweb
[m1-p2-c]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M1+Forms+and+terminal%22+label%3Ap2+label%3Acore
[m1-p3]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M1+Forms+and+terminal%22+label%3Ap3
[m1-p3-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M1+Forms+and+terminal%22+label%3Ap3+label%3Aplatform
[m1-p3-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M1+Forms+and+terminal%22+label%3Ap3+label%3Aweb
[m2-p0]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap0
[m2-p05]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap0-5
[m2-p05-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap0-5+label%3Aplatform
[m2-p05-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap0-5+label%3Aweb
[m2-p1]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap1
[m2-p1-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap1+label%3Aplatform
[m2-p1-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap1+label%3Aweb
[m2-p1-c]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap1+label%3Acore
[m2-p2]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap2
[m2-p2-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap2+label%3Aplatform
[m2-p2-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap2+label%3Aweb
[m2-p2-c]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap2+label%3Acore
[m2-p3]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap3
[m2-p3-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap3+label%3Aplatform
[m2-p3-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M2+Results+and+audit%22+label%3Ap3+label%3Aweb
[m3-p0]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap0
[m3-p1]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap1
[m3-p1-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap1+label%3Aplatform
[m3-p1-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap1+label%3Aweb
[m3-p2]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap2
[m3-p2-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap2+label%3Aplatform
[m3-p2-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap2+label%3Aweb
[m3-p2-c]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap2+label%3Acore
[m3-p3]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap3
[m3-p3-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap3+label%3Aplatform
[m3-p3-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M3+Workflow+and+compliance%22+label%3Ap3+label%3Aweb
[m4-p0]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap0
[m4-p1]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap1
[m4-p1-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap1+label%3Aplatform
[m4-p1-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap1+label%3Aweb
[m4-p1-d]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap1+label%3Amobile
[m4-p2]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap2
[m4-p2-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap2+label%3Aplatform
[m4-p2-d]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap2+label%3Amobile
[m4-p3]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap3
[m4-p3-a]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap3+label%3Aplatform
[m4-p3-b]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap3+label%3Aweb
[m4-p3-d]: https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+milestone%3A%22M4+Mobile+and+host+integration%22+label%3Ap3+label%3Amobile
