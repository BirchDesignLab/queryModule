---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f03b4c0b83b5a06fdada9744ad558805d648dad3"
verdict: "approve"
mode: "fast"
---

# Review: fix/m1-303-config-tests

Date: 10-03-26.

## Scope
Branch fix/m1-303-config-tests, range 6c77222..f03b4c0 (bbd9e8f, f03b4c0). Comment-only close-out of #303: the #513 wave-review minors G-M1 (routes.ts orphan session row wording and the enable-path rule, also stated at disableUser in users.ts) and C-M1 (validateDocument docstring lists the features.adminConfig refusal). Files: packages/api/src/admin/config/draft.ts (critical), packages/api/src/auth/routes.ts and packages/api/src/admin/users/users.ts (gate). No executable line changed.

## Findings summary
Critical 0, important 0, minor 1. No ledger ruling contested; the context ruling that the other #303 boxes are done on main stands. No controller rulings.

## Cross-cutting checks
1. identity refuses a disabled user's session (packages/api/src/auth/identity.ts:68 requires disabledAt null): holds.
2. activate() does not apply the adminConfig check (packages/api/src/admin/config/activate.ts:53-56 checks site id and mfaRequired only): holds, so the "only this chain" wording is accurate.
3. No enable-user path in M1 (only users.ts writes disabledAt in packages/api/src): holds.

## Answers to the controller's questions
None asked.

## Remaining Minors
- m1 routes.ts:126-128: the orphan-row enumeration omits a sign-in racing a concurrent disable (user read before the disable commits, session inserted after). Same safety (identity refuses it, the enable-path rule covers it); optional wording fix "made after or racing the disable".
