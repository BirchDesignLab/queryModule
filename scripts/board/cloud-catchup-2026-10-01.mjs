// cloud-catchup-2026-10-01.mjs: put the cloud design-system pass (PRs #418 to #446, merged
// 09-30-26) on the board, file its deferred items, and fix issue fields (checker, 10-01-26).
//
// Why: the cloud sessions cannot create or edit issues and were given no issue numbers, so
// none of their 29 PRs closed or updated an issue. Developer rulings (10-01-26): one closed
// issue per PR (no umbrella), backfill board fields on the P3 task issues (#345 to #375),
// F2 and F6 in M1, leave #41's open sub-issues alone.
//
// What it does (as BirchDesignLab, per call through GH_TOKEN; never switches the gh account):
//   1. One issue per PR #418..#446: created, commented "Done in #n", closed as completed,
//      linked under #42, added to the project as Level Task, Phase P3, Status Done.
//   2. Board fields on P3 task issues #345..#375: Level Task, Phase P3, Track (from labels),
//      Req IDs (from the title), Priority High while open (the P0 task convention).
//      Wave and Size stay blank (P3 wave names have no W<k> option; the plans give no sizes).
//   3. Progress on existing issues: #382 ticks, #413 ticks and close, comments on #358, #345.
//   4. Deferred items F1..F12 created as open follow-ups (M1). Their board fields and parent
//      come from docs/board/board-data.json: this script writes the sync-followups --add file.
//   5. Label and milestone fixes: #391, #333, #178, #182, #94, #78, #81.
//
// Idempotent: issues are matched by exact title, comments by a marker, ticks by box text.
// Usage (repo root): node scripts/board/cloud-catchup-2026-10-01.mjs [--apply]
// Then: node scripts/board/sync-followups.mjs --add scripts/board/cloud-catchup-2026-10-01.followups.json
//       node scripts/ops/gh-setup-project.mjs (dry run), --apply, gh workflow run project-sync.yml
// Step 6 (#488) runs once project-sync reads the board-dates marker (merged on main first).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
const OWNER = "BirchDesignLab";
const PROJECT = 1;
const P3_PARENT = 42; // Flow (M1 P3)
const M1 = "M1 Forms and terminal";
const MARK = "<!-- cloud-catchup-2026-10-01 -->";
const ADD_FILE = "scripts/board/cloud-catchup-2026-10-01.followups.json";

