# scripts/mock-data

`generate.ts` produces the fixture-policy mock payloads for `packages/config/mock/<siteId>.json` (spec 5.4). The mock files are generated, not hand-written: edit the scenario table in `sites/<siteId>.ts` (or a builder in `builders.ts`), then regenerate.

```
pnpm tsx scripts/mock-data/generate.ts <siteId>   # writes packages/config/mock/<siteId>.json
pnpm tsx scripts/mock-data/generate.ts --check    # exit 1 naming each file that differs
```

Output is deterministic: sorted keys, 2-space indent, LF, trailing newline.

`builders.ts` emits only values that pass `checkFixturePolicy`: plates `ZZ-####`, VINs failing the ISO 3779 check digit, DOBs in 1901, synthetic names, addresses on Example Ave. Trigger inputs in `when` are exempt, so they may be any value. Never add a value that looks like a real person, vehicle or property record.

Adding a site: add `sites/<siteId>.ts` and register it in `SITES` in `generate.ts`.
