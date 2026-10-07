# Result cards in the builder (M2 P1 design note)

Date: 10-07-26 (session "M2 P1 planning"). Scope: how an admin or implementer configures the result cards that M2 P1 shows inside each request, where that configuration lives, and how the fixture policy applies. Plans: `docs/superpowers/plans/2026-10-07-m2-track-a-p1.md`, `docs/superpowers/plans/2026-10-07-m2-track-b-p1.md`. Rulings D-M2P1-1 to D-M2P1-4 (developer 10-07-26) are in the Track B plan.

## Data model: no new schema

A result card is a `ResponseMapping` (spec 4.1, 4.5), already in the frozen site config schema (`packages/core/src/config/schema.ts`, M2 P0 Task 3 freeze review) and already served to clients in `ClientSiteConfig` (`client-config.ts`):

| Builder term | Site config | Notes |
|---|---|---|
| Card | `siteConfig.responseMappings[i]` `{ id, queryType, sourceId?, persona?, when?, elements[] }` | `queryType` required; `sourceId`, `persona`, `when` narrow it |
| Card row | `elements[j]`: `value` `{ path, labelKey, view, format?, highlight }` or `table` `{ path, labelKey, view, highlight, columns[] }` | `view` is `summary`, `detail` or `both` (UX-015); table is the UX-016 grid |
| Row label | `labelKey` plus its text in the document's locale overlay (`ConfigDocument.locales[locale][labelKey]`) | the builder mints a fresh `MessageKey` under `mapping.<cardId>.` and edits the text, as the label editor does for fields (`LabelOverlay.tsx`) |
| Keyword | `siteConfig.keywords[k]` `{ keyword, severity, except? }` | drives `highlight` and `assessResult` (spec 4.5) |
| Severity style | `siteConfig.keywordSeverityStyles.{critical,warning,info}` `{ color, background, bold, icon, marker, audibleCue }` | colours are theme token keys; `validateSiteConfig` checks 4.5:1 contrast |

So the whole feature is editing and previewing existing config: no `schema.ts` change, no contract change, no migration, and publish, rollback, history, the `configHash` 409 and the 15 s client refresh work unchanged (ADR-0011).

## Where it lives in the builder

- A new top-level tree group **Result cards** (collapsible like the other groups, #586), between Query types and Site config. Children: one node per query type with its cards in config order, then a **Keywords and severity** node. Pointers: `/siteConfig/responseMappings/<i>`, `/siteConfig/keywords/<k>`, `/siteConfig/keywordSeverityStyles/<severity>`.
- The generic site-config form keeps `responseMappings`, `keywords` and `keywordSeverityStyles` (raw editing stays possible); the purpose-built editors are the default view.
- Card editor: query type (fixed by the node), optional source (picklist of the type's sources), optional persona (picklist of site personas), optional `when` (the existing `ConditionEditor` from `RulesEditor.tsx`, over the type's fields), and the row list (add, remove, move; value or table; path; label text; view; format; highlight; table columns). The editor shows which card wins for a context (spec 4.5 score: `when` +4, source +2, persona +1; equal keys are rejected with `config.duplicateMapping`, shown inline).
- Path picker: options are the leaf and array paths found in the draft's mock payloads for that query type (default and every scenario `respond`, across sources or only the card's source). Free text is allowed for paths a future real source returns; a path that resolves in no mock payload gets an inline warning. Server-side resolution of every mapping path in `config:validate` stays M2 P2 (spec 12.3 Core P2).
- Preview: the production `ResultCard` (one renderer for preview and production, ADR-0011 decision 4), fed by core `mapResponse`, `assessResult` and `highlight` with the draft config. Input: choose a mock source, then either pick a scenario from the list or type values and let the shared matcher (`matchMockScenario`, #565, Track A Task 2) choose the scenario the server would. A behaviour scenario (timeout, error, credentials rejected) previews the status line, not a card. The summary and detail toggle works in the preview.
- Review and issues: card and keyword changes listed by pointer and id (never payload values); diagnostics in the issues list with jump-to.

## Runtime

- Payloads reach the client through `GET /api/v1/queries/:correlationId` (Track A), are held in memory only (spec 6.7) and are mapped in the browser with the current config. A publish therefore re-maps cards already on screen at the next config refresh (cards are views over the stored payload). Planner default; the M2 P1 plans test it.
- `assessResult` scans the raw payload independent of the mapping, so an unmapped or detail-only STOLEN still badges the summary card, the entry row and the announcement (spec 4.5, 6.6).

## Fixture policy (spec 5.4, 10.8; SEC-002)

- Cards hold paths, label keys, formats, view flags and conditions: no record data. Label text is UI text in the locale overlay, like field labels today.
- Preview payloads come only from the draft's mock, which the builder checks with `checkFixturePolicy` and the server enforces on draft save, validate, publish and rollback (M2 P0.5). The preview never fetches a stored query result.
- Values typed into "Try a match" or a card's `when` literals are inputs (exempt, like mock `when` triggers). Try-a-match values live in component state only: never in the draft, the document, storage, logs or announcements.
- Payload content stays inside the admin console (builder) and the owner's request entries; announcements carry query type, reference, counts, status words, severity and configured keyword text only.

## Out of scope for M2 P1

`config:validate` mapping-path resolution against mock payloads and the release-note `--diff` (M2 P2); audible cues (`audibleCue` stays false); purged and retention display (M2 P2); hide from view (M3 P2).
