## 6 Apps

### 6.1 Personas

Persona is resolved in this order, first hit wins:

1. Host context: in embedded mode the host's `init` message names the persona (6.9); in `packages/rn-ui` it is a prop.
2. The user's stored override (`user_preference.persona_override`).
3. Device heuristic: native means `mobile`; web with `(pointer: fine)` means `dispatch`; web with a coarse pointer means `mobileUnit`.

Width never selects a persona, so browser zoom cannot swap layout or response mapping. The heuristic is re-evaluated only when the pointer media query changes and neither host context nor an override applies; an override or a host persona disables re-evaluation.

Personas are the open list `SiteConfig.personas` (`PersonaDef { key, labelKey, layout }`, 4.1). `ResponseMapping.persona` references a key from it. Layout components are a fixed set in code (`dispatch`, `mobileUnit`, `mobile`); a persona picks one of them plus its own response mappings. Shipped personas: `dispatch`, `mobileUnit`, `mobile`, and `records` (dispatch layout, Records-oriented mappings, for CAD Records and Records-only hosts). A Mobile Field Reporting host selects an existing persona through host context [open].

Persona selects layout and response mapping only. It never changes what data is fetched. The keyboard model (6.4) applies in every web persona.

Covers UX-001, UX-012, UX-014, BR-002, PLT-006.

### 6.2 Screens and semantics

Phase 1 screens: login (standalone mode only); query panel (query-type selector, form or terminal toggle, source checkboxes, quick-access bar, FR-007); results list; credentials settings; preferences (persona override, layout orientation, terminal layout, theme mode, locale); admin audit viewer. M3 adds the delegation screens below; M4 the mobile home with quick queries (6.10). A screen whose `features` flag is off is not rendered (5.8).

**Generic field renderer.** Forms render only from core's `FormState` (4.3): fields in `order`, grouped by section under `sectionLabelKey`, picklist options from the filtered enabled options, labels from `labelKey`. No per-query-type UI code exists (BR-001). A field with `isDefault` shows a text tag "default"; typing makes it a user value.

