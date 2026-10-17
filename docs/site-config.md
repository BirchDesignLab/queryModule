# Site configuration reference

How a site changes what the Query Module does, without a code change or a rebuild (BR-001, BR-005,
NFR-001). This page covers M1, the M2 P0.5 dispatch and mock adapter and the M2 P1 result cards, and was checked against the code on 10-14-26. Where a thing does not exist yet, the page says which phase brings it and does not
describe it.

Mock data only. The prototype uses a mock data source with canned responses and never connects to
real state or national systems. Every value below is a placeholder such as `ABC123` or `ZZ-0001`.

## Where config comes from

One site config document describes one site. It reaches the server in two steps (ADR-0011):

1. **The site file is the bootstrap.** `SITE_CONFIG` names it (default: the bundled
   `packages/config/sites/default.json`). On first start, when the config store holds nothing for
   the site, the server resolves the file (see "Overlays"), validates it and stores it as version 1.
2. **The stored version is the live config.** After that the store is the source. The file is
   compared and ignored: edit it and nothing changes. A site is changed by publishing a new
   version from the admin builder, or by publishing an exported document (see "The admin builder
   and the config store").

Next to the site file:

| File | Purpose |
|---|---|
| `packages/config/sites/<siteId>.json` | The site config. Shipped: `default.json` and `example-ok.json`. |
| `packages/config/locales/<locale>.json` | UI strings, picklist labels and error texts by message key. Ships `en` only. |
| `packages/config/mock/<siteId>.json` | Canned source answers, loaded only where `ALLOW_MOCK_SOURCES=true`. See "Mock files". |
| `packages/config/schema/site-config.schema.json` | JSON Schema for editor autocomplete. Shape only; the validator checks more. |
| `packages/config/test/*.json` | Test configs: `all-on.json` turns every feature on, `flags-off.json` turns every one off. |

The server never trusts a config it has not validated. A config that fails validation stops the
start or refuses the publish; it is never served half-checked.

## The sections

A site config has these top-level keys. Unknown keys are errors.

| Key | What it holds |
|---|---|
| `schemaVersion` | The config schema version, an integer (now `1`). A newer version than the server knows is rejected. |
| `extends` | The id of a shipped site to overlay. See "Overlays". |
| `site` | `id` and `labelKey`. The id is 1 to 64 characters of `A-Z a-z 0-9 _ -`. |
| `locales` | The site's locales. The first is the default. Default `["en"]`. |
| `features` | Feature flags. See "Features". |
| `personas` | Layout choices: each has a `key`, a `labelKey` and a `layout` (`dispatch`, `mobileUnit` or `mobile`). |
| `auth` | Session limits (`absoluteMinutes` 720 and `idleMinutes` 30 by default), `mfaRequired`, embedded role claims. Server only. |
| `delegation` | Delegated credentials: `maxDurationMinutes` and `purposes`. Used when the `delegation` feature is built (M3). |
| `retention` | `payloadDays` and `valuesDays`; `null` keeps data. The prototype ships `null`. Server only. |
| `terminal` | `delimiter`, one printable non-alphanumeric ASCII character, default `.`. |
| `defaults` | Site-wide default values by field key, such as `state: "TX"`. |
| `picklists` | Lists of values for picklist fields. |
| `sources` | The sources a query can go to. |
| `queryTypes` | The query types, with their fields, rules and sources. |
| `commands` | The terminal commands. |
| `keywords` | Keywords to highlight in results, with a severity. |
| `keywordSeverityStyles` | How `critical`, `warning` and `info` look. |
| `responseMappings` | What to show from a source answer, per query type. |
| `quickAccess` | The query-type codes on the quick-access row, in order. |
| `shortcuts` | Keyboard bindings that replace defaults. |
| `theme` | Day, night and red-shift choices and token overrides. |

Server-only keys (`auth`, `retention`, `extends`, and each source's `kind`, `maxConcurrent` and
`server`) are never sent to the browser: `GET /api/v1/config` returns a client view without them.
The admin builder edits the client view. Server-only sections ride along untouched when a draft is
saved, so the builder does not change them in M1.

### Features

`features` is a map from a feature key to `true` or `false`. An unlisted key is `false`; an unknown
key is a validation error. A feature that is off hides its UI and its routes answer `404`.

| Key | Gates | M1 status |
|---|---|---|
| `credentials` | State-system credential entry | Not built yet; keep off. |
| `delegation` | Delegated credentials | Not built yet; keep off. |
| `resultHide` | Delete from view | Not built yet; keep off. |
| `adminAudit` | The admin audit viewer | Not built yet (M2 P2); keep off. |
| `adminConfig` | The admin config routes and the builder | Live. On in the shipped default site. |
| `adminUsers` | The admin user routes and the Users page | Live. On in the shipped default site. |

A flag that gates unfinished work stays off in every shipped site until its acceptance tests pass
on `main`.

## Example: the vehicle plate query

This is the Appendix B vehicle plate example in the current schema, trimmed from the shipped
default site. It shows a query type, fields, a picklist, rules, a command and a source list.

```json
{
  "defaults": { "state": "TX" },
  "picklists": [
    { "id": "state", "values": [
      { "code": "TX", "labelKey": "picklist.state.TX" },
      { "code": "OK", "labelKey": "picklist.state.OK" }
    ] },
    { "id": "plateType", "values": [
      { "code": "PC", "labelKey": "picklist.plateType.PC" },
      { "code": "TK", "labelKey": "picklist.plateType.TK" }
    ] }
  ],
  "queryTypes": [
    {
      "code": "VEH",
      "labelKey": "queryType.VEH",
      "allowPlateOnly": true,
      "sections": [
        { "key": "base", "labelKey": "section.base" },
        { "key": "expanded", "labelKey": "section.expanded" }
      ],
      "fields": [
        { "key": "plate", "labelKey": "field.plate", "dataType": "string",
          "maxLength": 10, "transform": "upper", "pattern": "[A-Z0-9-]+" },
        { "key": "state", "labelKey": "field.state", "dataType": "picklist", "picklist": "state" },
        { "key": "year", "labelKey": "field.year", "dataType": "year" },
        { "key": "vin", "labelKey": "field.vin", "dataType": "string" },
        { "key": "plateType", "labelKey": "field.plateType", "dataType": "picklist",
          "picklist": "plateType", "visible": false }
      ],
      "rules": [
        { "field": "plateType",
          "when": { "field": "state", "op": "neq", "value": { "$default": "state" } },
          "effect": "show" },
        { "field": "plateType",
          "when": { "field": "state", "op": "neq", "value": { "$default": "state" } },
          "effect": "require" }
      ],
      "sources": [
        { "sourceId": "stateSource", "selectedByDefault": true, "plateOnly": true },
        { "sourceId": "nationalSource", "selectedByDefault": true }
      ]
    }
  ],
  "commands": [
    { "code": "VEH", "queryType": "VEH", "positions": ["plate", "state", "year", "vin"] }
  ]
}
```

Reading it: State defaults to `TX`. `plateType` is hidden until State is not the site default, then
it shows and is required. `VEH.ABC123` runs with State `TX`. `VEH.ABC123.OK` is refused with
"required" on `plateType`, which has no position, so the dispatcher types
`VEH.ABC123.OK.plateType=PC` (a named token) or fills the form.

## Query types, fields and sections

A query type has a `code` (such as `VEH`), a `labelKey`, `sections`, `fields`, `rules`, `sources`
and optionally `defaults`, `allowPlateOnly` and `alsoRun`.

**Field keys** start with a letter and use letters and digits only, up to 64 characters.
**Message keys** (`labelKey`) are lower-camel dotted names such as `field.plate`; each must exist in
every locale the site lists.

A field has these settings:

| Setting | Meaning |
|---|---|
| `key`, `labelKey` | Identity and label. |
| `dataType` | `string`, `number`, `year`, `date`, `boolean` or `picklist`. |
| `picklist` | The picklist id, for a `picklist` field. |
| `role` | `"type"` makes a picklist field a type level (see below). |
| `picklistFilter` | `{ "byField": key }`: only values whose `parent` equals that field's value. |
| `defaultValue` | A configured default for this field. |
| `visible`, `required` | Start state: visible `true`, required `false`. Rules change them. |
| `formOnly` | `true` says the field is deliberately not positional in any terminal command (the form, or a named token, is the way to fill it); default `false`. It only silences the required-without-position warning below. |
| `section` | The section key; default `base`. `expanded` is the "More details" section. |
| `custom` | `true` marks a site-added field; documentation and admin display only. |
| `minLength`, `maxLength` | String length; `maxLength` default 64, at most 4096. |
| `pattern` | A regular expression, anchored by core as a whole-value match. |
| `charset` | `printableAscii` (default) or `printable`. |
| `transform` | `upper` or `none` (default). |
| `numberKind` | `integer` (default) or `decimal`. |
| `century` | `2000` (default) or `past`, for two-digit years. Use `past` for a date of birth. |
| `inputFormats`, `outputFormat` | Date input formats and the terminal output format. Tokens `MM`, `DD`, `YY`, `YYYY` and separators. |

**Type fields.** There is no subtype entity. Each level of a hierarchy (property type, then
category, and so on) is an ordinary picklist field with `role: "type"`. A lower level sets
`picklistFilter` to name the level above, and its picklist values carry a `parent` code. Which
fields show or are required for a type is then ordinary rules (see below). In the shipped `PRO`
query type, Property type is the type field: Firearm requires make and caliber, Article requires a
description.

**Sections** group fields. A query type must declare a `base` section. A section may carry a
`when` condition.

**Sources per query type.** Each entry in `sources` has a `sourceId`, `selectedByDefault`,
`plateOnly` (for a source that can answer a plate-only query) and an optional `when` condition.
`allowPlateOnly` needs a field keyed `plate` and at least one source flagged `plateOnly`.

**Nested queries.** `alsoRun` lists other query types to run with this one, each with a `fieldMap`
from the nested type's fields to this type's fields and an optional `when`. One level only, at most
4 entries. The shipped `PER` type also runs `WNT`.

## Rules

A rule is `{ field, when, effect, value? }`. The effect is `show`, `hide`, `require` or
`setDefault`; `value` is only for `setDefault`. Rules are evaluated in list order, in one pass. A
rule must not read a field whose `setDefault` rule comes later. An overlay that changes a query
type's `rules` replaces the whole list (see "Overlays").

A field's effective value is the user's value, else a `setDefault` value, else the configured
default.

## Condition language

Conditions are structured JSON: no expression strings, nothing is evaluated as code.

| Form | Meaning |
|---|---|
| `{ "field": k, "op": "eq" or "neq", "value": v }` | equal or not equal |
| `{ "field": k, "op": "in" or "notIn", "value": [v, ...] }` | one of, or none of |
| `{ "field": k, "op": "gt", "gte", "lt" or "lte", "value": v }` | ordering; number, year and date fields only |
| `{ "field": k, "op": "empty" or "notEmpty" }` | blank or not blank |
| `{ "all": [c, ...] }`, `{ "any": [c, ...] }`, `{ "not": c }` | and, or, not |

- A value is a string, number or boolean, or `{ "$default": fieldKey }`, which means that field's
  configured default. "State is not the site default" is
  `{ "field": "state", "op": "neq", "value": { "$default": "state" } }`.
- Values are canonicalized for the field before comparing, so `"ok"` on a picklist field is
  `"OK"`. Picklist comparison is therefore case-insensitive.
- A blank field is `empty`. `eq`, `in` and the ordering operators are false on it; `neq` and
  `notIn` are true.
- A subtype test is an ordinary condition on a type field:
  `{ "field": "propertyType", "op": "eq", "value": "FIREARM" }`.

Conditions read the effective values in `FieldRule.when` and `SectionDef.when`. In
`QueryTypeSource.when` and `NestedQuery.when` they read the submitted values, where hidden fields
are absent.

## Picklists

A picklist is `{ id, values: [{ code, labelKey, enabled, parent? }] }`. `enabled` defaults to
`true`. A site narrows a list by setting `enabled: false`: a disabled code never appears as an
option and fails when typed. Overlays can do the same without restating the list (see "Overlays").

## Sources

A source is `{ id, labelKey, scope, kind, timeoutMs, maxConcurrent, requiresCredentials }`.
`scope` is `state`, `national` or `local`. `timeoutMs` defaults to 10000 and `maxConcurrent` to 4.
`kind` names the adapter; the shipped sites use `mock`. `server` holds adapter settings and is
never sent to a client.

## Commands and the terminal

The terminal is another view of the same draft as the form. A command is
`{ code, queryType, presets?, positions }`.

- `code` is 1 to 32 printable ASCII characters, not containing a space, `=` or the site delimiter.
  Radio-style codes such as `10-28` are allowed. Codes are matched case-insensitively, and two
  codes that differ only by case are an error. Typed-only codes such as `NAM` and `PROP` map to a
  query type but the mode toggle never produces them.
- `positions` lists field keys in the order they are typed. The last position may be
  `{ "field": key, "rest": true }`, which takes the rest of the input verbatim, delimiters
  included; it is only for a free-text string field.
- `presets` sets field values before positions are read. This is how a command selects a type
  level.

The delimiter is site-wide: `terminal.delimiter` (default `.`). There is no per-command delimiter.

**Grammar (summary).**

1. Input is split on the delimiter. The first token is the command code. A bare code with no
   delimiter, such as `VEH`, is valid and fills nothing.
2. The remaining tokens fill `positions` in order. Values are trimmed. Trailing empty tokens are
   ignored, so `VEH.ABC123...` equals `VEH.ABC123`.
3. An empty token in the middle leaves that value empty, and the field's configured default then
   applies. `VEH.ABC123..26` gives plate `ABC123`, State the default and year `26`.
4. A non-empty token past the last position is `terminal.tooManyPositions`.
5. After the positions, a token `fieldKey=value` sets any field of the query type, for example
   `VEH.ABC123.OK.plateType=PC`. A positional token after a named token is an error
   (`terminal.positionalAfterNamed`).
6. There is no escape or quote syntax. A value that contains the delimiter cannot be typed, except
   in a rest position.
7. Source selection stays in the panel; a command does not name sources.

Values by data type:

| Data type | Accepted in the terminal |
|---|---|
| `string` | any text without the delimiter |
| `picklist` | a code, any case, that is enabled in the list |
| `date` | one of the field's `inputFormats` (default `MMDDYYYY`, `MM/DD/YYYY`, `MM-DD-YYYY`, `YYYY-MM-DD`) |
| `year` | two or four digits; two-digit years follow `century` |
| `boolean` | `Y`, `N`, `1`, `0`, `true`, `false` |
| `number` | an integer, or a decimal for `numberKind: "decimal"` |

Error keys the terminal reports: `terminal.emptyInput`, `terminal.missingDelimiter`,
`terminal.unknownCommand`, `terminal.tooManyPositions`, `terminal.positionalAfterNamed`,
`terminal.unknownField`, `terminal.duplicateField`, `terminal.valueForHiddenField` and
`terminal.delimiterInValue`, plus the form's `validation.*` keys (such as `validation.required`).
Errors name fields, positions and lengths, never the typed value (the one exception, an unknown
command code or field name, is shown to the user and never logged).

Config checks on commands: a field that is always required and has no position, preset or default
is an error; a field that a rule can make required and that has no position is a warning (a named
token can still supply it) unless the field is marked `formOnly`. The shipped sites mark VEH
`plateType` and `plateColor` and PRO `make`, `caliber` and `description` `formOnly`, so their
validation reports no warning (so the builder's warnings chip is empty on the untouched config); an
unmarked field without a position still warns.

## Keyword styles and severity styles

`keywords` is a list of `{ keyword, severity, except? }`. `severity` is `critical`, `warning` or
`info`. `except` lists phrases that contain the keyword and do not count, for example `STOLEN` with
`except: ["NOT STOLEN", "RECOVERED STOLEN"]`. An `except` phrase that does not contain its keyword
is an error.

`keywordSeverityStyles` has one entry per severity: `color`, `background` (theme token names),
`bold`, `icon`, `marker` and `audibleCue` (default `false`). The marker and icon are always shown
next to highlighted text, so severity never relies on color alone. Color pairs below 4.5:1
contrast in any theme mode are an error.

Keywords drive two things (M2 P1, spec 4.5):

- **Highlighting.** In a mapped value or table cell whose element has `highlight: true`, each
  keyword hit is marked with its severity style: the style's colors, its icon, the word itself, the
  visible marker (`!!` for critical, `!` for warning, `i` for info) and a visually hidden
  "(critical)". Matching is case-insensitive and whole-word (Unicode letters and digits bound a
  word), longest keyword first, and a hit inside an `except` phrase does not count. Text is
  NFC-normalized before matching.
- **The severity badge.** `assessResult` scans every string leaf of the raw payload, independent of
  the card, the `view` and the `highlight` flags, so a `STOLEN` buried in a detail-only row, or in
  an element with `highlight: false`, still raises the badge on the card, the request entry and the
  announcement. The highest severity wins (`critical`, then `warning`, then `info`).

The shipped default site's keywords are `STOLEN`, `WANTED` and `MISSING` (critical; `NOT STOLEN`,
`RECOVERED STOLEN` and `NOT WANTED` do not count), `EXPIRED` (warning), and `NO RECORD` and
`RECOVERED` (info). Validation rejects a style whose color pair is below 4.5:1 in any theme mode,
and the shipped styles are at least 7:1 in every mode (the info style and the red-shift critical
color were raised for that in M2 P1). `audibleCue` stays `false` in M2 P1.

## Response mappings and result cards

A mapping is a result card (spec 4.1, 4.5; FR-060, UX-015, UX-016). It says what to show from one
source's answer: `{ id, queryType, sourceId?, persona?, when?, elements }`. When a source returns,
the browser reads the payload from `GET /api/v1/queries/{correlationId}` (see [api.md](api.md)),
holds it in memory only, picks a mapping and renders it as a card inside the request. Cards are
views over the stored payload, so a published change re-maps cards already on screen at the next
config refresh (15 seconds or window focus), without a reload.

**Which card is used.** A mapping qualifies when its `queryType` is the part's, its `sourceId` (if
set) is the source's, its `persona` (if set) is the user's persona, and its `when` (if set) holds.
The best score wins: `when` +4, `sourceId` +2, `persona` +1; equal scores go to the earlier mapping
in config order. Two mappings with the same query type, source, persona and `when` are the error
`config.duplicateMapping`. With no qualifying mapping the card is the generic dump (below).