const tok = spawnSync("gh", ["auth", "token", "-u", OWNER], { encoding: "utf8" });
if (tok.status !== 0) throw new Error(`no gh token for ${OWNER}`);
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${(r.stderr || "").trim()}`);
  return r.stdout;
}
function rest(path, method = "GET", body) {
  const args = ["api", path, "--method", method];
  if (body) args.push("--input", "-");
  const out = gh(args, body ? JSON.stringify(body) : undefined);
  return out.trim() ? JSON.parse(out) : null;
}
const restAll = (path) => JSON.parse(gh(["api", path, "--paginate", "--slurp"])).flat();
function gql(query, variables = {}) {
  const out = JSON.parse(
    gh(["api", "graphql", "--input", "-"], JSON.stringify({ query, variables })),
  );
  if (out.errors) throw new Error(`graphql: ${out.errors.map((e) => e.message).join("; ")}`);
  return out.data;
}
let writes = 0;
function write(what, fn) {
  writes += 1;
  if (!APPLY) {
    console.log(`would ${what}`);
    return undefined;
  }
  console.log(what);
  return fn();
}

// ---------------------------------------------------------------- data

const DONE_DATE = "2026-09-30";
const PR_SOURCE = "cloud design-system pass, M1 P3";

/** [pr, title, labels (besides p3), track, reqIds, summary] */
const PR_ISSUES = [
  [
    418,
    "Web: cleanup of B3 and B-D2 critic minors (submit gap, request count, officer bar, e2e)",
    ["web"],
    "Web (B)",
    "FR-064, UX-002, UX-012",
    "The submit controller clears `inFlight` in the tick the status leaves `submitting`; dead `lastAck` code removed; the dispatcher's requests list shows its count beside the heading; the officer bar hides the product name the visually-hidden way; officer E1 and target-size e2e checks.",
  ],
  [
    419,
    "Admin UI: query type editor in ruled sections and plain language (A-D2 part 1a)",
    ["web"],
    "Web (B)",
    "FR-060, UX-004",
    "The query type editor as ruled sections with a label column (Name, Plate-only queries, Form sections, Fields, Rules, Advanced settings); plain-language names for input type, choices, section, letter case and pattern; Advanced opens on an issue or a new item; focus after a remove.",
  ],
  [
    420,
    "Web: e2e reuses signed-in sessions; a submit made as the status turns submitting joins the in-flight request",
    ["web"],
    "Web (B)",
    "FR-064",
    "A Playwright setup project saves a session per demo user, so a full e2e run makes 16 auth requests instead of 99 of the 100 allowed; `submit.ts` assigns `inFlight` before the status change.",
  ],
  [
    421,
    "Admin UI: rules as sentences, plain names in commands, lists and the generic form (A-D2 part 1b)",
    ["web"],
    "Web (B)",
    "FR-060, FR-050 to FR-055, UX-004",
    "Each rule and section condition reads as a sentence; selects name fields and query types by label; list label keys under Advanced settings; the generic form's settings read as words.",
  ],
  [
    422,
    "Web: a config change that removes the focused control moves focus to the panel heading (#382 T18-4)",
    ["web"],
    "Web (B)",
    "UX-004",
    "A newer published config that removes the focused control (or fails into the error state) now moves focus to the panel heading in both layouts, with no new announcement. Ticks #382 (T18-4); the PR body carries the #382 tick list.",
  ],
  [
    423,
    "Admin UI: builder preview Dispatcher/Officer switch, empty, loading and paused states (A4)",
    ["web"],
    "Web (B)",
    "UX-004, BR-001",
    "A Dispatcher/Officer switch in the preview head; empty, loading and paused states (the last valid preview stays visible, dimmed and inert, with Go to the error).",
  ],
  [
    424,
    "Admin UI: Labels and translations screen, key in mono beside the English text",
    ["web"],
    "Web (B)",
    "UX-004",
    "One ruled section per draft locale; each row is titled by its label key in mono (the one deliberate exception to hidden keys) with the English text beside it; an Add form that never overwrites silently.",
  ],
  [
    425,
    "Web: parity pass, dispatcher and shared (surfaces, mono data, Shown tag, headings)",
    ["web"],
    "Web (B)",
    "UX-004",
    "Dispatcher, sign-in and shared rules against the visual system: sunken page and base card, read-back data in Plex Mono, 600-weight headings, sectionless details, the Shown tag and one-time flash for a revealed field, hover rules on hover devices only, one evaluation clock.",
  ],
  [
    426,
    "Web: parity pass, officer and header (skip link, account menu, disclosure rule, mono refinement)",
    ["web"],
    "Web (B)",
    "UX-002, UX-012",
    "Mono now comes from a pattern, the ASCII-only charset, or a year or date type; the officer skip link and account menu meet 48 px and 16 px; More details keeps its rule in the officer card.",
  ],
  [
    427,
    "Web: preview-only selectType prop on the query panel",
    ["web"],
    "Web (B)",
    "BR-001",
    "`QueryPanelView` takes an optional `selectType` that the preview uses to pick a query type through the panel's own selection path; the live panel ignores it.",
  ],
  [
    428,
    "Admin UI: builder tree as a WAI-ARIA tree; setting paths as descriptions; language-named Add label",
    ["web"],
    "Web (B)",
    "UX-004",
    "The builder tree follows the WAI-ARIA tree pattern (one Tab stop, arrows, Home/End, type-ahead); generic-form setting paths move to descriptions; Add label buttons named by language.",
  ],
  [
    429,
    "Admin UI: undo and redo on the builder draft; remove a label row; preview follows the tree",
    ["web"],
    "Web (B)",
    "UX-004",
    "100-step undo and redo on the draft (memory only), with toolbar buttons and keys scoped to the builder; a label row can be removed; the preview shows the query type selected in the tree.",
  ],
  [
    430,
    "Admin UI: dirty-draft guard on sign-out and tab close",
    ["web"],
    "Web (B)",
    "UX-004",
    "Sign out with unsaved builder changes asks first (modal dialog), and the browser prompts before a tab close or reload; in-app navigation is not guarded by ruling. Includes the #413 m10 keystroke measurement.",
  ],
  [
    431,
    "Web: keyboard shortcuts in the account menu; preview selectTypeSeq; Shown-tag test flake",
    ["web"],
    "Web (B)",
    "UX-004",
    "A Keyboard shortcuts item in the account menu opens the shortcut sheet; `selectTypeSeq` re-applies a preview pick for the same code; the Shown-tag test flake fixed at its cause.",
  ],
  [
    432,
    "Web: harden the query surfaces for zoom, reflow and focus",
    ["web", "accessibility"],
    "Web (B)",
    "UX-002, UX-004",
    "Dispatcher and officer at 1366x768, 800x600, 200% zoom and 320 px reflow: focus is no longer hidden behind the sticky action bar (WCAG 2.4.11), the command echo wraps at 320 px (1.4.10), and two focus repairs for the shortcut sheet and account menu.",
  ],
  [
    433,
    "Admin UI: Changes view, the draft against the live config",
    ["web", "core"],
    "Web (B)",
    "FR-060, UX-004",
    "A read-only Changes view lists what the draft changes against the live config (added, removed, changed, reordered, with Was and Now), each entry opening its item; pure `diffConfig` and `applyChanges` in core with property tests. Diff part of #358.",
  ],
  [
    434,
    "Web: retry a failed request from the requests list; panel card widened to 682 px",
    ["web"],
    "Web (B)",
    "FR-064",
    "Failed rows keep what they sent (memory only) and offer Retry, except on 400, 403 and 409; spec 6.7's key rule (same key on no response, new key on an answered failure); the dispatcher card widened so quick access fits one row.",
  ],
  [
    435,
    "Web: keystroke and quick-access cost at 4x CPU throttling, with the measurement tooling",
    ["web"],
    "Web (B)",
    "UX-002",
    "The time formatter is built once and the requests pane memoised; the action-bar clearance hook stops forcing layout; opt-in profiling tooling in `scripts/perf` and `perf.spec.ts`.",
  ],
  [
    436,
    "Admin UI: parity pass (sunken page, base panes, 440 px preview, label-following tree rows)",
    ["web"],
    "Web (B)",
    "FR-060, UX-004",
    "The whole app on the sunken surface; panes on base inside the window; 6474 px of phantom scroll removed; a 440 px preview with the dispatcher card; tree rows follow draft label edits.",
  ],
  [
    437,
    "Tokens: inert opacity, modal scrim and the wide-layout constant",
    ["web"],
    "Web (B)",
    "UX-011, UX-002",
    "`opacity.inert`, `color.surface.scrim` and the `layout.wide` constant replace literals and the breakpoint multiplier (#413 m9).",
  ],
  [
    438,
    "Web: theme button keeps focus when the persona flips the header bar",
    ["web", "accessibility"],
    "Web (B)",
    "UX-004",
    "Focus stays on the button for the same theme mode across a persona flip (or goes to the account button when the group moves into the closed menu), with no announcement.",
  ],
  [
    439,
    "Admin UI: Changes view polish (value-keyed lists, one identity per list, Was in every locale)",
    ["web", "core"],
    "Web (B)",
    "FR-050 to FR-055",
    "A quick-access reorder reads as moved; one identity property per list; label overlay entries in other locales show Was.",
  ],
  [
    440,
    "Web: dispatch app bar stays one row at 200% zoom",
    ["web", "accessibility"],
    "Web (B)",
    "UX-002",
    "Below 52rem the account button shrinks to its avatar and the site name truncates, so the bar keeps one 52 px row at 200% zoom; reflows in full at 320 px.",
  ],
  [
    441,
    "Admin UI: layout robustness (flex-column panes, natural stacked rail, dev-only render counters)",
    ["web"],
    "Web (B)",
    "UX-004",
    "The builder as a grid with flex-column panes (no fixed offset); the stacked rail keeps its natural height; render counters only in development builds; moved string lists show Was and Now.",
  ],
  [
    442,
    "Web: status page with Connection, Configuration and Session tiles",
    ["web"],
    "Web (B)",
    "NFR-003",
    "`/status` as three ruled tiles from data the app already has, with text status chips and one Check again that keeps focus and makes one announcement.",
  ],
  [
    443,
    "Docs: M1 v1 demo runbook, a click path per persona",
    ["documentation", "web"],
    "Web (B)",
    "BR-005, NFR-003",
    "`docs/demo/m1-v1.md`: what to do, say and expect per persona, with phase limits up front and no passwords. Demo part of #345.",
  ],
  [
    444,
    "Admin UI: real media and container queries at the layout constants; opacity.scrim",
    ["web"],
    "Web (B)",
    "UX-004",
    "Literal lengths are allowed only in a query condition equal to a layout constant; the admin rail and toolbar use real media and container queries; `opacity.scrim` replaces the literal backdrop opacity.",
  ],
  [
    445,
    "Web: loose ends (site name title, status probe timer, late retry announcement)",
    ["web"],
    "Web (B)",
    "NFR-003",
    "The truncated site name carries its full text as a title; a dropped status check cancels its probe timer; a late retry outcome is not announced once its row is gone.",
  ],
  [
    446,
    "Admin UI: no empty builder row while loading; escape test RegExps; doc corrections",
    ["web"],
    "Web (B)",
    "UX-004",
    "No empty third grid row in the builder's loading and error states; test RegExps built from constants are escaped; visual-system and design-plan text corrected.",
  ],
];

const prBody = ([pr, , , , reqIds, summary]) =>
  `${MARK}\nRetroactive record of PR #${pr} (${PR_SOURCE}, merged ${DONE_DATE}). The cloud sessions could not file issues, so this one is filed and closed after the fact to put the work on the board.\n\n${summary}\n\n**Req IDs:** ${reqIds}\n\nDone in #${pr}.`;