- Required indicator: label text, an asterisk (`aria-hidden`), visually hidden "required", and `aria-required="true"` on the input. Never colour alone. Styled by the `field.required` token (6.5).
- Blocked submit (Enter or Submit, FR-006): each field in `missingRequired` or `invalid` gets `aria-invalid="true"` and an inline message linked by `aria-describedby`, rendered from its `{key, params}` through the locale bundle. Focus moves to the first invalid field in render order. The announcer (6.6) says the count ("3 fields need attention").
- A field revealed by a rule (A2's Plate Type) is announced politely with its label and required state. Focus does not move.
- Terminal errors: every error from `tokenize` and validation (4.4) renders in a list under the terminal input, linked by `aria-describedby`. The input keeps focus and its text.
- Submit uses `aria-disabled="true"`, never `disabled`, so it stays focusable, with a visible reason linked by `aria-describedby`: submitting (until the 202 settles, 6.7), no connection (6.8), client update required (6.7).

**Semantics.** Web builds these as shared primitives in `packages/web-ui`. `packages/rn-ui` builds the same list with `accessibilityRole`, `accessibilityState` and `accessibilityLabel`.

| Control | HTML element | Role and states |
|---|---|---|
| Query-type selector | `<select>` + `<label>` | implicit combobox; selected option |
| Quick-access bar | `<nav aria-label>` of `<button>` | `aria-pressed` on the current type |
| Form or terminal toggle | `<button>` | `aria-pressed` (true = terminal) |
| Source checkboxes | `<fieldset>` + `<legend>` + `<input type="checkbox">` | checked; `aria-disabled` when unavailable |
| Form section | `<fieldset>` + `<legend>` from `sectionLabelKey` | none extra |
| String field | `<input type="text">` + `<label>` | `aria-required`, `aria-invalid`, `aria-describedby` |
| Picklist field | `<select>` + `<label>` | as string field |
| Date and number fields | `<input type="text" inputmode="numeric">` (`decimal` for decimals) | as string field; accepted formats in the description |
| Boolean field | `<input type="checkbox">` + `<label>` | checked |
| Terminal input | `<input type="text" autocomplete="off" spellcheck="false">` + `<label>` | `aria-describedby` to the error list |
| Submit | `<button type="submit">` | `aria-disabled` + described reason |
| Results list | `<ul>`, one `<li>` per request | list |
| Request entry | `<section aria-labelledby>` headed by query type and type-field values | none extra |
| Source result | `<section aria-labelledby>` headed "source: status" | status in text, never colour alone |
| Severity badge | `<span>`: icon (`aria-hidden`) + text | text carries severity |
| Highlighted keyword | `<mark>` + severity `marker` text | marker never colour alone |
| Summary or detail toggle | `<button aria-expanded aria-controls>` | expanded |
| Value element | `<dl>`: `<dt>` label, `<dd>` value | label names the value |
| Table element (UX-016 grid) | `<table>` + `<caption>` + `<th scope="col">`, inside `<div role="region" tabindex="0" aria-labelledby>` | scrolls in its own container |
| Delete from view | `<button>` + modal `<dialog>` confirm | focus into dialog; after confirm, to the next entry, else the list |
| Dialogs | `<dialog>` via `showModal()` | `aria-labelledby`; Esc closes; focus returns to opener |
| Connection indicator | icon + text | changes announced (6.6) |

**Results list.** Each request entry shows query type, type-field values, the correlation ID as a copy button, and the ack time (MM-DD-YY HH:mm:ss local). Parts nest under the entry: part 0, then each nested part labelled with its `alsoRun` origin. Each part lists its sources with status: `pending`, `returned`, `failed`, `timedOut`, `interrupted`, `credentialsMissing`, `credentialsRejected`; a skipped nested part shows `skipped` and its reason. Entry, card and notification always carry the severity badge from `assessResult` (4.5), computed over the whole payload independent of mapping: icon, text and colour, plus the `marker` from `keywordSeverityStyles`. A STOLEN flag mapped detail-only still badges the card. With no matching mapping the card renders core's generic key and value dump. Keyword hits render as `<mark>` with severity style and marker; elements with `highlight: false` render plain.

**Credential statuses (SEC-002).** `credentialsMissing` or `credentialsRejected` on the user's own credential links to the editor at `/settings/credentials/:sourceId?returnTo=<entry>`. After saving, the entry offers "Retry this source": a new submission (new correlation ID, new Idempotency-Key) with that part's query type and user values and only that source, shown linked to the original [open: from a nested part it resubmits as a primary part]. When the credential belongs to a delegating officer (from the `source_result` snapshot), the card names the officer and offers no editor link.

**Toasts.** Supplementary; the entry holds the lasting record. The ack toast is driven by the 202 alone and shows correlation ID and ack time. Toasts stay at least 10 s, pause on hover or focus, have a dismiss button, and are announced politely (6.6).

**Terminal layout.** `user_preference.layout.terminal`: `"toggle"` (M1, terminal replaces the form in the panel) or `"pane"` (M2, terminal beside results, same draft store, 6.7). FR-050 is partial until M2 (11).

**Delegation screens (M3).** Titles come from the purpose's `labelKey`, never hard-coded "training".

- Trainee request dialog: purpose (when more than one), sources, duration up to the purpose cap (default 480 min). Submit shows the 6-character code, a QR code of `https://<origin>/delegate#code=<code>`, and a 5-minute countdown. It closes on `delegationChanged` to `active`, or shows expired on `requestExpired`.
- Officer approval at `/delegate` on the officer's own device and session: enter the code or open the QR link; the preview shows trainee, purpose, sources and duration; the officer may narrow sources or shorten duration. For each source in `missingCredentials` the screen names it and links to the credential editor, returning to the approval. Approve runs step-up first when required (password within 5 min or TOTP, 5.6).
- Trainee banner: persistent, not dismissable, on every screen while a delegation is active: "Using <officer>'s credentials for <sources> until HH:MM". It opens a dialog listing sources and expiry with "End delegation" (revoke).
- Delegations list, both parties: active and last 24 h from `GET /api/v1/delegations`, each with revoke.
- Officer delegated queries: read-only list from `GET /api/v1/me/delegated-queries`, same entry component with hide absent.
- On `delegationChanged` the client refetches `GET /api/v1/delegations`; banner and lists follow.

Every Playwright scenario runs axe (10). A2 and A3 assert invalid-field association, focus move and announcement.

Covers FR-005, FR-006, FR-007, FR-043, FR-044, FR-050 (partial), FR-062, FR-064, SEC-002, SEC-003, SEC-004, SEC-011, SEC-014, UX-004, UX-010, UX-015, UX-016.

### 6.3 Mobile unit layout

Designed at 1024x768 first, verified at 1366x768 and 800x600 (scrolling allowed at 800x600). Single column, no side panels. Query panel and results stacked, results collapsible. Minimum touch target 48x48 CSS px, minimum body text 16 px, no reliance on hover, focus or colour alone.

- Contrast: body text 7:1 in every mode of the mobile unit layout, day included (6.5). A manual daylight check on a Toughbook-class screen is an M4 exit item.
- Condensed cards show summary elements and the severity badge (6.2), always. Detail is one tap behind a `<button aria-expanded>`.
- Orientation preference switches horizontal versus vertical value layout (UX-013), saved in `user_preference.layout`.
- Tables scroll horizontally in their own container; the page does not scroll horizontally except at 800x600.
- Reflow: at 200% zoom and at 320 CSS px width, content reflows to one column with no loss of function; only table containers scroll.

Playwright runs the three viewports; 1920x1080 at 200% zoom asserting persona and response mapping do not change (6.1); and 1024x768 with STOLEN in a detail-only element asserting the card shows the critical badge.

Covers UX-002, UX-010, UX-012, UX-013, UX-014.

### 6.4 Keyboard model

A shortcut engine in `packages/web-ui` serves every web persona. Bindings use `ShortcutMap` (4.1): each stroke is `[Ctrl+][Alt+][Shift+]<KeyboardEvent.code>`, strokes separated by spaces form a chord. Codes are layout-independent; the shortcut sheet shows each code's label for the current layout where the browser exposes it, else the code.

- Single keys (no modifier, or Shift only) are inert while focus is in an `input`, `textarea`, `select`, contenteditable element or the terminal.
- Combos (Ctrl or Alt) and chords fire anywhere unless the focused text input consumes the key. Standard editing combos (Ctrl+A, C, V, X, Z, Y) are never bound.
- A chord whose first stroke is a single key is therefore inert in text inputs. A pending chord times out after 1000 ms [open].
- Context: `global` always applies; `panel`, `results` or `terminal` applies while focus is inside that region. A binding in the focused context wins over a `global` binding with the same keys.
- Config validation rejects: two bindings with the same keys in one context; a chord prefix equal to another binding in the same context (`KeyG` with `KeyG KeyR`); a single-key binding whose character equals `terminal.delimiter`, resolved on a US layout [open].
- `siteConfig.shortcuts` overrides the default map per action key.

Default map:

| Keys | Context | Action key: behaviour |
|---|---|---|
| `Slash` | global | `focusTerminal`: focus terminal input |
| `Ctrl+Backquote` | global | `toggleMode`: form or terminal |
| `Alt+Digit1` to `Alt+Digit9` | global | `quickType1..9`: select quick-access query type by position |
| `Enter` in a form field | panel | native form submit (FR-006), not an engine binding |
| `Ctrl+Enter` | panel | `submit` |
| `Enter` in terminal | terminal | parse and submit (FR-053) |
| `ArrowUp` / `ArrowDown` | results | `selectPrev` / `selectNext` |
| `Enter` | results | `toggleDetail` |
| `Delete` | results | `deleteFromView`, with confirm |
| `Escape` | global | `dismiss`: close dialog or clear selection |
| `Shift+Slash` | global | `shortcutSheet` |
| `KeyG KeyQ` | global | `goPanel` |
| `KeyG KeyR` | global | `goResults` |

Every interactive element is in the tab order with a visible focus ring (`focus.ring` token). Playwright drives the plate query and the terminal query keyboard-only from M1.

Covers FR-006, FR-007, FR-051, FR-053, FR-056.

### 6.5 Tokens and themes

`packages/tokens` is the single source for colour, spacing, type, radius and motion, as semantic tokens (`color.text.body`, `color.surface.base`, `color.severity.critical.bg`, `focus.ring`, `field.required`) with a value per mode. A build step emits CSS custom properties for web and a typed theme object for React Native. Components use no literal colour or size.

Modes:

- `day`: light surfaces.
- `night`: dark surfaces.
- `redShift`: low-blue dim mode for in-vehicle night work; amber and red on near-black, no blue-dominant colours.

Selection: `user_preference.theme_mode` is `day`, `night`, `redShift` or `auto`; unset falls back to `SiteConfig.theme.defaultMode` (4.1). `auto` follows `SiteConfig.theme.auto`: `os` maps a dark OS scheme to `night`, `time` uses `night` from 19:00 to 07:00 local [open]. Web sets `data-theme` on `<html>`; native swaps the theme object; no reload. Motion tokens drop to zero under reduced-motion settings.

Site overrides: `SiteConfig.theme.tokens` overlays token values for all modes or one mode. Unknown token names fail validation.

Contrast validation runs in `config:validate` and in the tokens package tests, per mode, over declared foreground and background pairs: mobile unit body text 7:1; elsewhere text 4.5:1 and non-text UI (focus ring, required marker, badge edge) 3:1; severity styles 4.5:1 (4.1).

Covers UX-002, UX-011, BR-001.

### 6.6 Announcements and focus

One announcer. Its queue lives in `packages/client`; web binds it to two live regions present from first render (`role="status"` polite, `role="alert"` assertive); native binds it to `AccessibilityInfo.announceForAccessibility`.

- Polite: ack, source status changes, timeouts, validation counts, rule-revealed fields, connection changes, delegation changes.
- Assertive: only when `assessResult` severity is `critical`.
- Coalesced per correlation ID: status messages for one request within 1500 ms merge into one, such as "VEH ZZ-0001: 2 of 2 sources returned, critical: STOLEN" [open: window length].
- Incoming events never move focus. Entries insert without remounting the focused row: stable keys (correlation ID, part, source), selection tracked by id, and the focused row is never virtualised away.
- Audible cue per severity when `SeverityStyle.audibleCue` is true (default false); one built-in sound per severity.

Playwright test: type in a field while a result arrives; assert focus, input value and live-region text.

Covers FR-043, FR-044, FR-064, FR-065 (foreground).

### 6.7 State and data

`packages/client` is shared by `apps/web` and `apps/mobile`: API client generated from the committed OpenAPI document, WebSocket client with replay cursor, Zustand stores, TanStack Query hooks, selectors and the announcer queue, each tested (threshold in 10).

**Draft.** The canonical draft is user values per field, held in Zustand with mode, query type and selected sources. Effective values never enter it; `setDefault` never touches it (4.3). The form renders `evaluateForm(draft)`. The terminal text is a derived view:

- To terminal: pick the command whose `presets` match the draft's type-field values, most specific first; text is `formatCommand` of the user values. No match: empty text, draft kept.
- Terminal typing: the `tokenize` result merges into the draft. Positioned and named `key=value` values replace their fields; fields the command does not name are never erased.
- An "n fields not shown" indicator appears in terminal view when the draft holds non-empty user values the command text does not show; activating it lists them.
- To form: uses `tokenize`, which always returns values, so a failing command keeps what was typed.
- The round-trip property is stated in 4.4.

**Submit.** The client POSTs query type, the draft's user values, `mode`, selected sources and `configHash`, with `Idempotency-Key` and `X-Requested-With` headers (5.2). The key is generated per submit intent and reused while the draft is unchanged, so pressing Submit again after a lost response retries the same request; any draft edit starts a new key. Submit stays `aria-disabled` until the 202 or an error settles. On the 202 the client sends `ackReceipt` over the socket (NFR-004 metric, 4.7). A 409 on `configHash` refetches config, re-evaluates the draft and asks the user to resubmit.

**Events** (5.3, 4.7). `sourceStatus` is forward-only: a status that is not later than the cached one is ignored. Events carry references only; the client dedups by the per-user `seq` high-water mark, then fetches `GET /api/v1/queries/:correlationId`. An event for an unknown correlation ID (it can beat the 202) creates a placeholder entry that the fetch fills. `resultHidden` removes results from cache. `resync` refetches the list and sets the mark to `latestSeq`.

**Regulated data on the client.** Nothing from queries, drafts or config goes to persistent storage: no TanStack persister, no `localStorage`, IndexedDB or AsyncStorage for them, no service worker in Phase 1. Native keeps only the bearer token, in SecureStore. On logout, 401 or a change of user id: clear the query cache, reset every store, close the socket, clear the announcer. `Cache-Control: no-store` comes from the server (5.9).

**Versions and locale.** At start the client reads `GET /api/v1/meta`; below `minClientVersion` it shows "update required" and submit stays `aria-disabled`. Strings come from `GET /api/v1/locales/:locale` for `user_preference.locale` (one of `SiteConfig.locales`). Numbers and times format through `Intl`; dates display as MM-DD-YY. Every core and API error renders from `{key, params}`.

Covers FR-056, FR-064, FR-065 (foreground), NFR-001, NFR-003 (partial), SEC-006, SEC-014.

### 6.8 Connectivity

- Heartbeat: `ping` every 20 s; two missed `pong`s mark the socket stale, close it and reconnect. `readyState` alone is never trusted.
- Reconnect: exponential backoff from 1 s to 30 s with full jitter, reset after a successful open and first `pong`. The client sends `hello` with its `lastSeq` for replay (4.7), then refetches over HTTP every entry that still has a `pending` source.
- While the socket is down, entries with a `pending` source are refetched at the backoff interval [open].
- Indicator: icon plus text (connected, reconnecting in n s, offline); changes announced politely.
- Submit is gated on HTTP reachability, not socket state: gated when a request fails with no response or `navigator.onLine` is false; ungated when `GET /api/v1/health` next succeeds, polled on the same backoff. While gated, submit is `aria-disabled` with the visible reason "No connection to server".
- No offline queue. The draft stays in memory; a retry reuses the Idempotency-Key (6.7).

Covers NFR-003 (partial), FR-043, FR-065 (foreground).

### 6.9 Embedded mode

Two modes (3): standalone (Better Auth login, the demo) and embedded. In embedded mode a web host loads `https://<origin>/embed` in an iframe and the module never shows its login screen.

- Allowlists: host origins from deploy config set `frame-ancestors` on `/embed`, CORS, and the accepted `postMessage` origins (5.9). Other routes keep `frame-ancestors 'none'`.
- Identity: the host passes a host-issued JWT in `init`. The module presents it to `POST /api/v1/auth/embedded`, which validates it through `IdentityService` and issues a module session (5.6). The JWT is held in memory only. Before the session would outlive the token, the host sends `identity` with a fresh token and the module presents it again. Roles come from the claims map in `SiteConfig.auth`; audit rows carry `identity_source` and the host subject.
- Persona: from `init` (6.1). Embedded mode lands in M4 (12).

Protocol v1. Envelope `{ protocol: "qm", version: 1, type, payload }`. Both sides check `event.origin` against the allowlist and ignore other origins. The module answers an unknown `version` with `error`.

| Direction | type | payload |
|---|---|---|
| module to host | `ready` | `{ protocolVersion: 1, moduleVersion }`, sent on load |
| host to module | `init` | `{ identityToken, persona?, locale?, context?: { incidentId?, unitId?, recordId? } }` |
| host to module | `identity` | `{ identityToken }`, refresh before expiry |
| host to module | `context` | `{ incidentId?, unitId?, recordId? }` |
| module to host | `resize` | `{ height }` |
| module to host | `resultSelected` | `{ correlationId, partId, sourceId, resultId, queryType, severity }`, identifiers only, no values |
| module to host | `writeBackRequest` | `{ resultId, target }`, reserved for FR-061 (B6), never sent before then |
| module to host | `error` | `{ key, params }`; keys `identityExpired`, `identityRejected`, `unsupportedVersion` [open] |

Native hosts embed `packages/rn-ui` instead: the same inputs as props (identity token provider, persona, context), the same outputs as callbacks. The Expo app (6.10) is a demo shell over that library.

**Host simulator.** A page built from `apps/web` and served on a second origin (own port) in dev, CI and the demo deployment only [open]. It signs test JWTs with a demo key whose JWKS only demo and CI deploy configs trust; lets the viewer pick a demo subject, role claims, persona and context; embeds `/embed`; and logs every message both ways. Playwright uses it for embedded tests: foreign origin ignored, token refresh, `resultSelected` carries no query values.

Covers BR-002, PLT-006, FR-061 (reserved channel).

### 6.10 Native

`apps/mobile` (M4) is an Expo app over `packages/client`, `packages/rn-ui` and the tokens' RN theme. Development runs in Expo Go (single-SDK lockstep, 14). CI runs `expo export` for iOS and Android from M0 (9).

- Auth: Better Auth Expo plugin, bearer token in SecureStore only, same session limits as web (5.6). Fallback trigger: the token is not restored after a cold start; then switch to a plain bearer session.
- Push (FR-065 background, not built in Phase 1): payload carries only the opaque correlation ID and generic text ("Query results available"): no values, keywords or severity. Content is fetched through the authenticated API after unlock. FR-071's launch mechanism stays deferred (11).
- Input hints (UX-003): `keyboardType` and `autoCapitalize` follow `dataType` and `transform` (number pad for dates and numbers, capitals for `upper` fields); autocorrect off for `upper` fields; OS predictive text left on for free-text strings. No recent-values cache: query values are regulated data. UX-003 is partial (13).
- Font scaling: OS text size honoured up to 2x; targets grow with text and never clip (minimum 48 dp).
- Delete from view: a visible labelled button in the card's action menu. Swipe is optional and, when present, is also exposed as an accessibility action. The confirm is a modal that takes focus and returns it to the list.
- Reduced motion through motion tokens (6.5); announcements through the announcer (6.6).
- Home screen: quick-query tiles for `quickAccess` types (FR-070, C2).

Verification: a Maestro flow against Expo Go (login, quick query, plate submit, result with severity badge, delete from view), run manually per release with results in `docs/releases/<tag>.md`. The M4 exit includes a VoiceOver and TalkBack pass at the largest text size.

Covers FR-062, FR-065 (partial), FR-070, FR-071 (deferred), UX-001, UX-002, UX-003 (partial), SEC-006.

## 7 Site-developer experience

One image serves every site. A site never edits `packages/core` or the apps and never rebuilds the image. It supplies by volume (paths in 5.8):

- site config `sites/<siteId>.json`, selected by `SITE_CONFIG`
- locale bundles `locales/<locale>.json`
- mock data `mock/<siteId>.json`, loaded only when `ALLOW_MOCK_SOURCES=true` (5.4)
- server-side source adapters in `ADAPTER_DIR`, each a module implementing SourceAdapter API v1, registered by `kind` (5.4)

Config covers query types, type fields, rules, picklists, commands, keywords and severity styles, response mappings, personas, shortcuts, theme tokens and locales. Response formats are declarative from a fixed set with parameters (`text`, `upper`, `phone`, `date{pattern}`, `template`); an unknown format is a validation error. A new format kind is a core release, not a site change.

**Overlay.** A site extends a shipped site with `extends`: keyed deep merge, `$remove` to drop an entry (4.1). `packages/config/sites/example-ok.json`:

```json
{
  "extends": "default",
  "site": { "id": "example-ok", "name": "Example OK", "locale": "en" },
  "defaults": { "state": "OK" },
  "terminal": { "delimiter": "/" },
  "shortcuts": { "focusTerminal": { "keys": "Ctrl+Slash", "context": "global" } },
  "picklists": [
    { "id": "propertyType", "values": [ { "code": "BOAT", "$remove": true } ] }
  ],
  "queryTypes": [
    { "code": "VEH", "fields": [
      { "key": "tagSticker", "labelKey": "field.tagSticker", "dataType": "string",
        "section": "expanded", "custom": true }
    ] }
  ]
}
```

The `/` delimiter collides with the default `Slash` shortcut, so the overlay rebinds it; without that line validation fails (6.4). Its mocks live in `packages/config/mock/example-ok.json`.

**Tooling.**

- `pnpm install`, `pnpm dev`: API and Vite web app with the default site, mocks allowed, and seeded demo users whose passwords derive from `SEED_PASSWORD_SECRET` and print once.
- JSON Schema for editor autocomplete (shape only).
- `pnpm config:validate`: shape, referential pass with JSON paths (4.1), fixture policy (5.4), mapping paths against mock payloads, shortcut and delimiter collisions, contrast per theme mode. `--resolved` prints the merged overlay; `--diff <tag>` prints the change against a release.
- `pnpm config:migrate` applies `migrateConfig` steps to an older config (5.8).
- `scripts/mock-data/generate.ts` produces fixture-policy mock payloads.

**Docs.** `docs/site-config.md` (every config section, the Appendix B vehicle plate example, condition language, type fields, commands, keyword styles with `except`, response mappings with tables, personas, shortcuts, theme, fixture policy); `docs/adapters.md` (SourceAdapter API v1); `docs/embedding.md` (6.9 protocol, host JWT); `docs/api.md` from OpenAPI.

**Release notes (BR-004).** Each milestone release tag gets `docs/releases/<tag>.md`, written before the promote workflow retags `release` (8, 9). Its skeleton comes from `config:validate --diff <previous tag>` over the shipped sites: schema changes, new required keys, `migrateConfig` steps, removed or renamed keys. The developer adds the upgrade-impact summary and the Maestro results (6.10).

Covers BR-001, BR-004, BR-007, FR-008, FR-051, FR-052, FR-060, UX-011, NFR-001.

## Writer notes (remove at assembly)

(a) [open] tags

- 6.1: Mobile Field Reporting host selects an existing persona via host context; no dedicated persona shipped.
- 6.2: "Retry this source" from a nested part resubmits as a new primary query.
- 6.4: chord timeout 1000 ms.
- 6.4: delimiter collision check resolves key codes on a US layout.
- 6.5: `time` auto switches to night 19:00 to 07:00 local.
- 6.6: coalescing window 1500 ms.
- 6.8: pending entries polled over HTTP at the backoff interval while the socket is down.
- 6.9: `error` message type and its three keys (not in the decision's message list; needed for token expiry and version mismatch).
- 6.9: host simulator built from `apps/web`, served on a second origin in dev, CI and demo only.

(b) Assumptions about other sections

- 3 (01): `apps/web` includes the host simulator; it needs a separate origin to exercise `frame-ancestors` and CORS.
- 4.1 (02): `PersonaDef`, `ShortcutMap` stroke syntax, `ThemeConfig { defaultMode, auto, tokens }`, `SeverityStyle.audibleCue`, `terminal.delimiter`, `features`, `locales`, `$remove` inside keyed arrays as `{ code, "$remove": true }`, `highlight` flag, `Format` set. Action keys in the 6.4 table (`focusTerminal`, `toggleMode`, `quickType1..9`, `submit`, `selectPrev`, `selectNext`, `toggleDetail`, `deleteFromView`, `dismiss`, `shortcutSheet`, `goPanel`, `goResults`) are the catalogue 4.1 refers to. Role claims map: 02 names it `auth.hostRoleClaims`, 05 names it `auth.embedded`; 6.9 says only "claims map in `SiteConfig.auth`". Assembler should reconcile.
- 4.3 (02): FormState field props `labelKey`, `dataType`, options, `order`, `sectionLabelKey`, `isDefault`, `userValue`, `effectiveValue`; `missingRequired`, `invalid` with `{key, params}`.
- 4.4 (03): `tokenize` always returns values; round-trip property owned there.
- 4.7 (03): WS messages `hello`, `ping`/`pong`, `ackReceipt`, `sourceStatus`, `resultHidden`, `delegationChanged` (status incl. `active`, `requestExpired`), `resync`.
- 5.1/5.7 (04, 05): `POST /api/v1/delegations`, `/redeem`, `/:id/approve`, `GET /api/v1/delegations`, `DELETE /api/v1/delegations/:id`, `GET /api/v1/me/delegated-queries`, `POST /api/v1/auth/embedded`, `POST /api/v1/me/step-up`, `GET /api/v1/meta`, `GET /api/v1/locales/:locale`, `GET /api/v1/health`; QR URL `https://<origin>/delegate#code=<code>` from 5.7.
- 5.2 (04): POST body `{ queryType, values (user values), sourceIds, mode, configHash }`; server derives visible effective values.
- 5.5 (04): `user_preference.layout` JSON (orientation, terminal), `persona_override`, `theme_mode`, `locale`. `source_result` statuses incl. `interrupted`, `credentialsMissing`, `credentialsRejected`; part `skipped`.
- 5.8/5.9 (05): volume paths `sites/`, `locales/`, `mock/`; `/embed` gets the allowlist `frame-ancestors`, other routes `'none'`.
- 12 (08): embedded mode in M4.

(c) Decision lines not placed

- c106 section 11 interpretation and x18 WCAG target (section 2) belong to other writers; 6.2 cross-references 11.
- c001 BR-003, BR-005, BR-006 belong to sections 2 and 9; only BR-004 placed here.
- x4 bearer-auth API tests (REST and WS from M2) belong to section 10; Maestro and the Expo fallback trigger placed in 6.10.
- 5.6 (05) leaves the embedded session cookie `SameSite=None; Partitioned` open; 6.9 avoids naming the carrier.
