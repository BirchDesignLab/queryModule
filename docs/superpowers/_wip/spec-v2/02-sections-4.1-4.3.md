### 4.1 Site config schema

Zod schemas for the Appendix B entities, exported by `packages/core`. One resolved `SiteConfig` per deployment, read from the config volume (see 5.8). Vocabulary used throughout 4.1 to 4.6: **configured default** (from config, fixed), **user value** (what the user entered), **effective value** (user value, else rule default, else configured default).

```
SiteConfig {
  schemaVersion: 2                                  // configSchemaVersion; migrateConfig in 5.8
  extends?: siteId                                  // overlay on a base site, see "Overlays"
  site: { id, labelKey, defaultLocale: "en" }
  locales: localeCode[] = ["en"]                    // shipped locales; per-user choice in user_preference
  features: { [FeatureKey]: boolean }               // unlisted keys default false
  personas: PersonaDef[]                            // open list, see 6.1
  auth: AuthConfig
  delegation: DelegationConfig
  retention: { payloadDays: int | null, valuesDays: int | null }   // null = keep; prototype ships null
  terminal: { delimiter: char = "." }
  defaults: { [fieldKey]: Literal }                 // site-wide configured defaults, e.g. state: "TX"
  picklists: Picklist[]
  sources: Source[]
  queryTypes: QueryType[]
  commands: CommandDef[]
  keywords: KeywordStyle[]
  keywordSeverityStyles: { critical: SeverityStyle, warning: SeverityStyle, info: SeverityStyle }
  responseMappings: ResponseMapping[]
  quickAccess: queryTypeCode[]                      // FR-007, FR-070
  shortcuts?: ShortcutMap                           // merged over the default map in 6.4
  theme?: ThemeConfig                               // see 6.5
}
Literal = string | number | boolean
```

**Features.** `FeatureKey` is a closed catalogue exported by core (`FEATURES`); an unknown key is a validation error. A disabled feature's routes return 404 and its UI is hidden (see 5.8). Sensitive capabilities (credentials, delegation, write-back) merge with their feature off until their acceptance tests pass.

**Personas, auth, delegation, retention.**

```
PersonaDef { key, labelKey, layout: "dispatch" | "mobileUnit" | "mobile" }
           // shipped: dispatch, mobileUnit, mobile, records
AuthConfig {
  mfaRequired: boolean | { roles: Role[] } = false       // SEC-005; middleware in 5.6
  session: { absoluteMinutes: int = 720, idleMinutes: int = 30 }   // web cookie and native bearer alike
  hostRoleClaims?: { claim: string, map: { [claimValue]: Role } }  // embedded mode, 6.9
}
Role = "user" | "trainingOfficer" | "admin"
DelegationConfig {
  maxDurationMinutes: int = 480
  purposes: { key, labelKey, delegatorRoles: Role[], maxDurationMinutes?: int }[]
            // default [{ key: "training", labelKey: "delegation.training", delegatorRoles: ["trainingOfficer"] }]
}
```

The shipped `records` persona uses the `dispatch` layout [open]. A purpose's `maxDurationMinutes` may not exceed the site value. `retention` is consumed by `scripts/ops/purge.ts` (see 5.5).

**Query types and fields.**

```
QueryType {
  code, labelKey, allowPlateOnly: boolean = false
  sections: SectionDef[]                            // must contain key "base"
  defaults?: { [fieldKey]: Literal }                // query-type configured defaults
  fields: FieldDef[]                                // array order is display order
  rules: FieldRule[]
  sources: QueryTypeSource[]
  alsoRun?: NestedQuery[]                           // at most 4; one nesting level
}
SectionDef { key, labelKey, when?: Condition }      // absent when = always visible
QueryTypeSource { sourceId, selectedByDefault: boolean, plateOnly: boolean = false, when?: Condition }
NestedQuery { queryType: queryTypeCode, fieldMap: { [targetField]: sourceField }, when?: Condition }

FieldDef {
  key, labelKey
  dataType: "string" | "number" | "year" | "date" | "boolean" | "picklist"
  role?: "type"                                     // a type level; picklist only
  picklist?: picklistId                             // required iff dataType = picklist
  picklistFilter?: { byField: fieldKey }            // options = values whose parent == that field's effective value
  defaultValue?: Literal
  visible: boolean = true
  required: boolean = false
  section: sectionKey = "base"
  custom: boolean = false                           // FR-008; documentation and admin display only
  // string constraints
  minLength?: int, maxLength: int = 64              // maxLength <= 4096 (API per-value cap)
  pattern?: string                                  // anchored by core as ^(?:pattern)$
  charset: "printableAscii" | "printable" = "printableAscii"
  transform: "upper" | "none" = "none"
  // number
  numberKind: "integer" | "decimal" = "integer"
  // year and date
  century: "2000" | "past" = "2000"                 // two-digit year rule; "past" for DOB
  inputFormats: DateFormat[] = ["MMDDYYYY", "MM/DD/YYYY", "MM-DD-YYYY", "YYYY-MM-DD"]
  outputFormat: DateFormat = "MMDDYYYY"             // terminal serialisation, see 4.4
}
DateFormat = string of tokens MM, DD, YY, YYYY and literal separators

FieldRule { field: fieldKey, when: Condition,
            effect: "show" | "hide" | "require" | "setDefault", value?: Literal }  // value iff setDefault
```