/** Deferred items: [key, title, labels, body] (all M1, open, follow-up). */
const FOLLOW_UPS = [
  [
    "F1",
    "Mono config flag: a schema field and an admin editor replace the data-field heuristic",
    ["core", "web", "p3", "follow-up"],
    'Read-back data is set in Plex Mono by a heuristic in `apps/web/src/query/data-field.ts` (a pattern, the ASCII-only charset, or a year or date type). Replace it with a config flag the implementer sets (from #425, #426, #432, #434).\n\n- [ ] Core: an optional mono/data flag on a field in the `SiteConfig` schema (moves the config hashes in `packages/api/test/config-load.test.ts`).\n- [ ] Admin: an editor control for it; the editor sets `charset: "printable"` on new free-text fields, since `printableAscii` is the schema default and today a custom free-text field renders mono (#426).\n- [ ] Web: read the flag in place of `isDataField`; keep the default site\'s current mono list.',
  ],
  [
    "F2",
    "Edit as new query on a request row that failed with a config change (409)",
    ["web", "p3", "follow-up", "enhancement"],
    "A 409 (config changed) row offers no Retry, by ruling, since the same values cannot succeed (#434). Offer \"Edit as new query\": load the row's kept values into the form under the new config, so the dispatcher recovers what they typed.\n\n- [ ] Action on 409 and config-changed rows (36 px dispatcher, 48 px officer), named with the command summary.\n- [ ] Values the new config no longer has are dropped with a visible note; focus moves to the form by the user's action only.\n- [ ] TDD in `apps/web` and one e2e.",
  ],
  [
    "F3",
    "Query panel keystroke cost: per-field memoisation and the second commit per keystroke",
    ["web", "p3", "follow-up"],
    "From #435: at 4x CPU throttling every panel action still exceeds about 16 ms (typing a character about 32 ms). At 1x the medians are fine for the demo: type a character 5.2 ms dispatcher, 6.3 ms officer; quick access 11.5 / 11.0 ms; subtype 7.3 / 8.9 ms.\n\n- [ ] Find the source of the second React commit per keystroke.\n- [ ] Per-field memoisation (touches the shared field API), measured with `node scripts/perf/e2e-perf.ts` before and after.",
  ],
  [
    "F4",
    "No cue on the More details toggle when a rule reveals a field inside it",
    ["web", "p3", "follow-up", "accessibility"],
    'A field a rule reveals inside a closed "More details" gets the Shown tag and the polite announcement, but the closed toggle shows nothing (accepted minor in #432, #434, #435). Possible fix: a count badge on the disclosure.\n\n- [ ] Visual cue on the toggle, never colour alone, no flash under reduced motion.\n- [ ] Unit test and a `visual.spec` numeric check.',
  ],
  [
    "F5",
    "One config check for the status page and the admin builder",
    ["web", "p3", "follow-up"],
    "The status page (#442) and the admin lane's `useLiveConfig` (`apps/web/src/admin/use-cached-config.ts`) each check the live config their own way.\n\n- [ ] Merge them into one hook used by both, with the existing tests kept.",
  ],
  [
    "F6",
    "App version tile on the status page and the runbook's version step",
    ["web", "p3", "follow-up", "enhancement"],
    "Dropped from #442 because `APP_VERSION` and `coreVersion` both read 0.0.0. Once versions are real:\n\n- [ ] An App tile on `/status` with the build version.\n- [ ] The matching step in `docs/demo/m1-v1.md` (#443).",
  ],
  [
    "F7",
    "App bar minors: long site names between 52rem and 1000 px; officer zoom e2e",
    ["web", "p3", "follow-up", "accessibility"],
    "From #440:\n\n- [ ] A site name near its 32ch cap can still wrap the bar between 52rem and about 1000 px (web-ui `styles.css`, the 52rem block).\n- [ ] The officer case in the zoom e2e is a control only; make it assert something the officer bar could break.",
  ],
  [
    "F8",
    "Hardening test minors: repair B e2e, a second clearance, theme-focus guards",
    ["web", "p3", "follow-up"],
    '- [ ] Focus repair B (`AccountMenu` moves focus when the Keyboard shortcuts item disappears) has no e2e; no route loses its sheet while the item has focus today (#432).\n- [ ] If anything else becomes sticky, the action-bar clearance needs a second source (#432).\n- [ ] The two theme-focus "no announcement" assertions are negative guards only (#438).',
  ],
  [
    "F9",
    "Admin layout minors: rail threshold at a 12 px root font, toolbar threshold and scrollbar width",
    ["web", "p3", "follow-up"],
    "From #444 (after #441):\n\n- [ ] At a 12 px root font the rail sits beside the section from 648 px.\n- [ ] The row-mode toolbar threshold moves by the scrollbar width (still clears 1024).",
  ],
  [
    "F10",
    "Undo also updates the builder's polite draft-summary region",
    ["web", "p3", "follow-up", "accessibility"],
    "An undo that changes the error or warning counts updates the builder's polite draft-summary region alongside the shared announcer's \"Undone\" (accepted minor in #429 and #430).\n\n- [ ] Decide one announcement for an undo and test that only one is spoken.",
  ],
  [
    "F11",
    "Decide: builder editor and preview padding against the mockup",
    ["web", "p3", "follow-up", "decision"],
    "The mockup's editor has no background and its preview body is edge to edge; ours are `surface.base` panes with 12 px padding, per the \"panes on base\" ruling (#436, still listed in #441, #444, #446). Design lead's call.\n\n- [ ] Ruling recorded in the design doc.\n- [ ] Implement it, or close as decided.",
  ],
  [
    "F12",
    "Backup upload: R2 answers the first attempt with 501 NotImplemented",
    ["platform", "p3", "follow-up"],
    "The 09-30-26 host backup (`qm-20260930T175552Z.tar.age`) got `501 NotImplemented` from R2 on rclone's first copy attempt; the retry succeeded. Most likely an rclone setting R2 does not support.\n\n- [ ] Find the request R2 rejects (rclone `-vv` on the host) and set the matching rclone option in the backup config.\n- [ ] A clean first attempt in the backup log.",
  ],
];
/** Board metadata for the data file, per follow-up key or existing number. */
const FOLLOW_UP_META = {
  F1: { track: "Core", size: "M", priority: "Medium", reqIds: "FR-060" },
  F2: { track: "Web (B)", size: "M", priority: "Low", reqIds: "FR-064" },
  F3: { track: "Web (B)", size: "M", priority: "Low", reqIds: "none" },
  F4: { track: "Web (B)", size: "S", priority: "Low", reqIds: "UX-004" },
  F5: { track: "Web (B)", size: "S", priority: "Low", reqIds: "NFR-003" },
  F6: { track: "Web (B)", size: "S", priority: "Low", reqIds: "NFR-003" },
  F7: { track: "Web (B)", size: "S", priority: "Low", reqIds: "UX-002" },
  F8: { track: "Web (B)", size: "S", priority: "Low", reqIds: "none" },
  F9: { track: "Web (B)", size: "S", priority: "Low", reqIds: "UX-004" },
  F10: { track: "Web (B)", size: "S", priority: "Low", reqIds: "UX-004" },
  F11: { track: "Web (B)", size: "S", priority: "Medium", reqIds: "none" },
  F12: { track: "Platform (A)", size: "S", priority: "Medium", reqIds: "none" },
};
/** Existing issues the data file lacks (#182 stays out: the schema needs a milestone). */
const ADOPT = [
  {
    number: 413,
    milestone: M1,
    parent: P3_PARENT,
    track: "Web (B)",
    phase: "P3",
    size: "S",
    priority: "Low",
    reqIds: "none",
  },
  {
    number: 410,
    milestone: M1,
    parent: P3_PARENT,
    track: "Platform (A)",
    phase: "P3",
    size: "S",
    priority: "Low",
    reqIds: "none",
  },
  {
    number: 404,
    milestone: M1,
    parent: P3_PARENT,
    track: "Web (B)",
    phase: "P3",
    size: "S",
    priority: "Low",
    reqIds: "none",
  },
  {
    number: 391,
    milestone: M1,
    parent: P3_PARENT,
    track: "Platform (A)",
    phase: "P3",
    size: "M",
    priority: "Medium",
    reqIds: "none",
  },
  // M0 P1's phase parent is at the 100 sub-issue cap (#231): no parent.
  {
    number: 241,
    milestone: "M0 Skeleton",
    track: "Web (B)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "SEC-006",
  },
  {
    number: 242,
    milestone: "M0 Skeleton",
    track: "Web (B)",
    phase: "P1",
    size: "S",
    priority: "Medium",
    reqIds: "NFR-001, SEC-006",
  },
];

