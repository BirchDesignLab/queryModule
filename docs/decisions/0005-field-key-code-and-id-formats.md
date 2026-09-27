---
date: 09-26-26
status: accepted
track: core
phase: m0-p0
supersedes: []
---

# 0005 Field key, type code and id formats

## Context

Spec 4.1 defines field keys (`FieldDef.key`), picklist codes and config ids (sources, query types, adapter kinds, sites) but gives them no syntax. The audit contract (spec 4.7) stores field keys and `role: "type"` codes in `details` (`typeValues`, `fieldMapApplied`, `partSkipped` reason `params.field`) and ids in `details` and the envelope. Audit `details` are additive-only after the M0 P0 gate (spec 4.7) and audit rows are never deleted or rewritten (SEC-010 to SEC-013; spec 5.5 keeps them outside purge and crypto-shredding), so a bound that is not set now can never be set. An unbounded string also lets a writer bug put a plate or a name into a row that stays forever.

Config (plan Task 7) currently types keys as `z.string().min(1)`. Spec 5.2 step 4 fails the submit (500 `internal`, T1 rolls back) on any audit write failure. If audit were stricter than config, a valid site config would make every submit of an affected type fail. So the bound has to be one definition that config and audit both import.

UUIDv7 ids (spec 5.2, 5.5 "Ids are UUIDv7 text unless stated") and the SHA-256 `configHash` (spec 5.8 step 6) are already spec-stated; this ADR only records that the contracts now enforce them.

## Options

1. Leave keys, codes and ids as free strings and rely on the config-aware AuditService: no config coupling; the frozen audit contract then accepts any text forever.
2. Bound them in audit only: cheap; a config that passes validation can fail every audit write (spec 5.2 step 4).
3. One shared primitives module in core, imported by config and audit: closes both risks; config must adopt the same patterns in Task 7 and Task 8.

## Decision

Option 3. `packages/core/src/contracts/primitives.ts`, exported from the contracts barrel:

- `FieldKeySchema` (`FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/`): every field key. Alphanumeric only, because the terminal delimiter can be any printable non-alphanumeric ASCII character except `=` and space (spec 4.1) and a named token's key is the text before the first `=` (spec 4.4). Used for `typeValues` keys, `fieldMapApplied` keys and values, and audit reason `params.field`.
- `TypePicklistCodeSchema` (`TYPE_PICKLIST_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/`): the codes of every picklist a `role: "type"` field references. Used for `typeValues` values. Other picklists may keep codes such as `BLK/WHI`; config validation (Task 13) applies this pattern to type-field picklists.
- `BoundedIdSchema` (`/^[A-Za-z0-9_-]{1,64}$/`, `BOUNDED_ID_MAX_LENGTH = 64`): user ids (`actor.id`, `credentialUserId`, `credentialOwnerUserId`), source ids, query-type codes, adapter kinds and site ids. `system` and `example-ok` comply.
- `HostSubjectSchema` (printable text, 1 to 255 characters, `HOST_SUBJECT_MAX_LENGTH`): the embedded-mode host subject. The host issues it, so it keeps the wider character set with a cap.
- `MessageKeySchema` (`MESSAGE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*(?:.[A-Za-z0-9]+)*$/`, `MESSAGE_KEY_MAX_LENGTH = 128`): message and label keys, lowerCamel segments separated by dots. Used for config `labelKey` fields (and the client allowlist), `ValidationError.key`, config diagnostic keys, and audit `key` and `params.labelKey`. Added by the #61 amendment below.
- `Uuid7Schema` (canonical lowercase UUIDv7) for `correlationId`, `resultId` and `delegationId` in audit and WebSocket messages; `Sha256HexSchema` (64 lowercase hex) for `configHash`.
- `EpochMsSchema`, `DurationMsSchema`, `MAX_ALSO_RUN = 4` and the part id schemas live in the same module. Task 7 imports `MAX_ALSO_RUN` from here instead of defining it in `schema-fields.ts`.

## Consequences

- Task 7 uses `FieldKeySchema` for `FieldDef.key` and `BoundedIdSchema` for source, query-type and site ids; Task 8 uses `BoundedIdSchema` for `Source.kind`; Task 13 applies `TypePicklistCodeSchema` to type-field picklists. Every shipped key and code already complies.
- Loosening a pattern later is additive (old rows stay valid); tightening is not.
- No spec section is overridden, so no `Overridden by ADR-0005.` line is added.
- Amended 09-26-26 (W2 pre-freeze pass, developer decision): `BoundedIdSchema` also bounds `Source.id`, `CommandDef.queryType` and `SiteConfig.extends`; `CommandDef.presets` keys use `FieldKeySchema`. Command codes get their own config-side pattern, `CommandCodeSchema` in `packages/core/src/config/schema.ts` (printable ASCII without space or `=`, 1 to 32 characters), because radio-style codes such as `10-28` are common; a code that contains the site delimiter is rejected by config validation (plan Task 13), not by the pattern.
- Amended 09-26-26 (W4): `TypeValuesSchema` in primitives is shared by audit `typeValues` and the mock file `types`; `AuditActor.email` is an email of at most 254 characters.
- Amended 09-26-26 (#61, developer decision, option 1): `MessageKeySchema` bounds message and label keys in config, validation errors, diagnostics and audit with one shared definition. Every shipped key complies (145 in config and locales, 66 in code, longest 35 characters). Picklist codes, ids and paths keep their existing schemas. The pattern is linear-time (CodeQL js/redos, #91).