`charset: "printable"` admits any Unicode except control and format characters [open]. Date values are stored as ISO `YYYY-MM-DD`; display uses MM-DD-YY through the locale formatter (see 6.2).

**Type fields.** There is no subtype entity. Each level of a query-type hierarchy (property type, then category, then kind, to any depth) is an ordinary picklist `FieldDef` with `role: "type"`; a lower level declares `picklistFilter: { byField }` naming the level above, and its picklist values carry `parent` codes. Visibility, required flags and sections for a type combination are ordinary conditions on those fields (see 4.2). The submitted audit row records the query type code and every `role: "type"` field value (see 4.7).

**Picklists, sources, commands.**

```
Picklist { id, values: { code, labelKey, enabled: boolean = true, parent?: code }[] }

Source {
  id, labelKey, scope: "state" | "national" | "local"
  kind: string                                      // required, no default; validated against the adapter registry (5.4)
  timeoutMs: int = 10000
  maxConcurrent: int = 4                            // per-source in-flight cap (5.2)
  requiresCredentials: boolean
  server?: { [k]: unknown }                         // adapter settings, validated by the adapter's schema; never sent to clients
}

CommandDef {
  code, queryType: queryTypeCode
  presets?: { [fieldKey]: Literal }                 // e.g. type-field values fixed by this command
  positions: (fieldKey | { field: fieldKey, rest: true })[]   // rest: last position only, string fields only
}
```

Sites narrow a picklist (FR-031) by setting `enabled: false`; disabled codes never reach `FormState` options and fail canonicalisation. Mock responses are not in site config; they live in `packages/config/mock/<siteId>.json` (see 5.4). There is no per-command delimiter; `terminal.delimiter` applies to every command.

**Keywords and response mappings.**

```
KeywordStyle { keyword, severity: "critical" | "warning" | "info", except?: string[] }
              // except: phrases containing the keyword that do not count as a hit, e.g. "NOT STOLEN"
SeverityStyle { color: tokenName, background: tokenName, bold: boolean, icon: iconName,
                marker: string, audibleCue: boolean = false }
              // marker is text rendered with every hit, so severity never relies on colour

ResponseMapping {
  id, queryType: queryTypeCode, sourceId?, persona?: personaKey, when?: Condition
  elements: MappingElement[]
}
MappingElement =
  | { kind: "value", path, labelKey, view: "summary" | "detail" | "both",
      format?: Format, highlight: boolean = true }
  | { kind: "table", path, labelKey, view: "summary" | "detail" | "both", highlight: boolean = true,
      columns: { path, labelKey, format?: Format, highlight?: boolean }[] }   // column paths relative to each row
Format = { type: "text" } | { type: "upper" } | { type: "phone" }
       | { type: "date", pattern: string } | { type: "template", template: string }
```

`color` and `background` name tokens from `packages/tokens`, resolved per theme mode [open]. `highlight: false` is for elements that echo user input. Absent `sourceId`, `persona` or `when` means "any". Path syntax, `[*].x` projection, selection score and the generic dump fallback are in 4.5. `Format` is a fixed set; an unknown `type` is a validation error.

**Shortcuts and theme.**

