---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "219552551575ddfeb36d14702171a05bf2799ed4"
verdict: "approve"
mode: "fast"
---

# Review: feat/core-139

Date: 09-27-26.

## Scope
Branch feat/core-139, range 49c9d39c51d95b688feb6f1b4dbd9a78a31467c0..219552551575ddfeb36d14702171a05bf2799ed4. Delivers the contract half of #139 (plan Task 36): UserPreferenceSchema and planned getMePreferences/putMePreferences ROUTES entries, regenerated openapi.json, and a gate change to scripts/ci/openapi.test.ts that derives expected paths from ROUTES and checks operation count equals ROUTES.length.

## Findings summary
Critical 0, Important 0, Minor 1. No ruling ids contested; the developer ruling on the openapi test assertion is implemented as stated. No controller rulings.

## Cross-cutting checks
- packages/api/test/openapi.test.ts (misplaced operation risk): asserts exact method+path pairs of committed openapi.json; covered.
- Plan Task 36 (interface drift): matches; personaOverride max 64 and PUT 400 response are justified additions.
- .github/sensitive-paths (tiering): openapi.test.ts falls under scripts/ci/** gate glob.

## Answers to the controller's questions
None asked.

## Remaining Minors
- M1 scripts/ci/openapi.test.ts:25-27: path set plus op count cannot catch an operation emitted under the wrong existing path; mitigated by packages/api/test/openapi.test.ts. Optional: assert method+path pairs here too.