A mapping's `when` is checked per part, against that part's own values only, never another part's.
For an also-run part those are the values the server planned for it (read from the request detail),
so until the detail arrives, or when the part was purged, its `when` does not match and the
unconditional card for that query type is shown.

**Elements.** Each element is one of:

| Kind | Settings |
|---|---|
| `value` | `path`, `labelKey`, `view`, optional `format`, `highlight` (default `true`). One labeled value. |
| `table` | `path` (an array of records), `labelKey`, `view`, `highlight` (default `true`), `columns` (at least one: `path` relative to one record, `labelKey`, optional `format`, optional `highlight`). One row per record. |

`view` is `summary` (shown on the card), `detail` (shown after the card's "Show detail" toggle) or
`both`. Summary is the default view for every persona, and the open state is kept in memory per
card. A card with no detail-only element has no toggle.

**Path language.** A path reads the source payload (an object):

| Form | Reads |
|---|---|
| `status`, `subject.last` | dot segments: own keys only |
| `warrants[0].offense` | `[n]`: one array index |
| `warrants[*].offense` | `[*]`: every element of the array, in payload order |
| `["key.with.dots"]` | a bracket-quoted key (JSON string syntax), for a key that holds `.`, `[`, `]` or `"` |

Resolution never throws. A path that is malformed or finds nothing yields no value and the element
is left out of the card (a diagnostic is kept; the development build lists it under the card). A
`value` joins the scalars it finds with ", " (one array level is flattened). A `table` path that
finds anything but a non-empty array of records is left out. Only strings, numbers and booleans
render; an object or array at a `value` path is left out too.

**Formats.** `text` (as sent), `upper` (locale upper case), `phone` (10 digits, or 11 starting with
1, as `(555) 010-0000`; anything else unchanged), `date` (an ISO `YYYY-MM-DD` value written as
`pattern` with the tokens `YYYY`, `YY`, `MM`, `DD`; other values unchanged) and `template` (`{value}`
replaced by the value). With no format, numbers show without digit grouping (a year reads 1901) and
an ISO date shows as `MM-DD-YY`. An unknown format is an error.

**Tables.** A table is a real `<table>` with a caption and column headers, in its own scroll box so
the page never scrolls sideways. A cell holds the scalars found at the column's path in that record.

**The generic dump.** With no qualifying mapping, the card shows every string, number and boolean
leaf in payload order, each labeled by its path, with keyword marks on and no toggle, under the
note "No card is set up for this result, so every field shows under its path." There is no size or
depth cap in M2 P1.

**Request entry and status lines.** Cards sit inside the request entry in "Requests this shift", one
card per `returned` source (an h4 in the primary part, an h5 in an also-run part). A `pending`,
`timedOut`, `failed`, `interrupted` or not-run source is one status line with its reason in words,
never a card. A skipped also-run part shows "Not run" and one sentence per `skipReasons` key. The
request header carries the highest severity over its returned sources. Announcements (spec 6.6) name
the query type, the primary typed field (the short correlation ID when it is empty), counts, status
words, severity and the configured keyword; never payload content.

**Shipped cards (default site).** One card per query type, each with `status` in both views and the
identifying values in the summary, the rest in the detail:

| Card | Summary | Detail |
|---|---|---|
| `veh-summary` | status, plate, remarks | state, make, model, year, VIN, owner name and address |
| `per-summary` | status, last and first name, remarks | date of birth, address |
| `pro-summary` | status, serial, description, remarks | property type |
| `wnt-summary` | status, last and first name, remarks | date of birth and a warrants table (offense, issued) |
| `dl-summary` | status, license number, remarks | last and first name, date of birth, state |

Identifiers such as the plate, VIN, serial, names and dates have `highlight: false`, so they render
plain, and the severity badge still scans them. A site that deletes a card gets the generic dump
for that type.

**The driver's license record.** The default mock holds one synthetic license record: license number
`ZZDLTEST` on the state source (Texas, `status: "VALID"`); every other `DL` query answers
`NO RECORD`. The fixture policy treats `licenseNumber` as an `other` leaf (see "Fixture policy").

**Checks.** `config:validate` and the builder check a mapping's query type, source, persona and
`when` references, its label keys in every listed locale and `config.duplicateMapping`. Resolving
mapping `path` values against the mock payloads in `config:validate` is M2 P2.

The builder edits all of this without JSON: see "Result cards, keywords and Try a match" under the
admin builder below. Design: the [design note](design/2026-10-07-result-card-config.md) and "Result
cards and the cards builder" in the [visual system](design/2026-09-29-visual-system.md).

## Personas

`personas` is an open list. Each persona picks one layout: `dispatch` (36 px controls, the
dispatcher default), `mobileUnit` (48 px targets, 16 px or larger text, no muted text) or `mobile`.
The shipped list is `dispatch`, `mobileUnit`, `mobile` and `records`. A user's stored persona beats
the device guess, so the officer demo account opens the mobile-unit layout on a desktop browser.

## Shortcuts

`shortcuts` replaces defaults per action key. A binding is `{ keys, context }`. `keys` is one or
more strokes separated by spaces (a chord), each stroke written
`[Ctrl+][Alt+][Shift+]<KeyboardEvent.code>`, such as `Ctrl+Backquote` or `KeyG KeyQ`. `context` is
`global`, `panel`, `results` or `terminal`.

| Action key | Default keys | Context |
|---|---|---|
| `focusTerminal` | `Slash` | global |
| `toggleMode` | `Ctrl+Backquote` | global |
| `quickType1` to `quickType9` | `Alt+Digit1` to `Alt+Digit9` | global |
| `submit` | `Ctrl+Enter` | panel |
| `selectPrev`, `selectNext` | `ArrowUp`, `ArrowDown` | results |
| `toggleDetail` | `Enter` | results |
| `deleteFromView` | `Delete` | results |
| `dismiss` | `Escape` | global |
| `shortcutSheet` | `Shift+Slash` | global |
| `goPanel`, `goResults` | `KeyG KeyQ`, `KeyG KeyR` | global |

Validation rejects two bindings with the same keys in one context, a chord whose first stroke is
another binding in the same context, a `global` binding that collides with any other, and a
single-key binding that types the terminal delimiter. That last rule is why `example-ok`, whose
delimiter is `/`, rebinds `focusTerminal` to `Ctrl+Slash`. The `results` shortcuts have nothing to
act on until results exist (M2).

## Theme

`theme` has `defaultMode` (`day`, `night`, `redShift` or `auto`, default `day`), `auto` (`off`,
`os` or `time`, default `off`; `defaultMode: "auto"` needs `os` or `time`) and `tokens`, which
override design tokens `all` or per mode (`day`, `night`, `redShift`). Overrides are checked for
contrast per mode (7:1 body text for the mobile-unit layout, WCAG AA elsewhere). The shipped
default site uses `defaultMode: "auto"` with `auto: "os"`. A user's own choice, saved with the
account, wins.

## Overlays

A site can build on a shipped one with `extends`. The overlay is merged over the base: arrays of
entities merge by `id`, `code` or `key`, and an entry with `"$remove": true` deletes an inherited
entry. `packages/config/sites/example-ok.json` extends `default` and changes behavior with config
only:

| Change in `example-ok` | Effect |
|---|---|
| `terminal.delimiter` is `/` | `NAM.` is refused as a missing delimiter; type `NAM/...`. |
| `shortcuts.focusTerminal` is `Ctrl+Slash` | Frees `/` for typing. |
| `defaults.state` is `OK` | The site default State is OK. |
| a `NAM` command with its own position order | `NAM/TESTERSON/SAMPLE/W/M/01011901` fills race and sex. |
| `$remove` on the `BOAT` property type | The Type picklist has no Boat. |
| a custom field `tagSticker` on `VEH` | Shows under More details. |

An overlay that gives a query type a `rules` list replaces that type's whole list, so restate the
rules you want to keep.

## Locales

Every `labelKey`, picklist label and error text is a message key, looked up in the bundle for the
user's locale. A key missing from any locale the site lists is an error. A site adds or changes
label text without a rebuild: the stored config version carries a label overlay, `{ locale: { key:
text } }`, laid over the bundled file. The admin builder edits it.

## Mock files

A site with a `mock` source needs `packages/config/mock/<siteId>.json` while
`ALLOW_MOCK_SOURCES=true`. The file is:

```json
{
  "siteId": "default",
  "sources": {
    "stateSource": {
      "latencyMs": [50, 400],
      "responses": [
        {
          "queryType": "VEH",
          "default": { "status": "NO RECORD" },
          "scenarios": [
            { "when": { "plate": "ZZ-0001" },
              "respond": { "status": "STOLEN", "plate": "ZZ-0001" } },
            { "when": { "plate": "FAIL1" }, "behavior": "error" }
          ]
        }
      ]
    }
  }
}
```

- `latencyMs` is a `[min, max]` range in milliseconds.
- Each query type a mock source serves needs a `responses` entry (`config:validate` checks this).
- A scenario names the field values it matches in `when`, and either a `respond` payload or a
  `behavior`: `timeout`, `error` or `credentialsRejected`, never both.

Scenarios shipped in the default site (the mock files are the full list):

| Query | Trigger | Answer |
|---|---|---|
| `VEH` plate `ZZ-0001` | state and national source | `STOLEN` |
| `VEH` plate `ABC123` | state source | `NO RECORD` |
| `VEH` plate `FAIL1` | state source | an error |
| `VEH` plate `TIMEOUT` | national source | a timeout |
| `PRO` serial `ZZSTOLEN1` | both sources (default site only) | `STOLEN` |
| `WNT` last `WANTED` | national source | `WANTED` |
| `WNT` last `MISSING` | national source (default site only) | `MISSING PERSON` |
| `DL` license number `ZZDLTEST` | state source | `VALID` (one synthetic record) |
| anything else | any mock source | the type's `default`, usually `NO RECORD` |

A submit now dispatches to the mock sources (ADR-0012). The mock adapter
(`packages/api/src/adapters/mock.ts`) serves the mock stored with the pinned config snapshot
(#493), never the file on the image, so a published version answers the same way for as long as it
is pinned. For each source request it:

1. picks the source's `responses` entry for the query type; an entry qualifies only if every one of its `types`
   keys equals the request's; among those the entry with the most `types` keys wins, ties by file order;
2. waits a random time in the source's `latencyMs` range;
3. takes the first scenario whose every `when` key equals the request's value (compared as
   strings), then answers with its `respond` payload or acts out its `behavior`, else answers with
   the entry's `default`.

An unknown source or query type fails only that call, as a `failed` source status, before any
latency wait and with no log line. A snapshot with no mock, or a mock that breaks the fixture
policy below, makes the adapter fail every call closed the same way and logs once per snapshot:
the `configHash` (and the `versionId` for a stored snapshot), the count and the JSON pointers of
the problems, never a value.

**`ALLOW_MOCK_SOURCES`.** A source of `kind: "mock"` is accepted only where the server runs with
`ALLOW_MOCK_SOURCES=true` (and the stored document carries a `mock`, see below). Without it the
server refuses to start with `mock sources need ALLOW_MOCK_SOURCES=true`, including when the
mock source comes from a stored config document rather than a file. Each planned source is
dispatched through its `adapter_kind` (`mock` today; the column is stored on the source result row
and on the dispatch job, so a real adapter slots in by kind later).

## Fixture policy and the generator

Mock payloads are free-form, so the fixture policy (spec 5.4, 10.8;
`packages/core/src/config/fixture-policy.ts`) is an allowlist of payload keys, not a deny list. It
walks every `respond` and `default` payload (never `when`, which holds trigger inputs) and reports
each violation by JSON pointer and key (`fixture.realPlate`, `fixture.validVin`,
`fixture.plausibleDob`, `fixture.nonSyntheticName`, `fixture.nonExampleAddress`,
`fixture.freeTextDigits`, `fixture.unknownKey`). Keys are normalized before lookup: lower-cased,
`_` and `-` removed. Any key not listed is `fixture.unknownKey`.

`FIXTURE_LEAF_KEYS`, by kind:

| Kind | Keys | Value must be |
|---|---|---|
| `plate` | `plate` | `ZZ-` and four digits, e.g. `ZZ-0001` |
| `vin` | `vin` | 17 valid characters that FAIL the ISO 3779 check digit |
| `dob` | `dob`, `dateofbirth`, `birthdate`, `issued` | a real date in 1901, `YYYY-MM-DD` |
| `name` | `last`, `first`, `middle`, `name`, `lastname`, `firstname`, `middlename`, `surname`, `ownername`, `registeredowner` | every word in `SYNTHETIC_NAMES` |
| `address` | `address`, `street`, `addressline1` | one to four digits and `Example Ave` |
| `status` | `status` | a scalar with no run of 4 or more digits, counted across separators as for `other`; an exponent-form number (`1e21`) is rejected |
| `freeText` | `remarks`, `note`, `caution`, `description`, `offense` | text with no digits at all |
| `container` | `vehicle`, `owner`, `owners`, `subject`, `warrant`, `warrants` | an object or array, checked in turn |
| `other` | `make`, `model`, `year`, `type`, `state`, `serial`, `propertytype`, `agency`, `licensenumber` | a scalar with no run of 4 or more digits, counted across separators, where every character that is not a letter or a decimal digit is one, and a digit is a digit of any script (so `123-45-678` and `123,456,789` are rejected); an exponent-form number (`1e21`) is rejected; `year` may be 1901 to 1999 |

`SYNTHETIC_NAMES` is `TESTERSON`, `SAMPLEWORTH`, `EXAMPLESON`, `SAMPLE`, `TEST`, `TESTER` and
`EXAMPLE` (compared upper-cased).

The checks run in five places: `config:validate` (mock files), the admin draft check (a draft's
mock), the web admin mock editor (`apps/web/src/admin/mock-model.ts`), the mock adapter (each snapshot's mock, as above) and the generator.

**The generator.** `scripts/mock-data/generate.ts` builds each site's mock file from fixture-safe
builders (`scripts/mock-data/builders.ts`, site tables under `scripts/mock-data/sites/`), so the
output passes the policy by construction, and it still checks before writing:

```
pnpm tsx scripts/mock-data/generate.ts <siteId>   # write packages/config/mock/<siteId>.json
pnpm tsx scripts/mock-data/generate.ts --check    # exit 1 naming each file that differs
```

The output is deterministic (sorted keys, 2-space JSON, LF), so the committed files in
`packages/config/mock/` (`default` and `example-ok`) are edited by changing the generator and
regenerating, not by hand.

## Checking and migrating config

```
pnpm config:validate                     # every file in packages/config/sites and packages/config/test
pnpm config:validate <file> [<file> ...] # named files
pnpm config:validate --resolved          # also print each file's merged (extends applied) config
pnpm config:migrate <file>               # bring an older config up to the current schemaVersion
```

`config:validate` runs the same chain the server runs at start: migrate, merge the `extends` base,
strict parse, the referential checks (duplicate and unresolved ids, field and picklist references,
literals that do not fit their field, command and shortcut checks, contrast per theme mode, locale
coverage) and the mock coverage. Each problem prints on one line as
`ERROR <file> <json-pointer> <key> <params>`; a warning prints as `WARN`. The command exits 1 when
any file has an error and 2 on bad usage. `--diff <tag>` is refused until M2 P2.

`config:migrate` applies the migration steps in order and writes the file in place, printing one
`migrated <file>: <from> -> <to>` line per step. With nothing to do it says the file is already at
the current version. The server also migrates in memory at start, logging a warning per step.

`pnpm verify` runs `config:validate` over the shipped and test configs, so a site config that does
not validate fails CI.

## The admin builder and the config store

The admin console at `/admin` edits and publishes the live config (ADR-0011). It is lazy-loaded and
shown only to the `admin` and `implementer` roles, behind the `adminConfig` feature. The `admin`
role also gets Users and roles (the `adminUsers` feature). The audit log entry is listed but not
built (the `adminAudit` feature, M2).

**Roles.** `implementer` edits and publishes config only: no users, no queries (a submit answers
`403 forbidden`). `admin` does all of that and also manages users, roles and sessions.

**The loop.**

1. **Edit.** The builder has a form over every section, a Raw JSON tab and a Changes tab. The
   status line reads "Draft, based on version N" with a count of unpublished changes. One shared
   draft exists per site; saving needs the draft's base to be the live version.
2. **Preview.** "Live preview" is the dispatcher's own query panel fed with the draft, with "Preview
   as" Dispatcher or Officer. Submit is off in the preview. If the draft is invalid the preview
   pauses and shows the last valid version.
3. **Check.** Diagnostics show at their controls and as a count ("Draft checks: N errors, M
   warnings"). The browser runs the same rules as `config:validate`, with the label keys checked
   against the shipped strings plus the draft's own overlay, as the server does. That label check
   is exact for English only: the browser holds the shipped English file, but for another locale
   it cannot tell a shipped string from a live overlay entry, so it treats every live overlay key
   as unshipped and may show an error the server would not (reverting an override of a shipped
   label, for one). It is not the whole chain: "Review and publish" runs the full server chain and
   may show more or fewer issues (a locale whose shipped file only the server holds, for one). The
   server's Review is authoritative, and publish is decided there.
4. **Publish.** "Review and publish" shows the changes against the live version; confirming
   publishes the draft as the next version and makes it live in one step. Publish is refused while
   any validation error remains. A publish writes the audit row `configPublished` (JSON pointers of
   what changed, never values).
5. **Reach dispatchers.** Open dispatcher forms refetch config every 15 seconds and on window
   focus, keep what the user typed, and announce "The form was updated by your administrator." A
   submit built from the old config gets `409 configHashMismatch`, and the client refetches.
6. **History and roll back.** "History" lists versions, newest first, each with Export and Roll
   back. Rolling back publishes an older version's document as a new version; history is never
   rewritten. If the live version changes while a draft is open, the builder shows "A newer version
   was published" with "Load the latest".
7. **Export.** A version exports as `<siteId>-v<n>.json`, so config can round trip through git:
   export, review in a pull request, and publish the same document.

The store holds one document per version: the `siteConfig`, the label overlay, and, only where
`ALLOW_MOCK_SOURCES=true`, the mock file. Routes for all of this are in [api.md](api.md).

### Result cards, keywords and Try a match

Three parts of the builder edit the response config (M2 P1). They share the builder's draft, undo,
Changes tab, Review and publish, history and roll back, and add no schema, route or migration.

**Result cards** (a tree group between Query types and Site). Each query type lists its cards in
config order, numbered and named by what narrows them ("All results", a source or persona name, or
"Only when a rule matches"), with "Add card". The card editor has:

- **Applies to:** Source (any, or one of the query type's sources), Shown to (everyone, or one
  persona) and "Use this card" (always, or only when a rule matches, using the same sentence rule
  editor as field rules). A card whose source, persona and rule equal another's shows
  `config.duplicateMapping` with "Open <other card>", and Review and publish stays blocked.
- **Which card wins:** a table over each source and persona (and the rule values the cards test)
  naming the winning card and why, as its score and a reason ("score 2, source +2", "score 0, only
  card that fits"; the other reasons read "rule +4", "persona +1" and "earlier in the list"); the rows
  this card wins are tagged "This card". It uses the same scoring as the dispatcher's
  mapper.
- **Rows:** one item per element with Edit, Move up, Move down and Remove. A row has Kind (value or
  table), Path (free text, with the paths found in the draft's mock answers as pick buttons), the
  label shown to users (stored as a message key under `mapping.<cardId>.` with its text in the
  label overlay), Show in (summary, detail or both), Format (as sent, upper case, phone number, date
  MM-DD-YY, template) and Mark keywords. A table row has Columns (path relative to one record, label,
  format, mark keywords). A path found in no mock answer is a warning, not an error: a source answer can carry paths no
  mock answer shows, and until one does the card leaves the row out.
- **Advanced settings:** the card key (fixed once published) and the label key prefix.

The right pane, **Card preview**, renders the production result card (the same component and mapper
as the dispatcher's request entry) with the draft's cards, keywords and styles. Pick a mock source,
then either pick a scenario of the draft's mock or type values: typed values go through the same
matcher the mock adapter uses (`matchMockScenario`, spec 5.4), and the pane says which scenario or
default answered and whether this card was the one used. The Dispatcher and Officer buttons at the top
of the pane switch the layout the card is drawn in. A behavior scenario (timeout, error,
credentials rejected) previews the status line, not a card. Typed values stay in the pane.

**Keywords and severity** (the last child of the Result cards group). Keywords are a table: keyword,
severity and exception phrases (add and remove), with Add keyword. The three severity styles each
have text and background color token pickers, bold, icon and marker, a live sample and the contrast
ratio per theme mode: below 4.5:1 is an error that blocks publish, 4.5 to 7:1 shows "(under 7:1)" and
does not block. The right pane shows a sample line to try a keyword or an exception.

**Try a match** (the mock editor's right pane). Pick a source and a query type, type the query's
field values, and the pane shows which scenario matches or that the default answers, which response
of the source answered and how long it waits, then the answer as the production Result card, or, with
the Payload button, as read-only JSON. Same matching as the adapter; nothing is sent and the typed
values are never saved.

**Review and publish** lists the changes in plain sentences, one per change, in two lists named
"Result cards" and "Keywords and severity" (card ids, row labels and paths, keyword text and severity;
never payload content or typed values). A publish reaches open dispatcher tabs at the next config
refresh, and cards already on screen are redrawn with the new settings; a label added in the builder
reaches a tab already open only after it reloads, because a refresh does not refetch the locale
bundle.

## Not yet built

| Topic | Where it lands |
|---|---|
| Mapping paths resolved against mock payloads in `config:validate` | M2 P2 |
| Credentials, delegation, delete from view (`credentials`, `delegation`, `resultHide`) | M3 |
| Audit viewer (`adminAudit`) | M2 P2 |
| `pnpm config:validate --diff <tag>` | M2 P2 |
