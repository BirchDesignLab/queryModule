// Pure SVG renderer for the README progress dashboard (README option B, #80
// requirement 8). No IO: gh-setup-project.mjs builds the model from live data
// (or a fixture, for the committed SVGs) and calls renderDashboard.
//
// Safety and accessibility (#80 requirement 9): the output is static markup
// only (no <script>, no on* event attributes, no <foreignObject>, no external
// href or font URL), every text node is XML-escaped, the root carries
// role="img" with a <title> and <desc>, and the same model always renders the
// same bytes (no clock reads; "as of" is a model field, and the caller is
// responsible for handing in sorted arrays).

const PALETTES = {
  light: {
    bg: "#ffffff",
    text: "#1f2328",
    subtext: "#57606a",
    track: "#d0d7de",
    done: "#1a7f37",
    active: "#9a6700",
    todo: "#57606a",
    blocked: "#a4262c",
  },
  dark: {
    bg: "#0d1117",
    text: "#e6edf3",
    subtext: "#9198a1",
    track: "#30363d",
    done: "#3fb950",
    active: "#d29922",
    todo: "#9198a1",
    blocked: "#f85149",
  },
};

/** XML-escape a text node or attribute value. `&` first, so it is not double-escaped. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const clampPct = (closed, total) => (total > 0 ? Math.round((100 * closed) / total) : 0);

/**
 * Render the roadmap and status dashboard as a standalone SVG string.
 *
 * @param {{
 *   asOf: string,
 *   milestones: Array<{title: string, closed: number, total: number,
 *     phases: Array<{title: string, closed: number, total: number}>}>,
 *   waves: Array<{k: number, title: string, start: string|null, finish: string|null}>,
 *   decisions: Array<{number: number, title: string}>,
 *   statusCounts: Array<{status: string, count: number}>,
 * }} model
 * @param {"light"|"dark"} theme
 * @returns {string}
 */
export function renderDashboard(model, theme) {
  if (theme !== "light" && theme !== "dark") throw new Error(`unknown theme: ${theme}`);
  const c = PALETTES[theme];
  const W = 900;
  const MARGIN = 24;
  const BAR_W = 320;
  const BAR_H = 10;
  const ROW_H = 24;
  let y = 44;
  const body = [];

  const heading = (text) => {
    body.push(
      `<text x="${MARGIN}" y="${y}" fill="${c.text}" font-size="15" font-weight="700">${escapeXml(text)}</text>`,
    );
    y += ROW_H;
  };
  const bar = (x, closed, total, label) => {
    const pct = clampPct(closed, total);
    const w = total > 0 ? Math.round((BAR_W * closed) / total) : 0;
    body.push(
      `<rect x="${x}" y="${y - 12}" width="${BAR_W}" height="${BAR_H}" fill="${c.track}"/>`,
    );
    if (w > 0)
      body.push(`<rect x="${x}" y="${y - 12}" width="${w}" height="${BAR_H}" fill="${c.done}"/>`);
    body.push(
      `<text x="${x + BAR_W + 10}" y="${y - 3}" fill="${c.subtext}" font-size="12">${escapeXml(label)} ${pct}% (${closed}/${total})</text>`,
    );
    y += ROW_H;
  };

  // Milestones and their phase sub-issue bars.
  heading("Milestones");
  for (const m of model.milestones) {
    bar(MARGIN, m.closed, m.total, m.title);
    for (const p of m.phases) bar(MARGIN + 24, p.closed, p.total, p.title);
  }

  // P0 wave timeline: a horizontal span from rolled-up Start to Finish.
  y += 8;
  heading("P0 wave timeline");
  const dated = model.waves.filter((w) => w.start);
  if (dated.length > 0) {
    const days = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
    const lo = Math.min(...dated.map((w) => days(w.start)));
    const hi = Math.max(...dated.map((w) => days(w.finish ?? w.start)));
    const span = Math.max(1, hi - lo);
    for (const w of model.waves) {
      const label = `W${w.k}: ${w.title}`;
      if (!w.start) {
        body.push(
          `<text x="${MARGIN}" y="${y - 3}" fill="${c.subtext}" font-size="12">${escapeXml(label)}</text>`,
        );
        y += ROW_H;
        continue;
      }
      const x0 = MARGIN + Math.round((BAR_W * (days(w.start) - lo)) / span);
      const x1 = MARGIN + Math.round((BAR_W * (days(w.finish ?? w.start) - lo)) / span);
      body.push(
        `<rect x="${MARGIN}" y="${y - 12}" width="${BAR_W}" height="${BAR_H}" fill="${c.track}"/>`,
      );
      body.push(
        `<rect x="${x0}" y="${y - 12}" width="${Math.max(2, x1 - x0)}" height="${BAR_H}" fill="${c.active}"/>`,
      );
      body.push(
        `<text x="${MARGIN + BAR_W + 10}" y="${y - 3}" fill="${c.subtext}" font-size="12">${escapeXml(label)} ${escapeXml(w.start)} to ${escapeXml(w.finish ?? "in progress")}</text>`,
      );
      y += ROW_H;
    }
  } else {
    body.push(
      `<text x="${MARGIN}" y="${y - 3}" fill="${c.subtext}" font-size="12">No dated waves yet.</text>`,
    );
    y += ROW_H;
  }

  // Open decisions (label "decision").
  y += 8;
  heading("Open decisions");
  if (model.decisions.length > 0) {
    for (const d of model.decisions) {
      body.push(
        `<text x="${MARGIN}" y="${y - 3}" fill="${c.text}" font-size="12">#${d.number} ${escapeXml(d.title)}</text>`,
      );
      y += ROW_H;
    }
  } else {
    body.push(
      `<text x="${MARGIN}" y="${y - 3}" fill="${c.subtext}" font-size="12">None open.</text>`,
    );
    y += ROW_H;
  }

  // Task and follow-up counts by board Status.
  y += 8;
  heading("Tasks and follow-ups by status");
  const totalCount = model.statusCounts.reduce((n, s) => n + s.count, 0) || 1;
  let x = MARGIN;
  const statusFill = (status) =>
    status === "Done"
      ? c.done
      : status === "Blocked"
        ? c.blocked
        : status === "Todo"
          ? c.todo
          : c.active;
  body.push(
    `<rect x="${MARGIN}" y="${y - 12}" width="${BAR_W}" height="${BAR_H}" fill="${c.track}"/>`,
  );
  for (const s of model.statusCounts) {
    const w = Math.round((BAR_W * s.count) / totalCount);
    if (w > 0)
      body.push(
        `<rect x="${x}" y="${y - 12}" width="${w}" height="${BAR_H}" fill="${statusFill(s.status)}"/>`,
      );
    x += w;
  }
  y += ROW_H;
  for (const s of model.statusCounts) {
    body.push(
      `<text x="${MARGIN}" y="${y - 3}" fill="${c.subtext}" font-size="12">${escapeXml(s.status)}: ${s.count}</text>`,
    );
    y += ROW_H;
  }

  const H = y + MARGIN;
  const titleText = `Query Module 2.0 progress dashboard, as of ${model.asOf}`;
  const descText =
    "Milestone and phase progress, the P0 wave timeline, open decisions and task/follow-up counts by status.";
  return [
    `<svg role="img" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">`,
    `<title>${escapeXml(titleText)}</title>`,
    `<desc>${escapeXml(descText)}</desc>`,
    `<rect width="${W}" height="${H}" fill="${c.bg}"/>`,
    ...body,
    "</svg>",
  ].join("\n");
}