```
ShortcutMap { [actionKey]: ShortcutBinding | ShortcutBinding[] }
ShortcutBinding { keys: string, context: "global" | "panel" | "results" | "terminal" }
  // keys: space-separated strokes; stroke = [Ctrl+][Alt+][Shift+]<KeyboardEvent.code>
  // "Slash" (single key), "Ctrl+Enter" (combo), "KeyG KeyR" (chord)
ThemeConfig {
  defaultMode: "day" | "night" | "redShift" = "day"
  auto: "off" | "os" | "time" = "off"
  tokens?: { all?: TokenOverrides, day?: TokenOverrides, night?: TokenOverrides, redShift?: TokenOverrides }
}
TokenOverrides { [tokenName]: string }              // token names from packages/tokens
```

Action keys come from the shortcut engine's catalogue (6.4). The user's mode choice lives in `user_preference` and overrides `defaultMode`.

**Defaults precedence.** A field's configured default is `FieldDef.defaultValue` ?? `QueryType.defaults[key]` ?? `SiteConfig.defaults[key]`, else none. It is fixed for the lifetime of the loaded config.

**Overlays.** A site file with `extends` is merged onto the named base site before validation. Objects deep-merge by key. Arrays of entities merge by identity key: `picklists`, `sources` by `id`; `queryTypes`, `commands` by `code`; `fields`, `sections`, `personas`, `delegation.purposes` by `key`; picklist `values` by `code`; `keywords` by `keyword`; `responseMappings` by `id`; `QueryType.sources` by `sourceId`; `alsoRun` by `queryType`. Other arrays (`rules`, `positions`, `elements`, `columns`, `quickAccess`, `locales`, `inputFormats`) replace the base array whole. `{ "$remove": true }` in place of a keyed entry or an object key deletes it. The base may not itself use `extends` [open]. `packages/config/sites/example-ok.json` is an overlay on `default` (different default state, narrowed property picklist, extra custom field, different delimiter). `config:validate --resolved` prints the merged config and its diff from the base (see 7).

**Client view.** `GET /api/v1/config` returns `ClientSiteConfig`, a separate allowlist schema, never the server object with fields stripped:

```
ClientSiteConfig = {
  schemaVersion, configHash, site, locales, features, personas,
  delegation: { purposes: { key, labelKey }[], maxDurationMinutes },
  terminal, defaults, picklists, queryTypes, commands, keywords, keywordSeverityStyles,
  responseMappings, quickAccess, shortcuts, theme,
  sources: { id, labelKey, scope, timeoutMs, requiresCredentials }[]
}
```

Excluded: `extends`, `auth`, `retention`, `Source.kind`, `Source.server`, `Source.maxConcurrent`. The server parses config strictly (unknown keys are errors); the client parses `ClientSiteConfig` forward-tolerantly (unknown keys stripped, `z.catch` on optional enums).

**Validation.** `packages/config/schema/site-config.schema.json` is generated from the Zod schema for editor autocomplete and is documented as shape-only. `validateSiteConfig(config, locales) -> { errors: Diagnostic[], warnings: Diagnostic[] }` runs the referential pass on the resolved config at API startup (fail closed, see 5.8), in `pnpm config:validate` (also on external files) and in CI per shipped site.

```
Diagnostic { level: "error" | "warning", path: jsonPointer, key: messageKey, params }
  // e.g. { level: "error", path: "/queryTypes/0/rules/1/when/field", key: "config.unknownField", params: { field: "sate" } }
```

