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
 * A ready wave maps to Todo: the board has no Ready column (#244).
 *
 * @returns {"Done"|"In Review"|"Todo"|undefined}
 */
export function waveParentStatus(issue, waveState) {
  if (issue.state === "closed") return closedStatus(issue);
  return { review: "In Review", ready: "Todo", todo: "Todo" }[waveState];
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
 * @param {{created_at: string, closed_at?: string|null, state: "open"|"closed", state_reason?: string|null, body?: string|null}} issue
 * @param {string} [floor]
 * @returns {{start: string, finish: string|null}}
 */
export function leafDates(issue, floor = FLOOR) {
  const marker = boardDatesMarker(issue.body);
  const start = clampToFloor(marker.start ?? issue.created_at, floor);
  const completed =
    issue.state === "closed" && (issue.state_reason === "completed" || issue.state_reason == null);
  const closedAt = marker.finish ?? issue.closed_at;
  const finish = completed && closedAt ? clampToFloor(closedAt, floor) : null;
  return { start, finish };
}

/**
 * #488: an issue filed after the fact carries its real dates in a body marker,
 * `<!-- board-dates start=YYYY-MM-DD finish=YYYY-MM-DD -->` (either attribute
 * alone is fine). A malformed marker is ignored. Finish still applies only to
 * an issue closed as completed (leafDates).
 *
 * @param {string|null|undefined} body
 * @returns {{start?: string, finish?: string}}
 */
export function boardDatesMarker(body) {
  const m = /<!--\s*board-dates((?:\s+(?:start|finish)=\d{4}-\d{2}-\d{2})+)\s*-->/.exec(body ?? "");
  if (!m) return {};
  return Object.fromEntries(
    [...m[1].matchAll(/(start|finish)=(\d{4}-\d{2}-\d{2})/g)].map((a) => [a[1], a[2]]),
  );
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

export function bodyUpdate(existing, desired) {
  const normalise = (s) =>
    s
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n");
  return normalise(existing) === normalise(desired) ? null : desired;
}

/**
 * #96 G-M4, refined by the #193 checker ruling: a follow-up number in the board
 * data may only adopt a live issue whose `follow-up` label agrees with the
 * data's; otherwise --apply would rename and rewrite an unrelated issue, or
 * silently drop a label the data expects. Refuses only on disagreement (the
 * data lists `follow-up` and the live issue lacks it, or the live issue
 * carries it and the data does not list it): both agreeing it is absent (#75)
 * is fine, since that is simply not a follow-up label the script owns yet.
 * Returns an error naming every disagreeing issue, or null. A number with no
 * live issue is fine (the script creates it).
 * @param {Array<{number: number, labels?: string[]}>} followUps
 * @param {(n: number) => {number: number, labels: Array<{name: string}>} | undefined} byNumber
 * @returns {string | null}
 */
export function followUpAdoptionError(followUps, byNumber) {
  const bad = [];
  for (const f of followUps) {
    const live = byNumber(f.number);
    if (!live) continue;
    const dataHas = (f.labels ?? []).includes("follow-up");
    const liveHas = live.labels.some((l) => l.name === "follow-up");
    if (dataHas !== liveHas) bad.push(`#${live.number}`);
  }
  return bad.length === 0
    ? null
    : `refusing to adopt ${bad.join(", ")} as follow-up issue(s): data and live labels disagree about "follow-up"; fix docs/board/board-data.json or the issue's labels`;
}

/**
 * Status roll-up for a Wave, Phase or Milestone parent item, from its
 * children's own Status (#193): a parent with no children gets no write
 * (null). Done when every child's Status is "Done" (a child closed as
 * completed; a closed-not-planned child never reaches "Done" on its own, so
 * it never counts here). Otherwise: none started (no child "Done", "In
 * Review" or "In Progress") is Todo; otherwise In Progress unless every open
 * (non-Done) child, started or not, is "In Review", in which case In Review.
 * A Milestone rolls up the same way over its Phase parents' own already-computed Status,
 * since a nested parent is just another child by the time this runs bottom
 * up. The existing Blocked rule holds: automation moves a Blocked parent only
 * to Done or In Review, never to Todo or In Progress.
 *
 * The parent issue's own "closed as completed" case is not this function's
 * concern; that is the existing truth()-from-issue-state rule the caller
 * applies before falling back to this roll-up.
 *
 * @param {Array<string|null|undefined>} children each child's current Status
 * @param {string|null} current the parent's current Status field value
 * @returns {string|null} the desired Status, or null to make no write
 */
export function parentStatus(children, current) {
  if (children.length === 0) return null;
  let next;
  if (children.every((s) => s === "Done")) {
    next = "Done";
  } else {
    const started = children.some((s) => s === "Done" || s === "In Review" || s === "In Progress");
    if (!started) {
      next = "Todo";
    } else {
      const open = children.filter((s) => s !== "Done");
      next = open.length > 0 && open.every((s) => s === "In Review") ? "In Review" : "In Progress";
    }
  }
  if (current === "Blocked" && next !== "Done" && next !== "In Review") return current;
  return next;
}