const LABEL_FIXES = [
  { number: 391, add: ["platform", "p3"], milestone: M1 },
  { number: 333, add: ["p3"] },
  { number: 178, add: ["p1"] },
  { number: 182, add: ["p1"] },
  { number: 94, add: ["p3"] },
  { number: 78, remove: ["p0"] },
  { number: 81, remove: ["p0"] },
];

const TICKS_382 = {
  "A1 ": "",
  "A2 ": "",
  "A3 ": "",
  "D1 ": "",
  "D2 ": "",
  "E1 ": "",
  "E2 ": " Ruled silent in B3: the reference is on screen (#422).",
};
const COMMENT_382 = `${MARK}\nProgress from the cloud design-system pass (09-30-26), per the tick list in #422:\n\n- Done: A1 (\`RequestsPane.tsx\`), A2 (\`AckStatus\` removed in B3), A3 (\`submit.noResponse\` wording), D1 and D2 (\`TypeFieldBar\` is a segmented control with no duplicate error builder), E1 (D0 #409, ring outside the invalid edge, asserted in \`visual.spec\` for all themes).\n- E2: ruled silent in B3.\n- T18-4 (from the Task 18 review): done in #422, with the closed-disclosure case in #425 (G9).\n- Also from the cloud pass: the submit gap in #418 and #420; the shortcut-test flake class fixed in #431.\n\nStill open: A4, B3, C3 to C6, D3, W2 to W4, W6, T8, and the Task 19 and Task 20 items.`;
const COMMENT_413 = `${MARK}\nBoth items done in the cloud design-system pass (09-30-26):\n\n- **m9:** the breakpoint is the \`layout.wide\` constant (#437), and real media and container queries at the layout constants replace the multiplier (#444).\n- **m10:** measured in #430 (jsdom ms; \`QM_PERF=1\`, \`src/admin/LabelCost.test.tsx\`):\n\n| Query types | Fields | Label keystroke | Setting keystroke | One full validation |\n|---|---|---|---|---|\n| 5 | 52 | ~34 (warm-up) | 25 | 6 |\n| 24 | 166 | 23 | 27 | 7 |\n| 64 | 406 | 22 | 45 | 22 |\n\nThe label path was narrowed in #421 and tree rows re-render on their own label key only (#436). Validation runs on a 150 ms debounce; nothing further needed at demo scale.`;
const COMMENT_358 = `${MARK}\nProgress (09-30-26): the diff part is done. #433 adds the read-only Changes view (draft against the live config, pure \`diffConfig\` and \`applyChanges\` in core with property tests) and #439 polishes it. Diagnostics are inline since Task 31. Publish, rollback and version history wait on AC2 (#351).`;
const COMMENT_345 = `${MARK}\nProgress (09-30-26): the demo part has a runbook, \`docs/demo/m1-v1.md\` (#443), a click path per persona with phase limits and no passwords. \`site-config.md\` and \`api.md\` are still to do.`;

