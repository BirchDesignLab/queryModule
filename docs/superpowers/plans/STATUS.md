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
| M2 | P0 contracts | n/a | n/a | n/a | done · P0-W1 #559, P0-W2 #562, P0-W3 #688 merged (Tasks 4, 5, 6 and #622) · [plan](2026-10-05-m2-p0-contracts.md), run in the B lane · [issues][m2-p0] | done · demo-path gate 10-05-26; full gate 10-16-26 (#528): contracts frozen, 8.4 log rows for every P0 contract change, oasdiff 0 ERR (info only), verify green · [all][m2-p0] |
| M2 | P0.5 dispatch (ADR-0012) | done · [plan](2026-10-05-m2-track-a-p0-5.md); AW1 #563 to AW6 #581 and the release note #582 merged · [issues][m2-p05-a] | done · [plan](2026-10-05-m2-track-b-p0-5.md); BW0 #566 to BW3 #579 merged · [issues][m2-p05-b] | n/a | n/a | done · A4 clean no-record; smoke 1 to 5 ok on the host 10-07-26; `:release` promoted at 3e85c2b (#583, no milestone tag; fe47c0f is the release note merge) · [all][m2-p05] |
| M2 | P1 feed | done, awaiting promote · [plan](2026-10-07-m2-track-a-p1.md): AW1 #611, AW2 #618, AW3 #621, AW4a #646, AW4b #655 (release note, gate, design brief PDF) and follow-ups merged (#576 contract, shared mock matcher, GET queries, replay, replay gate test, smoke step 4); since #655: fixture policy non-Latin digits #657, demo scenario pack and seed #661, keyboard-only dry run #663, demo docs fixes #664, brief refreshes #662 #666, and the overview PDF refresh (docs/m2-overview-pdf) · [issues][m2-p1-a] | done · [plan](2026-10-07-m2-track-b-p1.md): BW0 #619, BW2 #634, #635, BW3 #641 and the polish PR #654 merged (result cards, builder card and keyword editors, Try a match, replay cursor); since #655: Edit as new query #658 and on every row #672, mockup gaps #659, admin demo gaps #665 #667, query screen demo gaps #668 #669 #670, demo polish with the 7:1 Day focus ring #673, demo re-walk fixes #675 · [issues][m2-p1-b] | n/a | done · CW #612 (mapper, `assessResult`, highlighter) · [issues][m2-p1-c] | gate run 10-14-26 (`docs/releases/m2-p1.md`): verify, audit, CI and local smoke 1 to 5 green; re-checked on main 66a35d2 (#675) 10-15-26: verify green (370 test files, 5151 tests, 156/156 scenarios), audit unchanged; release note carries a "Since the first draft" section; promote (no milestone tag) is the developer's step; demo is a decision point; P2 and P3 follow without a pause · [all][m2-p1] |
| M2 | P2 audit | done (lane A: AW1 #744, AW2 #756, AW3 #761, AW4 #772, AW5 #778 merged) · [plan](2026-10-18-m2-track-a-p2.md): AW1 contract, AW2 admin audit read, export, admin query and A9, AW3 sweeper and AUD-1, AW4 publish note, `Server-Timing`, `ackReceipt`, AW5 release note; decisions D-M2P2-1 to -9 with the developer · [issues][m2-p2-a] | done (BW1 to BW5 merged, BW5 #775; [handoff](../../handoffs/10-18-26-m2-p2-lane-b4.md)) · [plan](2026-10-18-m2-track-b-p2.md): BW1 design (mockup v6), BW2 audit log and admin request view, BW3 note, purged, client `ackReceipt`, BW4 terminal pane, BW5 e2e · [issues][m2-p2-b] | n/a | done · in A plan (lane C: CW1 #751 merged, CW2 bearer tests and `example-ok` mock; [handoff](../../handoffs/10-18-26-m2-p2-lane-c.md), [gate chores addendum](../../handoffs/10-18-26-m2-p2-lane-c-addendum.md), [addendum 2](../../handoffs/10-18-26-m2-p2-lane-c-addendum-2.md)) · [issues][m2-p2-c] | gate run 10-19-26 ([m2-p2.md](../../releases/m2-p2.md)): verify, audit, local smoke 1 to 5 and e2e green; A7 to A9 green; promote pending the developer (#732) · [all][m2-p2] |
| M2 | P3 hardening | active (lane A: AW1) · [plan](2026-10-19-m2-track-a-p3.md) (lanes A and C; decisions D-M2P3-1 to -10 ruled 10-19-26) · [issues][m2-p3-a] | active (lane B, BW1 flakes) · [plan](2026-10-19-m2-track-b-p3.md) (decisions D-M2P3-B1 to -B7 ruled 10-19-26) · [issues][m2-p3-b] | n/a | n/a | planned · M2 exit (12.7 gate map in the Track A plan) · [all][m2-p3] |
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
| Linux laptop (deploy host) | Host lane (host steps only) | M2 P0.5 | idle (m1 manual smoke done 10-06-26, #237; P0.5 promoted at 3e85c2b, smoke 1 to 5 ok 10-07-26, #545 comment) | 10-07-26 |
| Windows 11 | A (`C:\git\queryModule-a3`, "M2P1 Track A 3") | M2 P1 feed | active (`docs/m2-overview-pdf`: design brief PDF re-shot on main 607e7df, release note "Since the first draft", this STATUS update; AW4b #655 merged) | 10-15-26 |
| Windows 11 | A (`C:\git\queryModule-a`, "M2 P2 Lane A") | M2 P2 audit | done (AW1 #744, AW2 #756, AW3 #761 merged; [handoff](../../handoffs/10-18-26-m2-p2-lane-a.md)) | 10-18-26 |
| Windows 11 | A (`C:\git\queryModule-a`, "M2 P2 Lane A2") | M2 P2 audit | done (AW4 #772, AW5 #778 merged; [handoff](../../handoffs/10-19-26-lane-a2.md)) | 10-19-26 |
| Windows 11 | B (`C:\git\queryModule`, "M2 P2 Lane B4") | M2 P2 audit | done (BW4 #768, BW5 #775 merged; [handoff](../../handoffs/10-18-26-m2-p2-lane-b4.md)) | 10-18-26 |
| Windows 11 | A (`C:\git\queryModule-a`, "M2 P3 Lane A") | M2 P3 hardening | active (AW1 on `feat/m2-a-p3-wave-1`) | 10-19-26 |
| Windows 11 | B (`C:\git\queryModule`, "M2 P3 Lane B") | M2 P3 hardening | active (BW1 flakes, `feat/m2-b-p3-bw1`; manager "M2 Manager 10") | 10-19-26 |
| Windows 11 | Manager (`C:\git\queryModule-checker`, detached) | M2 | active ("M2 Manager 10"; [Manager 9 handoff](../../handoffs/10-19-26-m2-manager-9.md)) | 10-19-26 |
| Windows 11 | Planning (`C:\git\queryModule-a4`, "M2 planning 1") | M2 P0 and P0.5 plans | done (#557 merged) | 10-05-26 |
| Windows 11 | Planning (`C:\git\queryModule-plan`, "M2 P1 planning") | M2 P1 plans | done (#588 merged; issues #589 to #606) | 10-13-26 |
| Windows 11 | Planning (`C:\git\queryModule-b2`, "M2 P2 planning") | M2 P2 plans | done (#705 merged; issues #709 to #735) | 10-18-26 |
| Windows 11 | Planning (`C:\git\queryModule-b2`, "M2 P3 planning") | M2 P3 plans | done (#785 merged; issues #786 to #815) | 10-19-26 |
| Windows 11 | Lane C (`C:\git\queryModule-a3`, "M2 P3 Lane C") | M2 P3 hardening | active (CW1 Tasks 9 to 11 on `feat/m2-c-p3-wave-1`; CW2 Tasks 12 to 15 next) | 10-19-26 |

From M4 add a row: Windows 11, D. State is `running`, `paused` or `idle`; time as `MM-DD-YY HH:mm`.

## Handoff notes

Overwrite your track's note at pause using the seven-line format in the master plan 7.1 and link the track's latest handoff file in [docs/handoffs/](../../handoffs/) (CLAUDE.md, "Where records go"); clear it on resume.

### Track A

- Issue: #721 (docs refresh), #732 (release note, gate, promote)
- Branch / PR: `feat/m2-a-p2-wave-5` (AW5: release note `docs/releases/m2-p2.md`, docs refresh, gate); AW1 #744, AW2 #756, AW3 #761, AW4 #772 merged
- Last green: main 1edeb1f merged into `feat/m2-a-p2-wave-5`; `pnpm verify`, `pnpm audit --prod`, local smoke 1 to 5 and `pnpm e2e` green on the branch
- Next step: the developer merges the AW5 PR; the promote (`promote.yml` with the merge sha, no milestone tag, then host smoke, output on #732) waits for the developer to ask
- Blocked by: none
- Latest handoff: [10-19-26-lane-a2.md](../../handoffs/10-19-26-lane-a2.md) (M2 P2 Lane A2: AW4 #772 and AW5 #778 merged; Track A P2 done; promote of 0b354da pending the developer)
- Notes: manager "M2 Manager 8", then "M2 Manager 9" (its push approvals count as the developer's for Track A); P2 follow-ups #773, #774 and the AW4 review minors issue.

### Track B

- Issue: #724 (BW1 design; closes with the rulings PR); BW2 to BW5 open (#725 to #731, #734, #735)
- Branch / PR: #745 merged (mockup v6 design note and scripts); #749 merged (rulings D-M2P2-B1 to B8); #757 merged (BW2); #762 merged (BW3); #768 merged (BW4); #775 merged (BW5)
- Last green: `pnpm verify` green at `fe7f83a` (BW5 head, 5662 tests; full `pnpm e2e` 334 passed); CI on main per its PR
- Next step: none for P2 (Track B P2 done); deferred items #774 and flakes #773 carry to P3 under #46
- Blocked by: none
- Latest handoff: [10-18-26-m2-p2-lane-b4.md](../../handoffs/10-18-26-m2-p2-lane-b4.md) (M2 P2 Lane B4: BW4 merged, BW5 #775 merged; Track B P2 done)
- Notes: manager "M2 Manager 8"; Lane B is local in `C:\git\queryModule`, `E2E_PORT=3200`.


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