Errors:
- Duplicate ids, codes or keys in any keyed array; command and query type codes compared case-folded.
- Unresolved references: picklist ids, field keys (rules, conditions, `$default`, sections, positions, presets, `picklistFilter`, `fieldMap`, `QueryType.defaults`), source ids, query type codes (commands, `alsoRun`, `quickAccess`, mappings), persona keys, roles, feature keys, token names, action keys.
- A `labelKey` missing from any locale in `locales`.
- Literals (defaults, `setDefault` values, presets, condition values) that fail canonicalisation for the target field (4.3); `$default` naming a field with no configured default; ordering operators on a field that is not number, year or date (4.2).
- `role: "type"` or `picklistFilter` on a non-picklist field; `byField` not a picklist field; a `parent` code absent from the `byField` field's picklist; cycles among `picklistFilter` references.
- A section key referenced by a field but not declared; no `base` section.
- `require` or `setDefault` targeting an unreachable field (visible false and no `show` rule targets it); a cycle among `setDefault` dependencies (4.3); a rule reading a field whose `setDefault` appears later in `rules` [open].
- `minLength` > `maxLength`, `maxLength` > 4096, a `pattern` that does not compile, a `defaultValue` that violates its own constraints.
- `allowPlateOnly` without a field keyed `plate` or without a source flagged `plateOnly` [open].
- A nested query type that declares `alsoRun` (one level only); more than 4 `alsoRun` entries; `fieldMap` target keys not in the nested type or source keys not in the parent.
- Command positions naming fields outside its query type; `rest` not last or on a non-string field; a field both preset and positioned; an unconditionally required field with no position, preset or configured default [open: the default/preset exemption].
- `terminal.delimiter` not exactly one printable non-alphanumeric ASCII character, or equal to `=` or space; a delimiter that appears in any `inputFormats` entry; a delimiter produced by a single-key shortcut.
- Shortcut collisions: two bindings in the same context with the same stroke sequence or where one sequence is a prefix of the other; a `global` binding collides with every context [open].
- Unknown `Format.type`; two mappings with equal (`queryType`, `sourceId`, `persona`, presence of `when`) keys.
- `keywordSeverityStyles` colour pairs below 4.5:1 in any theme mode; theme token pairs below their target per mode (7:1 body text for the mobile unit layout, WCAG AA elsewhere; see 6.5); an `except` phrase that does not contain its keyword.
- A delegation purpose `maxDurationMinutes` above `delegation.maxDurationMinutes`; retention days not positive.

Warnings: a site default key used by no field of any query type; a conditionally required field with no command position; a picklist literal in a condition that names a disabled code. `config:validate` additionally resolves mapping paths against each mock default and scenario payload and warns on unresolved paths (see 5.4, 7). `Source.kind` against the adapter registry is checked by the API at startup, not by core.

Covers BR-001, FR-004, FR-007, FR-008, FR-031, FR-051, FR-052, NFR-001, UX-011.

### 4.2 Condition language

Structured JSON, no expression strings, no eval. This closes the spec's first open question.

```
Condition =
  | { field, op: "eq" | "neq",               value: Literal | DefaultRef }
  | { field, op: "in" | "notIn",             value: Literal[] }
  | { field, op: "gt" | "gte" | "lt" | "lte", value: Literal | DefaultRef }   // number, year, date fields only
  | { field, op: "empty" | "notEmpty" }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
DefaultRef = { "$default": fieldKey }
```

- `field` names a `FieldDef` of the query type the condition belongs to (for `ResponseMapping.when`, its `queryType`).
- `{ "$default": key }` is that field's configured default (4.1 precedence), frozen before evaluation and never changed by `setDefault`. "State is not the site default" is `{ "field": "state", "op": "neq", "value": { "$default": "state" } }`.
- Literals are canonicalised at load with the target field's `dataType` (4.3), so `"ok"` on a picklist field becomes `"OK"` and `26` on a year field becomes `2026`. Conditions compare canonical values with strict equality, so picklist comparison is case-insensitive by construction.
- Ordering: numeric for number and year, chronological (ISO string order) for date.
- An empty field (null) is `empty`; `eq`, `in` and every ordering operator are false; `neq` and `notIn` are true.
- Subtype-style conditions are ordinary conditions on `role: "type"` fields: `{ "field": "propertyType", "op": "eq", "value": "FIREARM" }`.

Where conditions are read:

| Location | Evaluated against |
|---|---|
| `FieldRule.when`, `SectionDef.when` | Effective values during evaluation, before pruning of hidden fields (4.3) |
| `QueryTypeSource.when`, `NestedQuery.when`, `ResponseMapping.when` | Submitted values: `FormState.values`, hidden fields absent |

Covers FR-002, FR-003, FR-011, FR-032.

### 4.3 Rules engine

`evaluateForm(siteConfig, queryTypeCode, input, { now }) -> FormState`

`input` is the draft's user values as entered (`{ [fieldKey]: string | number | boolean | null }`); `now` (epoch ms) feeds the `century: "past"` rule, keeping the function pure. `siteConfig` may be a `SiteConfig` or `ClientSiteConfig`. The same function runs on the client for the form and terminal, and on the server for every submit and every nested part (see 4.6, 5.2).