// ---------------------------------------------------------------- reads

const allIssues = restAll(`repos/${REPO}/issues?state=all&per_page=100`).filter(
  (i) => !i.pull_request,
);
const byTitle = new Map(allIssues.map((i) => [i.title, i]));
const byNumber = new Map(allIssues.map((i) => [i.number, i]));
const milestones = new Map(
  restAll(`repos/${REPO}/milestones?state=all&per_page=100`).map((m) => [m.title, m.number]),
);

const PROJECT_Q = `query($o:String!,$n:Int!){user(login:$o){projectV2(number:$n){id fields(first:50){nodes{
  ... on ProjectV2FieldCommon{id name} ... on ProjectV2SingleSelectField{options{id name}}}}}}}`;
const project = gql(PROJECT_Q, { o: OWNER, n: PROJECT }).user.projectV2;
const field = (name) => project.fields.nodes.find((f) => f.name === name);

const ITEMS_Q = `query($p:ID!,$after:String){node(id:$p){... on ProjectV2{items(first:100,after:$after){
  pageInfo{hasNextPage endCursor} nodes{id content{... on Issue{number}}
  fieldValues(first:30){nodes{
    ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{name}}}
    ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}}
    ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{name}}}}}}}}}}`;
const items = new Map();
for (let after = null; ; ) {
  const page = gql(ITEMS_Q, { p: project.id, after }).node.items;
  for (const it of page.nodes) {
    if (!it.content?.number) continue;
    const values = {};
    for (const fv of it.fieldValues.nodes)
      if (fv.field?.name) values[fv.field.name] = fv.name ?? fv.text ?? fv.date;
    items.set(it.content.number, { id: it.id, values });
  }
  if (!page.pageInfo.hasNextPage) break;
  after = page.pageInfo.endCursor;
}

