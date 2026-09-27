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
  if (issue.state === "closed") {
    const reason = issue.state_reason ?? null;
    return reason === "completed" || reason === null ? "Done" : undefined;
  }
  return { review: "In Review", ready: "Ready", todo: "Todo" }[waveState];
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
export function bodyUpdate(existing, desired) {
  const normalise = (s) =>
    s
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n");
  return normalise(existing) === normalise(desired) ? null : desired;
}
