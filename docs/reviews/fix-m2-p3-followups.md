---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "e6107bd5197dbadf82d8e030cbeef7b8f0e5f8a6"
verdict: "approve"
---

# Review: fix/m2-p3-followups

Date: 10-20-26.

## Scope

Branch fix/m2-p3-followups, range 071f1b043b1d1a4e34a36ace916714de78b8a242..e6107bd5197dbadf82d8e030cbeef7b8f0e5f8a6. The PR closes #817, #825 and #829 in eight commits:

- #817: the session sweeper keeps a tick's counts and still prunes when a later batch's select fails, and start() does nothing while a stop() is pending.
- #825: config:import checks the shared draft inside saveDraft's transaction (expectDraft) and checks its own draft on publishDraft (expect). A failed cleanup no longer hides the original error. The configPublished actor takes identitySource and hostSubject from the user row. fileIgnored compares siteConfig and mock only.
- #829: db:reset uses a two-step health probe (a 10 s lookup, then a 3 s fetch) and refuses an existing backup directory. Its wrapper prints one failure line. ADR-0016 supersedes ADR-0015 with the guards as built.

The review ran in two slices: gate first, critical last. The critical slice covered packages/api/src/dispatch/sweeper.ts and packages/api/src/admin/config/draft.ts, publish.ts and store.ts.

## Findings summary

- Gate slice: approve, 0 open critical or important findings.
- Critical slice: 0 critical, 0 important, 2 minor. There were no critical or important findings to resolve.
- Rulings kept as they stand (M2 Manager 10, 10-20-26): #817 C-M2 (start() is a no-op while a stop is pending), #825 C-M4 (identity fields mapped from the user row, with the local-admin pin), #829 Q1 (EAI_AGAIN fails closed), Q2 (refuse an existing backup directory), Q3 (ADR-0016 supersedes ADR-0015), and the two-step probe ruling.
- No new controller rulings are needed.

## Cross-cutting checks

1. packages/api/src/db/tx.ts. Risk: the expectDraft check closes the gap only if its transaction holds the write lock from the first read. Found: transactions are IMMEDIATE, so the read, the check and the write are serialized.
2. packages/api/src/admin/config/activate.ts. Risk: the window from publishDraft's read to the commit. Found: activate refuses a changed draft document, a moved live version and a row that is no longer a draft, all inside its transaction.
3. packages/api/src/auth/identity.ts, packages/core/src/contracts/audit.ts, packages/api/src/db/schema.ts. Risk: the C-M4 mapping could build an audit event the contract refuses. Found: the audit envelope requires identitySource host and hostSubject to come together. A row that does not pair them makes audit.record throw inside activate's transaction, so nothing is published (fail closed). identity.ts still hardcodes local.

## Answers to the controller's questions

1. #825 C-M4: config-import.ts:138-158 maps identitySource and hostSubject from the user row, and hostSubject only when it is not null. A local admin gives exactly the earlier values; config-import.test.ts:545-565 pins [adminId, "local", null] and the host case. The actor id is the named admin, which meets SEC-010. A mismatched row fails closed at the audit contract.
2. #825 C-M1: yes. saveDraft re-checks the shared draft inside an IMMEDIATE transaction (draft.ts:236-244). publishDraft refuses a draft whose id or document is not this run's (publish.ts:243-244). activate() covers the window from that read to the commit (activate.ts:46, :67-68, :80-90). The builder routes pass neither field.
3. #829: the probe fails closed. ENOTFOUND on the lookup means stopped. ECONNREFUSED or ENOTFOUND as every fetch cause code means stopped. Any HTTP answer means running. A timeout, EAI_AGAIN, a reset or mixed codes are unknown, and the command refuses both running and unknown before it opens the database (db-reset.ts:60-128, :207-212). ADR-0016 and docs/deploy.md match the code on order, budgets, outcomes and the point-in-time busy check, with the two documentation gaps listed below.

## Remaining Minors

- m1 packages/api/src/ops/config-import.ts:129-130: the docstring says the principal is built as identity.ts builds one, identity fields included. identity.ts:101 hardcodes local. Reword it.
- m2 docs/deploy.md:108-110: the refusal list leaves out the SEED_PASSWORD_SECRET refusal (db-reset.ts:229-232). "About 5 seconds" is the stopped-app case; the worst case is about 13 s.
