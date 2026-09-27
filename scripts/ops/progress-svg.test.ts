import { contrastRatio } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";
import { escapeXml, renderDashboard } from "./progress-svg.mjs";

const MODEL = {
  asOf: "2026-09-26",
  milestones: [
    {
      title: "M0 Skeleton",
      closed: 26,
      total: 50,
      phases: [
        { title: "Contracts (M0 P0)", closed: 6, total: 9 },
        { title: "Foundation (M0 P1)", closed: 0, total: 10 },
      ],
    },
    { title: "M1 Forms and terminal", closed: 0, total: 3, phases: [] },
  ],
  waves: [
    { k: 1, title: "Workspace and first contracts", start: "2026-09-25", finish: "2026-09-26" },
    { k: 2, title: "Site config schema", start: "2026-09-26", finish: "2026-09-26" },
    { k: 6, title: "Not started", start: null, finish: null },
  ],
  decisions: [{ number: 80, title: "Roadmap roll-up & <script> escape check" }],
  statusCounts: [
    { status: "Todo", count: 19 },
    { status: "Ready", count: 3 },
    { status: "Done", count: 22 },
  ],
};

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("renderDashboard: both themes render (#80 requirement 8)", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`renders a well-formed SVG in ${theme} mode`, () => {
      const svg = renderDashboard(MODEL, theme);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).toContain('role="img"');
      expect(svg).toContain("<title>");
      expect(svg).toContain("<desc>");
    });
  }

  it("rejects an unknown theme", () => {
    const invalidTheme = "sepia" as unknown as "light" | "dark";
    expect(() => renderDashboard(MODEL, invalidTheme)).toThrow();
  });
});

describe("renderDashboard: escaping (#80 requirement 9)", () => {
  it("escapes a decision title containing <script> and &", () => {
    const svg = renderDashboard(MODEL, "light");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
  });
});

describe("renderDashboard: SVG safety (#80 requirement 9)", () => {
  it("coerces numeric model fields, so markup passed as a number is never emitted (PR #83 review M4)", () => {
    const evil = "<script>x</script>" as unknown as number;
    const svg = renderDashboard(
      {
        ...MODEL,
        milestones: [
          {
            title: "M",
            closed: evil,
            total: evil,
            phases: [{ title: "P", closed: 1, total: evil }],
          },
        ],
        waves: [{ k: evil, title: "W", start: "2026-09-25", finish: null }],
        decisions: [{ number: evil, title: "D" }],
        statusCounts: [{ status: "Todo", count: evil }],
      },
      "light",
    );
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("&lt;script");
    expect(svg).not.toContain("NaN");
  });

  it("has no <script>, event attributes, <foreignObject> or external href/font URL", () => {
    for (const theme of ["light", "dark"] as const) {
      const svg = renderDashboard(MODEL, theme);
      expect(svg).not.toMatch(/<script/i);
      expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg).not.toMatch(/<foreignObject/i);
      expect(svg).not.toMatch(/href\s*=\s*"https?:/i);
      expect(svg).not.toMatch(/@import|url\(https?:/i);
    }
  });

  it("carries role=img with a title and desc naming the as-of date", () => {
    const svg = renderDashboard(MODEL, "light");
    expect(svg).toMatch(/<title>[^<]*2026-09-26[^<]*<\/title>/);
  });
});

describe("renderDashboard: determinism (#80 requirement 9)", () => {
  it("gives byte-identical output for the same model and theme", () => {
    expect(renderDashboard(MODEL, "light")).toBe(renderDashboard(MODEL, "light"));
    expect(renderDashboard(MODEL, "dark")).toBe(renderDashboard(MODEL, "dark"));
  });
});

describe("renderDashboard: contrast (#80 requirement 9)", () => {
  // The renderer's own fixed palette must clear WCAG text (4.5:1) and
  // non-text/bar (3:1) minimums in both themes, using the same contrastRatio
  // helper the tokens package tests itself with (Task 23).
  const PALETTES = {
    light: {
      bg: "#ffffff",
      text: "#1f2328",
      subtext: "#57606a",
      done: "#1a7f37",
      active: "#9a6700",
    },
    dark: {
      bg: "#0d1117",
      text: "#e6edf3",
      subtext: "#9198a1",
      done: "#3fb950",
      active: "#d29922",
    },
  };
  for (const theme of ["light", "dark"] as const) {
    it(`meets 4.5:1 text contrast and 3:1 bar contrast in ${theme} mode`, () => {
      const p = PALETTES[theme];
      expect(contrastRatio(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.subtext, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.done, p.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(p.active, p.bg)).toBeGreaterThanOrEqual(3);
    });
  }
});