const subIds = new Set(
  restAll(`repos/${REPO}/issues/${P3_PARENT}/sub_issues?per_page=100`).map((s) => s.id),
);
const commentsOf = (n) => restAll(`repos/${REPO}/issues/${n}/comments?per_page=100`);
const hasMarker = (n) => commentsOf(n).some((c) => c.body.includes(MARK));

// ---------------------------------------------------------------- helpers

function ensureIssue(title, body, labels, closed) {
  let issue = byTitle.get(title);
  if (!issue) {
    issue = write(`create "${title}"`, () =>
      rest(`repos/${REPO}/issues`, "POST", { title, body, labels, milestone: milestones.get(M1) }),
    );
    if (issue) byTitle.set(title, issue);
  }
  if (issue && closed && issue.state === "open") {
    write(`close #${issue.number} as completed`, () =>
      rest(`repos/${REPO}/issues/${issue.number}`, "PATCH", {
        state: "closed",
        state_reason: "completed",
      }),
    );
  }
  return issue;
}
function ensureComment(n, body) {
  if (n && hasMarker(n)) return;
  write(`comment on #${n ?? "(new)"}`, () =>
    rest(`repos/${REPO}/issues/${n}/comments`, "POST", { body }),
  );
}
function ensureChild(issue) {
  if (!issue || subIds.has(issue.id)) return;
  write(`link #${issue.number} under #${P3_PARENT}`, () =>
    rest(`repos/${REPO}/issues/${P3_PARENT}/sub_issues`, "POST", { sub_issue_id: issue.id }),
  );
}
function setFields(issue, want) {
  if (!issue) {
    for (const [k, v] of Object.entries(want))
      if (v) {
        console.log(`would set (new) ${k} = ${v}`);
        writes += 1;
      }
    return;
  }
  let item = items.get(issue.number);
  if (!item) {
    const added = write(`add #${issue.number} to the project`, () =>
      gql(
        `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
        {
          p: project.id,
          c: issue.node_id,
        },
      ),
    );
    item = { id: added?.addProjectV2ItemById.item.id, values: {} };
    items.set(issue.number, item);
  }
  for (const [name, value] of Object.entries(want)) {
    if (!value || item.values[name] === value) continue;
    const f = field(name);
    let v;
    if (f.options) {
      const opt = f.options.find((o) => o.name === value);
      if (!opt) throw new Error(`field ${name} has no option ${value}`);
      v = { singleSelectOptionId: opt.id };
    } else if (name === "Start" || name === "Finish") v = { date: value };
    else v = { text: value };
    write(`set #${issue.number} ${name} = ${value}`, () =>
      gql(
        `mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:$v}){projectV2Item{id}}}`,
        { p: project.id, i: item.id, f: f.id, v },
      ),
    );
  }
}
const trackOf = (names) =>
  names.includes("core") && !names.includes("web")
    ? "Core"
    : names.includes("web")
      ? "Web (B)"
      : names.includes("platform")
        ? "Platform (A)"
        : names.includes("core")
          ? "Core"
          : null;

// ---------------------------------------------------------------- 1. one issue per PR

for (const spec of PR_ISSUES) {
  const [pr, title, labels, track, reqIds] = spec;
  const issue = ensureIssue(title, prBody(spec), [...labels, "p3"], true);
  if (issue && !hasMarker(issue.number))
    ensureComment(issue.number, `${MARK}\nDone in #${pr} (merged ${DONE_DATE}).`);
  else if (!issue) write(`comment "Done in #${pr}" on the new issue`, () => {});
  ensureChild(issue);
  setFields(issue, {
    Level: "Task",
    Phase: "P3",
    Track: track,
    "Req IDs": reqIds,
    // Start and Finish are project-sync's (issue created and closed dates, 10-01-26 here).
    Status: "Done",
  });
}

// ---------------------------------------------------------------- 2. P3 task backfill

for (let n = 345; n <= 375; n += 1) {
  const issue = byNumber.get(n);
  if (!issue) continue;
  const names = issue.labels.map((l) => l.name);
  setFields(issue, {
    Level: "Task",
    Phase: "P3",
    Track: trackOf(names),
    "Req IDs": /\(([^)]*)\)\s*$/.exec(issue.title)?.[1] ?? "",
    Priority: issue.state === "open" ? "High" : "",
  });
}

