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
| M1 | P3 flow | done · [plan](2026-09-29-track-a-p3.md), UI-first re-plan (ADR-0011, ADR-0012); waves AC0 to AC3 and the M1 exit notes (`docs/releases/m1.md`) · [issues][m1-p3-a] | done · [plan](2026-09-29-track-b-p3.md), UI-first re-plan (ADR-0012); waves B1 to B8, design system and cloud pass (#344 to #446); wave B6 parked to M2 P0.5 · [issues][m1-p3-b] | n/a | n/a | done · M1 exit (v1 demo, ADR-0012): #517, `m1` promoted 10-04-26 (manual m1 smoke held until the next host visit, #237) · [all][m1-p3] |
| M2 | P0 contracts | n/a | n/a | n/a | active (P0-W3 after the demo; P0-W1 #559 and P0-W2 #562 merged) · [plan](2026-10-05-m2-p0-contracts.md), run in the B lane · [issues][m2-p0] | active · demo-path gate passed 10-05-26 (#528: verify on main, 8.4 log, oasdiff additive); full gate after P0-W3 · [all][m2-p0] |
| M2 | P0.5 dispatch (ADR-0012) | active · [plan](2026-10-05-m2-track-a-p0-5.md); AW1 #563, AW2 #567, AW3 #569 and AW4 #575 merged, AW5 (Tasks 14 to 16) running · [issues][m2-p05-a] | active · [plan](2026-10-05-m2-track-b-p0-5.md); BW0 demo prep in PR, BW1 design approved 10-05-26 · [issues][m2-p05-b] | n/a | n/a | planned · A4 clean no-record; smoke 1 to 5 · [all][m2-p05] |
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
| Linux laptop (deploy host) | Host lane (host steps only) | M1 exit | idle (`m1` promoted 10-04-26; manual m1 smoke held until the next visit) | 10-04-26 |
| Windows 11 | A (`C:\git\queryModule-a`) | M2 P0.5 dispatch | running (wave AW5, session "M2P0 Track A3") | 10-06-26 01:30 |
| Windows 11 | B (`C:\git\queryModule`) | M2 P0.5 B (BW0) | running (session "M2P0 Track B2") | 10-05-26 17:10 |
| Windows 11 | Manager (`C:\git\queryModule-checker`, detached) | M2 | idle (start brief from "M2 planning 1") | 10-05-26 |
| Windows 11 | Planning (`C:\git\queryModule-a4`, "M2 planning 1") | M2 P0 and P0.5 plans | done (#557 merged) | 10-05-26 |

From M4 add a row: Windows 11, D. State is `running`, `paused` or `idle`; time as `MM-DD-YY HH:mm`.

## Handoff notes

Overwrite your track's note at pause using the seven-line format in the master plan 7.1; clear it on resume.

### Track A

- Issue: M2 P0.5 Track A Tasks 14 (#541), 15 (#542), 16 (#543), wave AW5
- Branch / PR: `feat/m2-a-p05-wave-5` (from `main` at 8a9b27b), no PR yet; AW1 #563, AW2 #567, AW3 #569, AW4 #575 merged
- Last green: `pnpm verify` at dcab066 (AW4) on Windows
- Next step: Tasks 14 and 15 (sdd-wave), Task 16 inline, then a gate wave-review; AW4 review minors on #574 (not in AW5)
- Blocked by: none
- Local-only state: `C:\git\queryModule-a\.superpowers\sdd\2026-10-05-m2-track-a-p0-5\handover.md` (Task 8 carries, run ids, lessons)
- Notes: developer target 10-04-26: mock responses working, then a demo pause at the M2 P1 gate.

### Track B


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
