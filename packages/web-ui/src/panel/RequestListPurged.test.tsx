import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RequestList, type RequestRowView } from "./RequestList.js";

// BW3 Task 6 and the BW2 minors (#735, #754; spec 5.5, 6.2; design note "Purged results and
// values", D-M2P2-B4): a request whose values were purged keeps its type values and says the rest
// are purged; Edit as new query on it is disabled with its reason in text; an entry can carry a
// status line ("2 of 2 sources done. 2 returned, purged."); the list can drop its own heading where
// a page heading already names the request.

const LABELS: Record<string, string> = {
  "requests.status.acknowledged": "Acknowledged",
  "requests.sentAt": "Sent {time}",
  "submit.reference": "Reference",
  "requests.copyReferenceOf": "Copy reference {reference} for {summary}",
  "submit.copyReference": "Copy reference",
  "requests.editAsNew": "Edit as new query",
  "requests.editAsNewOf": "Edit as new query: {summary}",
  "sourceStatus.heading": "Source status for {summary}",
};
const t = (key: string, params?: Readonly<Record<string, string | number | boolean>>) =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    LABELS[key] ?? key,
  );

const ROW: RequestRowView = {
  id: "r1",
  status: "acknowledged",
  typeLabel: "Property",
  summary: "ARTICLE",
  name: "Property 5f0e1a2b",
  reference: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  acknowledgedAt: new Date(2026, 8, 14, 16, 20, 8).getTime(),
  notes: [],
};
const base = { heading: "Request", emptyText: "", onCopy: () => {}, t };

describe("a request whose values were purged", () => {
  it("shows the kept type values in mono and the purged words beside them", () => {
    render(
      <RequestList
        {...base}
        rows={[{ ...ROW, purgedValuesText: "Other values purged under retention" }]}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(row.querySelector("code")).toHaveTextContent("ARTICLE");
    expect(row).toHaveTextContent("Other values purged under retention");
  });

  it("shows no purged words on a row that kept its values", () => {
    render(<RequestList {...base} rows={[ROW]} />);
    expect(screen.getByRole("listitem")).not.toHaveTextContent(/purged/i);
  });

  it("Edit as new query is aria-disabled, focusable, does nothing, and its reason is its description", async () => {
    const calls: string[] = [];
    render(
      <RequestList
        {...base}
        rows={[{ ...ROW, editBlockedText: "The values were purged under retention." }]}
        onEditAsNew={(id) => calls.push(id)}
      />,
    );
    const button = screen.getByRole("button", { name: "Edit as new query: Property 5f0e1a2b" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("The values were purged under retention.");
    button.focus();
    expect(button).toHaveFocus();
    button.click();
    expect(calls).toEqual([]);
    expect(within(screen.getByRole("listitem")).getByText(/were purged/)).toBeInTheDocument();
  });

  it("an editable row keeps its working action and shows no reason", () => {
    const calls: string[] = [];
    render(
      <RequestList
        {...base}
        rows={[{ ...ROW, editable: true }]}
        onEditAsNew={(id) => calls.push(id)}
      />,
    );
    const button = screen.getByRole("button", { name: "Edit as new query: Property 5f0e1a2b" });
    expect(button).not.toHaveAttribute("aria-disabled");
    button.click();
    expect(calls).toEqual(["r1"]);
  });
});

describe("the entry's status line", () => {
  it("shows the line beside the time and reference when the row has one", () => {
    render(
      <RequestList
        {...base}
        rows={[{ ...ROW, statusLine: "2 of 2 sources done. 1 returned, 1 timed out." }]}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "2 of 2 sources done. 1 returned, 1 timed out.",
    );
  });
});

describe("a list with no heading of its own", () => {
  it("names the section by aria-label and renders no heading element", () => {
    render(<RequestList {...base} headingLevel={null} rows={[ROW]} />);
    expect(screen.getByRole("region", { name: "Request" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Request" })).toBeNull();
    // The entry's own h3 stands in, so the page's heading order has no gap.
    expect(screen.getByRole("heading", { level: 3, name: "Property" })).toBeInTheDocument();
  });

  it("still has its heading by default", () => {
    render(<RequestList {...base} rows={[ROW]} />);
    expect(screen.getByRole("heading", { level: 2, name: "Request" })).toBeInTheDocument();
  });
});
