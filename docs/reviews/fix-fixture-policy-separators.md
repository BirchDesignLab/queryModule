---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "b92c0ee18005662706c45c2466a8df2ae64d299d"
verdict: "approve"
mode: "fast"
---

# Review: fix/fixture-policy-separators

Date: 10-13-26.

## Scope
Branch fix/fixture-policy-separators, range b5579ab7cac58a7417a149aa45b4db62911deb57..b92c0ee18005662706c45c2466a8df2ae64d299d (one commit, #636). The fixture policy's `other` kind now counts a run of 4 or more digits across the separators `-` `.` `/` and whitespace, so values like 123-45-678 are rejected. Gate file: packages/core/src/config/fixture-policy.ts (9 lines). Tests and docs/site-config.md updated.

## Findings summary
Critical 0, important 0, minor 1. No ledger rulings touched; the ruling that Windows load flakes are not findings stands.

## Cross-cutting checks
1. Shipped mock files under the tighter rule: every `other`-kind leaf in packages/config/mock/default.json and example-ok.json (ZZDLTEST, TESTMAKE, SAMPLEMODEL, ARTICLE, ZZSTOLEN1, TX, 1901) passes; pnpm verify EXIT 0 at head per context.

## Answers
1. Yes. Only the `other` non-year branch changed (fixture-policy.ts:185-189); the year exception, status, freeText, plate, vin, dob, name, address, walk and exported types are unchanged. Removing separators can only join digits, never split a run, so the check only tightens. The shipped mock passes.

## Remaining Minors
- M1 fixture-policy.ts:146: the separator set omits `,` `_` `:` and Unicode dashes, so 123,456,789 still passes. Within the plan's named set; consider treating any non-alphanumeric character as a separator in a follow-up.