```
FormState {
  queryType: code
  mode: "normal" | "plateOnly"
  sections: { key, labelKey, visible }[]
  fields: FieldState[]                              // in FieldDef order
  sources: { sourceId, selectedByDefault, plateOnly }[]   // QueryType.sources whose when holds
  values: { [fieldKey]: CanonicalValue }            // submit payload: visible fields with non-null effective value
  missingRequired: fieldKey[]
  hiddenWithValue: fieldKey[]                       // hidden fields that have a user value (4.4 valueForHiddenField)
  errors: { field: fieldKey, key: messageKey, params }[]
  valid: boolean                                    // no errors and no missingRequired
}
FieldState {
  key, labelKey, dataType, role?, order: int
  section: sectionKey, sectionLabelKey
  visible: boolean, required: boolean
  userValue: CanonicalValue | null                  // canonicalised input; null if empty or invalid
  effectiveValue: CanonicalValue | null
  isDefault: boolean                                // userValue null and effectiveValue from a default
  options?: { code, labelKey }[]                    // picklist: enabled, filtered by picklistFilter
}
CanonicalValue = string | number | boolean          // date = ISO YYYY-MM-DD string
```

**Algorithm.** One pass, deterministic:

1. **Unknown keys.** An `input` key that is not a field of the query type produces error `validation.unknownField` (the server answers 400, see 5.2).
2. **Canonicalise** each input per `dataType`, identically for form and terminal:
   - string: trim, collapse internal whitespace runs to one space, apply `transform`, then check `charset` (`validation.invalidCharacter`), `minLength` / `maxLength` (`validation.tooShort` / `validation.tooLong`, params `{ min }` / `{ max }`) and `pattern` (`validation.patternMismatch`).
   - picklist: trim, match case-insensitively against the field's enabled codes after `picklistFilter`; result is the configured code, else `validation.notInPicklist`. Picklist fields are processed in `picklistFilter` dependency order so a filter sees its parent's canonical value.
   - number: parse per `numberKind`, else `validation.invalidNumber`.
   - year: two or four digits, else `validation.invalidYear`. Two digits resolve by `century`: `"2000"` gives 2000 plus; `"past"` gives the latest year not after `now`.
   - date: try `inputFormats` in order, then `YYYY-MM-DD` always; first valid calendar date wins, stored ISO, else `validation.invalidDate`. `YY` resolves by `century` as for years.
   - boolean: `Y`, `N`, `1`, `0`, `true`, `false`, case-insensitive, else `validation.invalidBoolean`.

   Empty after trim is null. An invalid input yields `userValue` null plus its error. Canonicalisation is idempotent: `canon(canon(x)) = canon(x)` (property-tested, see 10).
3. **Effective values.** Start with `userValue` ?? configured default for every field. Apply `setDefault` rules in config order: when the condition holds and the target's `userValue` is null, set the target's effective value to `value` (canonicalised at load). Later matching `setDefault` rules on the same target win. `setDefault` never writes to the draft and never replaces a user value.
4. **Sections.** A section is visible when its `when` is absent or holds.
5. **Visibility and required**, as two independent channels, last match wins per channel:
   - visible = the last matching `show` / `hide` rule for the field, else `FieldDef.visible`; then AND the section's visibility.
   - required = `FieldDef.required` OR any matching `require` rule; then AND visible. A hidden field is never required.
   - A `require` rule never shows a field; a `show` rule never requires one.
