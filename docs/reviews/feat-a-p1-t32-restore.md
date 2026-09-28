---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "317aa83171bc59ff305a668cf51755372df0ffec"
verdict: "approve"
---

# Review: feat/a-p1-t32-restore (#135)

Date: 09-28-26. Gate tier.

## Scope

Branch feat/a-p1-t32-restore, range dcf5203029e06717452088365771e5d5f669f9a0..317aa83171bc59ff305a668cf51755372df0ffec. Delivers Task 32 Steps 1-2: scripts/ops/restore-test.sh (plan text verbatim, LF, +x) and scripts/ops/restore-test.test.ts (stub rclone, age, docker and jq). Step 3 is a Linux host step.

## Findings summary

Critical 0, important 0, minor 3. Checker ruling of 09-28-26 (script byte-for-byte the plan text) kept as stands and verified by diff. No controller rulings needed.

## Cross-cutting checks

- Archive and manifest layout (scripts/ops/backup.sh, packages/api/src/ops/backup.ts): match; auditMaxId always numeric.
- audit-stats.js path in the image and --up-to parsing (deploy/Dockerfile, packages/api/src/ops/audit-stats.ts): /app/scripts/ops/audit-stats.js present; value accepted.
- Test collection (scripts/vitest.config.ts): ops/**/*.test.ts included.

## Answers to the controller's questions

1. Worktree C:/git/queryModule-a, branch feat/a-p1-t32-restore, #135; head 317aa83171bc59ff305a668cf51755372df0ffec.
2. Yes: layout and manifest match; age key passed by path only; secrets mounted read-only and not logged; no published ports; EXIT trap removes container, volume and work dir.
3. Yes: the newest-first stub makes the sort load-bearing; --up-to comes from the newest manifest; mismatch and no-backup failures and container and volume cleanup are asserted.

## Remaining Minors

1. restore-test.sh:24 reuses a stale volume if an earlier cleanup failed silently; call cleanup before volume create (plan-mandated text).
2. Test does not pin the :ro secrets mount or the absence of key contents in output.
3. Test does not observe work-dir removal; set TMPDIR per test and assert it is empty.
