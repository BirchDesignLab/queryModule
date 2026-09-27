// Pure decisions for gh-setup-project.mjs (#79 items 1 and 3, #71 residuals).
// No IO: the script reads GitHub state and calls these; they only compute.

/**
 * Status for a wave-parent project item.
 *
 * Done comes only from the issue's own state, never from every task under it
 * happening to be closed already: that observation belongs to project-sync
 * (`.github/workflows/project-sync.yml`, "a wave parent closes when all of its
 * tasks are closed"), which closes the wave parent issue itself. Once the issue
 * is closed as completed, Done follows from the issue read.
 *
 * A closed-not-planned (or duplicate) issue gets no forced Status at all, so a
 * manually-set value on it is left alone (docs/project-board.md "Closed issue"
 * row).
 *
 * @param {{state: "open"|"closed", state_reason?: string|null}} issue
 * @param {"todo"|"ready"|"review"} waveState
 * @returns {"Done"|"In Review"|"Ready"|"Todo"|undefined}
 */
export function waveParentStatus(issue, waveState) {
  if (issue.state === "closed") return closedStatus(issue);
  return { review: "In Review", ready: "Ready", todo: "Todo" }[waveState];
}

/**
 * Done only for an issue closed as completed (or closed with no reason, as
 * older issues report); not planned, duplicate and open issues get no Status
 * write from the setup script (#79).
 *
 * @param {{state: "open"|"closed", state_reason?: string|null}} issue
 * @returns {"Done"|undefined}
 */
export function closedStatus(issue) {
  if (issue.state !== "closed") return undefined;
  const reason = issue.state_reason ?? null;
  return reason === "completed" || reason === null ? "Done" : undefined;
}

/**
 * Whether an issue the setup script owns (a phase parent, wave parent or
 * follow-up in its data) needs its body rewritten to match the desired text.
 *
 * Comparison normalises CRLF to LF and strips trailing whitespace per line, so
 * a rerun against unchanged data plans zero body writes regardless of how
 * GitHub or a local edit happened to save line endings.
 *
 * @param {string} existing
 * @param {string} desired
 * @returns {string|null} the desired body to write, or null when no write is needed
 */
/**
 * Whether a parent or follow-up issue the setup script owns needs its title
 * rewritten to the desired human-readable title (developer decision, #80:
 * codes live in fields, not titles). A stale live title is a planned rename,
 * never a mismatch: the caller finds the issue by number first (see
 * `matchParent`) and only then compares titles.
 *
 * @param {string} existing
 * @param {string} desired
 * @returns {string|null} the desired title to write, or null when no write is needed
 */
export function titleUpdate(existing, desired) {
  return existing === desired ? null : desired;
}

/**
 * Find the live issue a data item (phase parent, wave parent or follow-up)
 * refers to. Matching is by recorded issue number only, never by title
 * (developer decision, #80): once a number is recorded, a title change in
 * the data is a rename to apply, not a new issue to create. An item with no
 * number yet (a milestone parent not yet created) matches nothing; the
 * caller creates it and records the number it gets back.
 *
 * @param {{number: number|null, title?: string}} item
 * @param {(n: number) => object|undefined} byNumber looks up a live issue by number
 * @returns {object|undefined}
 */
export function matchParent(item, byNumber) {
  if (!item.number) return undefined;
  const live = byNumber(item.number);
  // A recorded number that no longer resolves (transferred or deleted) would
  // otherwise make every --apply create a fresh copy; stop instead.
  if (!live)
    throw new Error(
      `issue #${item.number} (${item.title}) is recorded in the setup-script data but not found; fix the data before --apply`,
    );
  return live;
}

// The project started 2026-09-25 (developer decision, #80): no Start or
// Finish before this date. Anything earlier is clamped up to it.
export const FLOOR = "2026-09-25";

/**
 * Clamp an ISO date (YYYY-MM-DD, or a longer ISO timestamp) up to the floor.
 *
 * @param {string} date
 * @param {string} [floor]
 * @returns {string}
 */
export function clampToFloor(date, floor = FLOOR) {
  const d = date.slice(0, 10);
  return d < floor ? floor : d;
}

/**
 * Dates for a leaf item (Task or Follow-up), #80 requirement 4: Start is the
 * issue's created date; Finish is its closed date only when it closed as
 * completed (not_planned/duplicate, or still open, leaves Finish empty).
 * Both are clamped to `FLOOR`.
 *
 * @param {{created_at: string, closed_at?: string|null, state: "open"|"closed", state_reason?: string|null}} issue
 * @param {string} [floor]
 * @returns {{start: string, finish: string|null}}
 */
export function leafDates(issue, floor = FLOOR) {
  const start = clampToFloor(issue.created_at, floor);
  const completed =
    issue.state === "closed" && (issue.state_reason === "completed" || issue.state_reason == null);
  const finish = completed && issue.closed_at ? clampToFloor(issue.closed_at, floor) : null;
  return { start, finish };
}

/**
 * Roll a parent's (Wave, Phase, Milestone) dates up from its children,
 * bottom up (#80 requirement 5): Start is the earliest child Start. Finish is
 * the latest child Finish once every child is closed; while any child is
 * still open, Finish is the latest child date so far (each child's Finish,
 * or its Start when it has none yet). A parent with no dated child keeps no
 * dates. Undated children (no Start) are ignored for Start/Finish but still
 * count for the "every child closed" check.
 *
 * @param {Array<{start: string|null, finish: string|null, closed: boolean}>} children
 * @returns {{start: string|null, finish: string|null}}
 */
export function rollUp(children) {
  const dated = children.filter((c) => c.start);
  if (dated.length === 0) return { start: null, finish: null };
  const start = dated.map((c) => c.start).sort()[0];
  const allClosed = children.every((c) => c.closed);
  const finish = allClosed
    ? (dated
        .map((c) => c.finish)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null)
    : (dated
        .map((c) => c.finish ?? c.start)
        .sort()
        .at(-1) ?? null);
  return { start, finish };
}

/**
 * A wave's timeline span for the README dashboard (#85, #92 R6). A wave whose
 * `pr` is set and whose PR has merged uses the PR's first-commit-to-merge
 * span instead of today's rolled-up issue dates, so a finished wave shows how
 * long it actually took rather than the one day every P0 wave rolls up to
 * (#85: "every P0 wave shows the same day"). Any other case (no `pr`, an open
 * PR, or a merged PR whose commits list came back empty) keeps `rolled`
 * unchanged, same object, so a caller can tell nothing was recomputed.
 *
 * @param {{start: string|null, finish: string|null}} rolled today's Start/Finish roll-up (rollUp)
 * @param {{merged: boolean, merged_at: string|null,
 *   commits: Array<{commit?: {author?: {date?: string}}}>}|null|undefined} pr
 *   `repos/{repo}/pulls/{n}` merged with its `.../commits` list, or null/undefined
 *   when the wave has no `pr` recorded.
 * @param {string} [floor]
 * @returns {{start: string|null, finish: string|null}}
 */
export function waveSpan(rolled, pr, floor = FLOOR) {
  if (!pr?.merged || !pr.merged_at || !pr.commits || pr.commits.length === 0) return rolled;
  const authorDate = pr.commits[0]?.commit?.author?.date;
  if (!authorDate) return rolled;
  return { start: clampToFloor(authorDate, floor), finish: clampToFloor(pr.merged_at, floor) };
}

export function bodyUpdate(existing, desired) {
  const normalise = (s) =>
    s
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n");
  return normalise(existing) === normalise(desired) ? null : desired;
}
