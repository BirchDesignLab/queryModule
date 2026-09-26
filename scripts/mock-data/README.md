# scripts/mock-data

`generate.ts` produces fixture-policy mock payloads for `packages/config/mock/<siteId>.json` (spec 5.4). It lands in Track A M1 P3. Until then the mock files are hand-written and follow the fixture policy: plates `ZZ-####`, VINs failing the ISO 3779 check digit, DOBs in 1901, synthetic names, addresses on Example Ave.
