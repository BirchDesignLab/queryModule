---
date: 09-29-26
status: accepted
track: b
phase: m1-p3
supersedes: ["spec 6.2 (the query-type selector is always shown)"]
---

# 0010 Quick-access buttons pick the query type; type fields are the subtype control

## Context

Demo feedback 09-29-26: the query panel showed the quick-access buttons (Vehicle, Person, Property) and, under them, a "Query type" select repeating the same choice. Two controls for one decision confuses the reader and costs a tab stop. If the buttons pick the query type, the control under them should pick the subtype. Spec 4.1 "Type fields" says there is no subtype entity: a subtype is a field with `role: "type"` (for example `propertyType` on PRO). This was decision D-B15 of the Track B P3 plan.

## Options

- (a) Show the select only for types with no button; render the selected type's `role: "type"` fields directly under the bar.
- (b) Option (a), plus `WNT` in the default site's `quickAccess`, so the default panel shows four buttons and no select.
- (c) Option (b), plus a new "plate versus VIN" subtype for VEH.

## Decision

Option (b) (developer, 09-29-26). Option (c) is not ruled: no such subtype exists in the shipped config, and plate-only mode stays derived (spec 4.3).

- The quick-access bar picks the query type (FR-007), as before.
- The query-type select renders only for types that have no button, labelled "Other query types" (`form.otherQueryTypes`), with an empty first option meaning "none of these". It is hidden when every type has a button. With an empty `quickAccess` it lists every type under "Query type" (`form.queryType`).
- `TypeFieldBar` renders the selected type's visible `role: "type"` fields under the bar, through `FieldRenderer`. `QueryForm` gets them in `excludeKeys` so they are not repeated in a section; a section left empty is not rendered. Rules, required flags, defaults and errors are unchanged (they are still `FormState` fields); only the position moves. Nothing is per query type (BR-001).
- The bar is hidden with the form in terminal mode: presets and positions set type fields (spec 4.4).
- `goPanel` (`G Q`) focuses the pressed quick-access button, else the select.
- `packages/config/sites/default.json` `quickAccess` becomes `["VEH", "PER", "PRO", "WNT"]`; `example-ok` inherits it (arrays replace whole). `Alt+Digit4` (`quickType4`) now selects Wanted check.
- DL added 09-29-26 (developer): the example-query wave (#379) added the `DL` query type, so `quickAccess` becomes `["VEH", "PER", "PRO", "WNT", "DL"]` and the default panel keeps five buttons and no select; `Alt+Digit5` (`quickType5`) selects Driver's license.

## Consequences

- Spec 6.2's query-type selector is conditional: it is shown only for types without a quick-access button.
- FR-007 reads: "reachable from a quick access button as well as the standard Query Module tab" names the host's Query Module tab, which is this panel, not a second in-panel selector. Every type stays reachable by a button, by the "Other query types" select (when a site leaves types off `quickAccess`) or by its terminal command.
- The e2e helper `chooseQueryType(page, code)` presses the quick-access button, else uses the "Other query types" select.

Covers FR-007, FR-030, FR-031, FR-032, BR-001, UX-004.
