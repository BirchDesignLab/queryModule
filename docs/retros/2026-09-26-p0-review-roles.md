# Retro: review roles across P0 waves W1 to W4 (09-26-26)

Source: the P0 SDD ledger (`.superpowers/sdd/2026-09-25-p0-contracts/progress.md`, local to the Windows owner session) and the W4 `sdd-wave` result. Input to issue #78 (recalibrate review rules before W5).

## Cost

| Wave | Tasks | Agents | Subagent tokens | Wall clock | Escalations |
|---|---|---|---|---|---|
| W1 | 6 (2 sensitive) | ~27 (hand-dispatched) | n/a | most of a day | 0 |
| W2 | 5 + W2F | 40 | ~2.7M | ~76 min | 0 |
| W3 | 5 | 41 | ~3.5M | ~68 min | 0 |
| W4 | 6 (all sensitive) | 69 + 5 review | ~6.1M | ~120 min with review and CI | 0 |
| PR #76 (board, tiers) | n/a | 3 xhigh reviews (1 cancelled) | ~1.4M | over 2 h | 0 |

## Which role found real problems

W4 is the one wave with every role present on every task.

| Role | Findings ruled `fix` (W4) | Deferred minors (W4) | Notes |
|---|---|---|---|
| Critic (Opus medium) | 9 | 25 | Every fail-open gate in W4 (git failures read as pass, shallow clones, empty inputs, rename bypass) |
| Quality reviewer (Sonnet high) | 3 | 13 | SPDX precedence; git failure; malformed reviewedSha |
| Spec reviewer (Sonnet medium) | 0 | 4 | W3: 2 fixes, both missing-test gaps (a fixture, an equal-duration case) |
| Implementer concern | 1 | 19 (observations) | Task 21 fail-open found by the implementer itself |
| Gates (lint, typecheck, coverage) | 5 red across W2 to W4 | n/a | Mechanical: formatting, tsc errors in tests, coverage threshold |
| Whole-branch review (Opus xhigh) | 1 important (W4), 4 on PR #76 | many | Design-level holes the per-task roles missed: gate files outside the sensitive globs (W4); a textual deps rule that let `run:` code pass (PR #76 C1) |

## Conclusions

1. The per-task critic is the highest-yield role. Keep it on gate and critical tasks.
2. The separate spec reviewer rarely finds anything a combined reviewer would miss. Merge spec and quality into one reviewer for ordinary and gate tasks (it still cites requirement IDs); keep them split for critical tasks.
3. Whole-branch review finds a different class of problem (cross-task design). Keep it once per sensitive wave, at the effort its tier needs (ADR-0007).
4. Most of W4's cost was tiering: all six tasks were gate-tier work run with critical-tier roles.
5. Controller discipline cost as much as the rules on PR #76: a mid-run edit (one extra xhigh reviewer) and scope growth after review started (one more). Rules: freeze a PR's scope before its review; never touch the tree during a run.