// ---------------------------------------------------------------- 3. progress on existing issues

{
  const i382 = byNumber.get(382);
  let body = i382.body;
  for (const [box, note] of Object.entries(TICKS_382)) {
    const re = new RegExp(`^- \\[ \\] ${box}(.*)$`, "m");
    body = body.replace(re, (_, rest) => `- [x] ${box}${rest}${note}`);
  }
  if (body !== i382.body)
    write("tick #382 A1, A2, A3, D1, D2, E1, E2", () =>
      rest(`repos/${REPO}/issues/382`, "PATCH", { body }),
    );
  ensureComment(382, COMMENT_382);

  const i413 = byNumber.get(413);
  const b413 = i413.body.replace(/^- \[ \] (m9|m10) /gm, "- [x] $1 ");
  if (b413 !== i413.body)
    write("tick #413 m9, m10", () => rest(`repos/${REPO}/issues/413`, "PATCH", { body: b413 }));
  ensureComment(413, COMMENT_413);
  if (i413.state === "open")
    write("close #413 as completed", () =>
      rest(`repos/${REPO}/issues/413`, "PATCH", { state: "closed", state_reason: "completed" }),
    );
  ensureComment(358, COMMENT_358);
  ensureComment(345, COMMENT_345);
}

// ---------------------------------------------------------------- 4. deferred follow-ups