6. **Plate-only mode.** `mode = "plateOnly"` when `allowPlateOnly` is true, the `plate` input is non-empty, and every other input is empty. Emptiness is judged on raw input after trim (an invalid entry counts as non-empty); configured and rule defaults are ignored. In plate-only mode only the `base` section is visible (FR-010 shows Plate, State, Year and VIN; FR-012's "without displaying other fields" is read as no expanded fields), no field is required, and defaulted values such as State are still submitted. Source narrowing is the planner's job (4.6). The client sends its computed `mode` with the submit; the server recomputes and answers 400 on a mismatch (see 5.2).
7. **Prune and check.** `values` holds each visible field whose effective value is non-null; hidden fields contribute nothing, and hidden fields with a user value are listed in `hiddenWithValue`. Unless `mode` is `plateOnly`, every required field with a null effective value and no canonicalisation error is added to `missingRequired` and gets error `validation.required`.
8. **Sources.** `sources` lists `QueryType.sources` entries whose `when` holds against `values`.

Conditions in steps 3 to 5 read effective values before pruning, so a hidden field's value can still satisfy a condition; sites that need otherwise add the field's visibility condition to the dependent rule [open]. Type-field cascades need no such care: a child type value whose parent changed fails `notInPicklist` in step 2 and reads as empty.

**Rule-set guarantees**, enforced by `validateSiteConfig` (4.1), make the single pass order-safe: no cycle among `setDefault` dependencies (an edge runs from each field a condition reads to the rule's target; `$default` references add no edge), and no rule reads a field whose `setDefault` appears later in `rules` [open].

**Messages.** Every error is `{ key, params }` with no prose; the renderer resolves `key` through the locale bundle (NFR-001) and passes the field's `labelKey` for display (see 6.2). The terminal reports the same keys (4.4).

**Required tests** (table-driven, see 10): A1 (default State TX, plate only entered: `mode` plateOnly, State TX in `values`); State changed to OK with plate only (normal mode, Plate Type visible and required); Year typed with plate (normal mode, no plate-only narrowing); A2 round trip TX to OK to TX; a typed value survives a matching `setDefault`; `$default` unaffected by `setDefault`; disabled picklist codes never appear in `options`; unknown key rejected; hidden field value absent from `values`; filtered child picklist after parent change.

Covers FR-001 to FR-005, FR-008, FR-010 to FR-012, FR-031, FR-032, UX-004.

## Writer notes (remove at assembly)

(a) [open] tags
- 4.1 `records` persona maps to the `dispatch` layout.
- 4.1 `charset: "printable"` definition (any Unicode except control and format characters); two-value enum chosen as simplest way to admit non-ASCII names.
- 4.1 `SeverityStyle.color` / `background` are token names resolved per theme mode rather than literal hex.
- 4.1 overlay depth one level (base may not `extends`).
- 4.1 / 4.3 validation rejects a rule reading a field whose `setDefault` appears later in `rules` (makes one pass equal to a fixed point).
- 4.1 `allowPlateOnly` requires a field keyed literally `plate` and at least one `plateOnly` source.
- 4.1 unconditionally required field exempt from the "needs a position" error when it has a preset or configured default.
- 4.1 a `global` shortcut binding collides with the same sequence in any context.
- 4.3 conditions read pre-pruning effective values; hidden values can still satisfy conditions.

(b) Assumptions about other sections
- 4.4: parser uses `terminal.delimiter`, `CommandDef.presets`, positions with `{ field, rest: true }`, `DateFormat` / `outputFormat`, and `FormState.hiddenWithValue` to raise `valueForHiddenField`; error keys under `validation.*` shared with terminal. Toggle tie-break between commands with equally specific presets left to 4.4.
- 4.5: owns path syntax, mapping score (+4 when, +2 sourceId, +1 persona), runtime tie-break, generic dump, `assessResult`, Unicode boundary matching for `except`.
- 4.6: consumes `FormState.mode`, `FormState.sources`, `QueryTypeSource.plateOnly`, `NestedQuery.when`; runs `evaluateForm` per nested part; children cap 4 validated here too. Per-request source cap (8) and global concurrency cap (32) assumed core/API constants, not config.
- 4.7: submitted audit details include every `role: "type"` field value and `configHash`.
- 5.2: submit body carries `mode` and `configHash`; server 400 on mode mismatch or unknown key; `Source.maxConcurrent` is the per-source cap (default 4).
- 5.4: mocks in `packages/config/mock/<siteId>.json`; adapter registry exposes a settings schema used to validate `Source.server`; `kind` checked at API startup.
- 5.5 / 6.2 / 6.5: `user_preference` holds locale and theme mode; tokens package exposes token names and contrast pair metadata for validation.
- 5.6 / 5.7: consume `auth.mfaRequired`, `auth.session`, `auth.hostRoleClaims`, `delegation.purposes`, `delegation.maxDurationMinutes`.
- 5.8: owns `configHash` computation (over resolved config), `migrateConfig`, feature-flag 404s; route name `GET /api/v1/config`.
- 6.4: owns action key catalogue and default map; binding syntax here (space-separated strokes of `KeyboardEvent.code` with modifiers).
- 7: `config:validate --resolved --diff` flags.

(c) Decision lines not placed
- c122 "Intl formatting" and per-user locale storage belong to 6.2 / 5.5; only `locales[]` and `site.defaultLocale` placed here.
- c103 per-keyword `style` from v1 dropped in favour of `keywordSeverityStyles`; per-keyword override not kept (not in the decision).
- x19 audible cue placed as `SeverityStyle.audibleCue`; the cue sound itself is 6.6.
