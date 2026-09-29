---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f57b10e085899c1ef340ea307909598c44099257"
verdict: "approve"
---

# Review: feat/a-p3-ac0-roles-audit

Date: 09-29-26

## Scope

Branch feat/a-p3-ac0-roles-audit, range 78329fe..f57b10e085899c1ef340ea307909598c44099257 (810bfd3 contract commit, f57b10e review fix). Plan Task 24, issue #348 (and #339 m1): the first contract PR of the ADR-0011 admin console. ROLES gains implementer (identity.ts, user.role Drizzle enum); audit.ts gains the admin console audit types configPublished, userCreated, userDisabled and sessionRevoked, and roleChanged.via widens to grant-role | adminConsole; .github/sensitive-paths lists admin/config/** and admin/*.ts critical with an admin/** gate floor and moves the #338 lines into their own block. Critical tier.

## Findings summary

- Critical: 0.
- Important: 1. C-I1 (ruling C-I1, fix): admin audit types and roleChanged.via accepted any actor. Resolved: AuditEventSchema superRefine now binds the actor to the type (configPublished admin or implementer; userCreated and userDisabled admin; sessionRevoked expired by SYSTEM_ACTOR only, other reasons admin; roleChanged grant-role by SYSTEM_ACTOR, adminConsole by admin), with 13 reject and 9 accept tests. ADDRESSED.
- Minor: 4, all ADDRESSED. C-m1 pointer grammar comment corrected and writer collapse rule stated; C-m2 rollbackOf must be lower than version; C-m3 test pins user.role enum to core ROLES; C-m4 spec 6.9 names implementer among roles a simulator-trusting roleClaims map may not grant.
- Ruling ids kept as stands: none.
- Controller rulings: none issued; the context's "any actor" controller choice was flagged open to correction and was overridden by ruling C-I1.

## Cross-cutting checks

- Tightened actor binding against existing writers: only packages/api/src/ops/grant-role.ts writes a bound type (roleChanged, SYSTEM_ACTOR, via grant-role), which the rule accepts.
- Stored rows re-parsed on read: AuditEventSchema runs only at write (packages/api/src/audit/service.ts); pre-branch roleChanged was grant-role by the system actor only, so no historical conflict.
- Sensitive-paths coverage of fix files: audit.ts is critical in .github/sensitive-paths; the test and spec doc are ordinary; no new files.

## Answers to the controller's questions

- Can any new details schema carry a value, secret, token or password (SEC-010, SEC-014)? No secret, token or password: all four are strict objects of ids, hashes, enums, counts and bounded pointers; tests reject an extra password and a token-shaped sessionId. Pointer segments can still hold an alphanumeric string, but they point into site config, not query data, and writers emit keys only (C-m1 rule).
- Does anything accept an actor it should not? Not after the fix: C-I1 binds every admin type and both roleChanged paths to their writer.
- Do the path globs resolve as ruled with first-match and highest-tier semantics, and did the block move change no tier? Yes, per the first review (scripts/ci/sensitive-review.test.ts 74/74 at 810bfd3); the fix touched no sensitive-paths file.

## Remaining Minors

None open. Carry-forwards: Task 27 publish and rollback routes must apply the C-m1 pointer collapse rule before the audit write; add a deploy-config check for the simulator roleClaims rule (C-m4) when embedded auth lands.