const addEntries = [];
for (const [key, title, labels, body] of FOLLOW_UPS) {
  const issue = ensureIssue(title, body, labels, false);
  addEntries.push({
    number: issue?.number ?? `<${key}>`,
    milestone: M1,
    parent: P3_PARENT,
    phase: "P3",
    labels,
    ...FOLLOW_UP_META[key],
  });
}
for (const a of ADOPT) addEntries.push(a);

// ---------------------------------------------------------------- 5. label and milestone fixes

for (const fix of LABEL_FIXES) {
  const issue = byNumber.get(fix.number);
  const have = new Set(issue.labels.map((l) => l.name));
  const add = (fix.add ?? []).filter((l) => !have.has(l));
  if (add.length)
    write(`add labels ${add.join(", ")} to #${fix.number}`, () =>
      rest(`repos/${REPO}/issues/${fix.number}/labels`, "POST", { labels: add }),
    );
  for (const l of (fix.remove ?? []).filter((x) => have.has(x)))
    write(`remove label ${l} from #${fix.number}`, () =>
      rest(`repos/${REPO}/issues/${fix.number}/labels/${encodeURIComponent(l)}`, "DELETE"),
    );
  if (fix.milestone && issue.milestone?.title !== fix.milestone)
    write(`set #${fix.number} milestone ${fix.milestone}`, () =>
      rest(`repos/${REPO}/issues/${fix.number}`, "PATCH", {
        milestone: milestones.get(fix.milestone),
      }),
    );
}

// ---------------------------------------------------------------- 6. board-dates markers (#488)

// Step 1's issues (#447..#475) were filed 10-01 for work done 09-30; project-sync reads this
// body marker (board-model.mjs boardDatesMarker) so their Start and Finish show 09-30, and #42's
// roll-up follows on the next project-sync run.
const DATES_MARK = `<!-- board-dates start=${DONE_DATE} finish=${DONE_DATE} -->`;
for (let n = 447; n <= 475; n++) {
  const issue = byNumber.get(n);
  if (!issue || (issue.body ?? "").includes("board-dates")) continue;
  write(`add board-dates marker to #${n}`, () =>
    rest(`repos/${REPO}/issues/${n}`, "PATCH", {
      body: `${(issue.body ?? "").trimEnd()}\n\n${DATES_MARK}\n`,
    }),
  );
}

// Data entries for sync-followups --add: labels of the adopted issues come from GitHub there.
if (APPLY) {
  writeFileSync(ADD_FILE, `${JSON.stringify(addEntries, null, 2)}\n`);
  console.log(`wrote ${ADD_FILE} (${addEntries.length} entries)`);
} else console.log(`would write ${ADD_FILE} (${addEntries.length} entries)`);
console.log(`${APPLY ? "applied" : "planned"} ${writes} change(s)`);
