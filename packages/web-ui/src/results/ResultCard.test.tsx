import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Highlighted } from "./Highlighted.js";
import { MappedElements } from "./MappedElements.js";
import { ResultCard } from "./ResultCard.js";
import { ResultTable } from "./ResultTable.js";
import { SeverityBadge } from "./SeverityBadge.js";
import { CLEAR, CRITICAL, GENERIC, KEYWORDS, MAPPED, STYLES, t } from "./test-data.js";

function Card(props: { mapped?: typeof MAPPED; assessment?: typeof CRITICAL; level?: 4 | 5 }) {
  const [view, setView] = useState<"summary" | "detail">("summary");
  return (
    <ResultCard
      heading="State system"
      status="returned"
      assessment={props.assessment ?? CRITICAL}
      mapped={props.mapped ?? MAPPED}
      keywords={KEYWORDS}
      styles={STYLES}
      view={view}
      onToggleView={() => setView((v) => (v === "summary" ? "detail" : "summary"))}
      toggleContext="State system, VEH ZZ-0001"
      headingLevel={props.level}
      t={t}
    />
  );
}

async function axeViolations(container: HTMLElement) {
  // jsdom has no layout, so colour contrast is covered by the tokens test, not here.
  const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return r.violations.map((v) => v.id);
}

describe("FR-060 result card semantics (spec 6.2)", () => {
  it("is a section named by its 'source: status' heading", () => {
    render(<Card />);
    const section = screen.getByRole("region", { name: "State system: returned" });
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 4 })).toHaveTextContent(
      "State system: returned",
    );
  });
  it("uses an h5 in a nested part", () => {
    render(<Card level={5} />);
    expect(screen.getByRole("heading", { level: 5 })).toBeInTheDocument();
  });
  it("shows summary and both elements as dt label and dd value, detail hidden", () => {
    render(<Card />);
    expect(screen.getByText("Plate").tagName).toBe("DT");
    expect(screen.getByText("ZZ-0001").tagName).toBe("DD");
    expect(screen.getByText("Flags")).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("UX-015 the toggle flips aria-expanded, opens detail below it and keeps focus", async () => {
    const user = userEvent.setup();
    render(<Card />);
    const toggle = screen.getByRole("button", { name: /Show detail/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAccessibleName("Show detail 2 more items State system, VEH ZZ-0001");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    expect(screen.getByRole("button", { name: /Hide detail/ })).toBe(toggle);
    const region = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByText("Owner")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });
  it("has no toggle when the mapping has no detail-only elements", () => {
    render(<Card mapped={{ ...MAPPED, elements: MAPPED.elements.slice(0, 2) }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("the generic dump has a note, the path as label, keyword marks and no toggle", () => {
    render(<Card mapped={GENERIC} assessment={CLEAR} />);
    expect(screen.getByText(/No card is set up for this result/)).toBeInTheDocument();
    expect(screen.getByText("/vehicle/make").tagName).toBe("DT");
    expect(screen.getByText("TESTMAKE").closest("mark")).not.toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("UX-016 shows mapping diagnostics in development builds", () => {
    render(<Card />);
    expect(screen.getByText("Mapping notes (development)")).toBeInTheDocument();
    expect(screen.getByText(/\/missing/)).toBeInTheDocument();
  });
  it("carries the severity on a 4 px start edge besides the badge", () => {
    render(<Card />);
    const section = screen.getByRole("region", { name: "State system: returned" });
    expect(section.getAttribute("style")).toMatch(/border-inline-start/);
    expect(within(section).getAllByText("Critical").length).toBeGreaterThan(0);
  });
  it("shows no badge and no edge without a severity", () => {
    render(<Card assessment={CLEAR} />);
    const section = screen.getByRole("region", { name: "State system: returned" });
    expect(within(section).queryByText("Critical")).not.toBeInTheDocument();
    expect(section.getAttribute("style") ?? "").not.toMatch(/border-inline-start/);
  });
  it.each(["light", "dark"])("is axe clean in %s, closed and open", async (mode) => {
    document.documentElement.dataset.theme = mode === "dark" ? "night" : "day";
    const user = userEvent.setup();
    const { container } = render(<Card />);
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Show detail/ }));
    expect(await axeViolations(container)).toEqual([]);
    delete document.documentElement.dataset.theme;
  });
});

describe("UX-010 severity badge", () => {
  it("renders an aria-hidden icon, the word and an aria-hidden marker", () => {
    const { container } = render(<SeverityBadge severity="critical" styles={STYLES} t={t} />);
    const badge = container.querySelector(".qm-badge--critical") as HTMLElement;
    expect(badge).toHaveTextContent("Critical");
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("!!")).toHaveAttribute("aria-hidden", "true");
  });
  it("renders nothing when severity is null", () => {
    const { container } = render(<SeverityBadge severity={null} styles={STYLES} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("falls back to a generic icon for an unknown icon name", () => {
    const styles = { ...STYLES, info: { ...STYLES.info, icon: "made-up" } };
    const { container } = render(<SeverityBadge severity="info" styles={styles} t={t} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("UX-011 keyword highlight", () => {
  it("marks each hit with icon, word, marker and a hidden severity, other text plain", () => {
    const { container } = render(
      <p>
        <Highlighted
          text="Reported STOLEN today"
          keywords={KEYWORDS}
          highlight
          styles={STYLES}
          t={t}
        />
      </p>,
    );
    const mark = container.querySelector("mark") as HTMLElement;
    expect(mark).toHaveTextContent("STOLEN");
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(mark).getByText("!!")).toHaveAttribute("aria-hidden", "true");
    expect(within(mark).getByText("(critical)")).toBeInTheDocument();
    expect(container.textContent).toContain("Reported ");
    expect(container.textContent).toContain(" today");
  });
  it("renders plain text when highlight is false", () => {
    const { container } = render(
      <p>
        <Highlighted text="STOLEN" keywords={KEYWORDS} highlight={false} styles={STYLES} t={t} />
      </p>,
    );
    expect(container.querySelector("mark")).toBeNull();
    expect(container).toHaveTextContent("STOLEN");
  });
});

describe("UX-016 result table", () => {
  it("is a focusable labelled region around a captioned table with column headers", () => {
    render(
      <ResultTable
        label="History"
        columns={["Year", "Event"]}
        rows={[
          ["1901", "TESTMAKE recall"],
          ["1902", "Registered"],
        ]}
        keywords={KEYWORDS}
        highlight
        styles={STYLES}
        t={t}
      />,
    );
    const region = screen.getByRole("region", { name: /History/ });
    expect(region).toHaveAttribute("tabindex", "0");
    const table = within(region).getByRole("table", { name: /History/ });
    expect(table.querySelector("caption")).toHaveTextContent("History");
    expect(within(table).getByText("2 rows")).toBeInTheDocument();
    const heads = within(table).getAllByRole("columnheader");
    expect(heads.map((h) => h.getAttribute("scope"))).toEqual(["col", "col"]);
    expect(table.querySelector("mark")).toHaveTextContent("TESTMAKE");
  });
});

describe("mapped elements", () => {
  it("renders scalars as dt/dd pairs and tables as regions, resolving label keys", () => {
    render(<MappedElements elements={MAPPED.elements} keywords={KEYWORDS} styles={STYLES} t={t} />);
    expect(screen.getByText("Owner").tagName).toBe("DT");
    expect(screen.getByRole("region", { name: /History/ })).toBeInTheDocument();
  });
});
