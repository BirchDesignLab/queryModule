import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { PurgedResultCard } from "./PurgedResultCard.js";

// BW3 Task 6 (#735; FR-062 read half, SEC-021; spec 5.5, 6.2; design note "Purged results and
// values"): a returned result whose payload was purged under retention is a dashed card headed
// "Source: returned" with the line "Purged under retention" and a one-sentence note. It carries no
// severity badge, no mapped elements, no generic dump and no toggle: it takes no payload at all.

const MESSAGES: Record<string, string> = {
  "sourceStatus.line": "{source}: {status}",
  "result.purged": "Purged under retention",
  "result.purgedNote":
    "The answer was removed under the site's retention policy. The request and its audit entries remain.",
};
const t = (key: string, params?: Readonly<Record<string, string | number | boolean>>) =>
  (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));

describe("PurgedResultCard", () => {
  it("is a section named by its 'source: status' heading, like a result card", () => {
    render(<PurgedResultCard heading="National system" status="returned" t={t} />);
    const section = screen.getByRole("region", { name: "National system: returned" });
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 4 })).toHaveTextContent(
      "National system: returned",
    );
  });

  it("says Purged under retention and why, with no badge, no mapped content and no controls", () => {
    render(<PurgedResultCard heading="National system" status="returned" t={t} />);
    const section = screen.getByRole("region", { name: "National system: returned" });
    expect(section).toHaveTextContent("Purged under retention");
    expect(section).toHaveTextContent("The request and its audit entries remain.");
    expect(within(section).queryByRole("button")).toBeNull();
    expect(within(section).queryByText(/critical|warning|info/i)).toBeNull();
    expect(section.className).toContain("qm-card--purged");
    expect(section.className).not.toMatch(/qm-card--(critical|warning|info)/);
  });

  it("uses an h5 in a nested part", () => {
    render(<PurgedResultCard heading="State system" status="returned" headingLevel={5} t={t} />);
    expect(screen.getByRole("heading", { level: 5 })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PurgedResultCard heading="National system" status="returned" t={t} />,
    );
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
