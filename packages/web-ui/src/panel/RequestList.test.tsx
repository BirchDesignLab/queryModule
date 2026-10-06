import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  formatAckTime,
  RequestList,
  type RequestPartView,
  type RequestRowView,
} from "./RequestList.js";

const LABELS: Record<string, string> = {
  "requests.status.sending": "Sending",
  "requests.status.acknowledged": "Acknowledged",
  "requests.status.failed": "Failed",
  "requests.sentAt": "Sent {time}",
  "submit.reference": "Reference",
  "requests.copyReferenceOf": "Copy reference {reference} for {summary}",
  "submit.copyReference": "Copy reference",
  "requests.retry": "Retry",
  "requests.retryOf": "Retry {summary}",
  "sourceStatus.heading": "Source status for {summary}",
};
const t = (key: string, params?: Readonly<Record<string, string | number | boolean>>) =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    LABELS[key] ?? key,
  );

const SENDING: RequestRowView = {
  id: "r2",
  status: "sending",
  typeLabel: "Person",
  summary: "PER.TESTERSON.AVERY",
  notes: [],
};
const ACKED: RequestRowView = {
  id: "r1",
  status: "acknowledged",
  typeLabel: "Vehicle",
  summary: "VEH.ZZ-0001.TX",
  reference: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  acknowledgedAt: new Date(2026, 8, 29, 13, 4, 5).getTime(),
  notes: ["State source: pending"],
};
const FAILED: RequestRowView = {
  id: "r0",
  status: "failed",
  typeLabel: "Vehicle",
  summary: "VEH.ZZ-0002.TX",
  failureText: "The server did not answer.",
  notes: [],
};

const base = {
  heading: "Requests this shift",
  emptyText: "No requests yet this shift.",
  onCopy: () => {},
  t,
};

describe("spec 6.7 requests list (B3)", () => {
  it("is a labelled section with an ordered list, not a live region (the announcer speaks)", () => {
    render(<RequestList {...base} rows={[ACKED]} />);
    const section = screen.getByRole("region", { name: "Requests this shift" });
    expect(within(section).getByRole("list")).toBeInTheDocument();
    expect(section).not.toHaveAttribute("aria-live");
    expect(section.querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
  });

  it("shows the empty text and no list when there are no rows", () => {
    render(<RequestList {...base} rows={[]} />);
    expect(screen.getByText("No requests yet this shift.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("a Sending row has the type, the command in mono and a Sending badge, and nothing to copy", () => {
    render(<RequestList {...base} rows={[SENDING]} />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Person");
    expect(row.querySelector("code")).toHaveTextContent("PER.TESTERSON.AVERY");
    expect(row).toHaveTextContent("Sending");
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("an acknowledged row shows the time, the short reference and one pending note per source", () => {
    render(<RequestList {...base} rows={[ACKED]} />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Acknowledged");
    expect(row).toHaveTextContent(`Sent ${formatAckTime(ACKED.acknowledgedAt ?? 0)}`);
    expect(row).toHaveTextContent("09-29-26 13:04:05");
    expect(row).toHaveTextContent("0198a1b2");
    expect(row).not.toHaveTextContent("0198a1b2-c3d4");
    expect(row).toHaveTextContent("State source: pending");
  });

  it("Copy reference hands the full correlation ID to onCopy and names its row", async () => {
    const onCopy = vi.fn();
    render(<RequestList {...base} rows={[ACKED]} onCopy={onCopy} />);
    const button = screen.getByRole("button", {
      name: "Copy reference 0198a1b2 for VEH.ZZ-0001.TX",
    });
    await userEvent.click(button);
    expect(onCopy).toHaveBeenCalledWith(ACKED.reference);
  });

  it("a failed row states the reason as text with a Failed badge", () => {
    render(<RequestList {...base} rows={[FAILED]} />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Failed");
    expect(row).toHaveTextContent("The server did not answer.");
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("keeps the order it is given (newest first) and a stable key per row", () => {
    const { rerender } = render(<RequestList {...base} rows={[SENDING, ACKED]} />);
    const before = screen.getAllByRole("listitem")[0];
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("PER."),
      expect.stringContaining("VEH.ZZ-0001"),
    ]);
    // Sending becomes Acknowledged: the same DOM node, so nothing the user is on is rebuilt.
    rerender(
      <RequestList
        {...base}
        rows={[{ ...ACKED, id: "r2", typeLabel: "Person", summary: "PER.TESTERSON.AVERY" }, ACKED]}
      />,
    );
    expect(screen.getAllByRole("listitem")[0]).toBe(before);
  });

  it("shows the count beside the heading, outside the heading's name, and none without it", () => {
    const { rerender } = render(
      <RequestList {...base} rows={[SENDING, ACKED]} countText="2 requests" />,
    );
    const section = screen.getByRole("region", { name: "Requests this shift" });
    const heading = within(section).getByRole("heading", { name: "Requests this shift" });
    const count = within(section).getByText("2 requests");
    expect(heading).not.toContainElement(count);
    expect(count.closest("[aria-live], [role=status]")).toBeNull();
    rerender(<RequestList {...base} rows={[SENDING, ACKED]} />);
    expect(screen.queryByText("2 requests")).toBeNull();
  });

  it("gives each list its own heading id", () => {
    render(
      <>
        <RequestList {...base} rows={[]} />
        <RequestList {...base} heading="Last request" rows={[]} />
      </>,
    );
    expect(screen.getByRole("region", { name: "Requests this shift" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Last request" })).toBeInTheDocument();
  });

  it("formatAckTime builds its Intl formatter once, not per call (a list of rows formats on every render)", () => {
    const construct = vi.spyOn(Intl, "DateTimeFormat");
    try {
      for (let i = 0; i < 5; i += 1) formatAckTime(new Date(2026, 8, 29, 13, 4, i).getTime());
      // At most the first call builds it; a module already used by an earlier test builds none.
      expect(construct.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      construct.mockRestore();
    }
  });

  it("formatAckTime is MM-DD-YY HH:mm:ss in local time (spec 6.2)", () => {
    expect(formatAckTime(new Date(2026, 8, 29, 13, 4, 5).getTime())).toBe("09-29-26 13:04:05");
  });
});

describe("failed-row retry (the list only shows the button; the owner sends)", () => {
  const RETRYABLE: RequestRowView = { ...FAILED, retryable: true };

  it("a retryable failed row has a Retry button that names its command and calls onRetry with the row", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<RequestList {...base} rows={[RETRYABLE]} onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: "Retry VEH.ZZ-0002.TX" });
    // The visible text is inside the accessible name (WCAG 2.5.3).
    expect(button).toHaveTextContent("Retry");
    await user.click(button);
    expect(onRetry).toHaveBeenCalledWith("r0");
  });

  it("names the type when the command is empty", () => {
    render(
      <RequestList {...base} rows={[{ ...RETRYABLE, summary: "" }]} onRetry={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: "Retry Vehicle" })).toBeInTheDocument();
  });

  it("no button on a row that is not retryable, sending, acknowledged, or when there is no handler", () => {
    const { rerender } = render(
      <RequestList {...base} rows={[FAILED, SENDING, ACKED]} onRetry={() => undefined} />,
    );
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
    rerender(<RequestList {...base} rows={[RETRYABLE]} />);
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("the failure text stays beside the button, and the list stays free of live regions", () => {
    render(<RequestList {...base} rows={[RETRYABLE]} onRetry={() => undefined} />);
    expect(screen.getByText("The server did not answer.")).toBeInTheDocument();
    expect(document.querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
  });

  it("focus stays on the button when the failed row stays (the list variant)", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<RequestList {...base} rows={[RETRYABLE]} onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: /^Retry/ });
    await user.click(button);
    rerender(
      <RequestList {...base} rows={[{ ...SENDING, id: "r9" }, RETRYABLE]} onRetry={onRetry} />,
    );
    expect(button).toHaveFocus();
  });

  it("repairs lost focus: a retry that replaces the only row (the officer's last request) moves focus to the heading, once", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const props = { ...base, heading: "Last request", onRetry };
    const { rerender } = render(<RequestList {...props} rows={[RETRYABLE]} />);
    await user.click(screen.getByRole("button", { name: /^Retry/ }));
    // The list now shows only the newest row: the button is gone with its row.
    rerender(<RequestList {...props} rows={[{ ...SENDING, id: "r9" }]} />);
    const heading = screen.getByRole("heading", { name: "Last request" });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");
    // A later change never pulls focus back once the user has moved on.
    heading.blur();
    rerender(<RequestList {...props} rows={[{ ...ACKED, id: "r9" }]} />);
    expect(heading).not.toHaveFocus();
  });

  it("leaves focus alone when the retry button was not the focused element", async () => {
    const onRetry = vi.fn();
    const props = { ...base, onRetry };
    const { rerender } = render(<RequestList {...props} rows={[RETRYABLE]} />);
    // A click that never focused the button (some browsers do not focus a clicked button).
    screen.getByRole("button", { name: /^Retry/ }).click();
    expect(document.body).toHaveFocus();
    rerender(<RequestList {...props} rows={[{ ...SENDING, id: "r9" }]} />);
    expect(document.body).toHaveFocus();
  });
});

describe("FR-043 per-source status lines (spec 6.2, 6.6)", () => {
  const PARTS: readonly RequestPartView[] = [
    {
      key: "c1:1",
      lines: [
        { key: "c1:1:state", tone: "pending", text: "State source: pending" },
        { key: "c1:1:national", tone: "ok", text: "National source: returned" },
      ],
    },
    {
      key: "c1:2",
      label: "Also run: Warrant",
      lines: [{ key: "c1:2:state", tone: "problem", text: "State source: timed out" }],
    },
    { key: "c1:3", label: "Also run: Property", skippedText: "Property was not run.", lines: [] },
  ];
  const WITH_PARTS: RequestRowView = { ...ACKED, notes: [], parts: PARTS };

  it("lists each source with its status in words, under a list named for the command", () => {
    render(<RequestList {...base} rows={[WITH_PARTS]} />);
    const sources = screen.getByRole("group", { name: "Source status for VEH.ZZ-0001.TX" });
    expect(sources).toHaveTextContent("State source: pending");
    expect(sources).toHaveTextContent("National source: returned");
    expect(sources).toHaveTextContent("State source: timed out");
  });

  it("labels a nested part with its origin and shows a skipped part as skipped", () => {
    render(<RequestList {...base} rows={[WITH_PARTS]} />);
    expect(screen.getByText("Also run: Warrant")).toBeInTheDocument();
    expect(screen.getByText("Also run: Property")).toBeInTheDocument();
    expect(screen.getByText("Property was not run.")).toBeInTheDocument();
  });

  it("no status is colour alone: every line is text, and every icon is aria-hidden", () => {
    render(<RequestList {...base} rows={[WITH_PARTS]} />);
    const sources = screen.getByRole("group", { name: "Source status for VEH.ZZ-0001.TX" });
    const icons = sources.querySelectorAll(".qm-source__icon");
    expect(icons.length).toBe(4);
    for (const icon of icons) expect(icon).toHaveAttribute("aria-hidden", "true");
    // The accessible text carries the status without the icon's glyph.
    expect(screen.getByText("State source: timed out")).toBeInTheDocument();
  });

  it("an update changes a line in place: same DOM node, and focus stays where it was", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <input aria-label="Plate" />
        <RequestList {...base} rows={[WITH_PARTS]} />
      </>,
    );
    await user.type(screen.getByLabelText("Plate"), "ABC");
    const line = screen.getByText("State source: pending").closest(".qm-source");
    const item = screen.getAllByRole("listitem")[0];
    const updated: RequestRowView = {
      ...WITH_PARTS,
      parts: [
        {
          ...PARTS[0],
          key: "c1:1",
          lines: [
            { key: "c1:1:state", tone: "ok", text: "State source: returned" },
            { key: "c1:1:national", tone: "ok", text: "National source: returned" },
          ],
        },
        ...PARTS.slice(1),
      ],
    };
    rerender(
      <>
        <input aria-label="Plate" />
        <RequestList {...base} rows={[updated]} />
      </>,
    );
    expect(screen.getAllByRole("listitem")[0]).toBe(item);
    expect(screen.getByText("State source: returned").closest(".qm-source")).toBe(line);
    expect(screen.getByLabelText("Plate")).toHaveFocus();
    expect(screen.getByLabelText("Plate")).toHaveValue("ABC");
  });

  it("the status block is not a live region (the announcer speaks)", () => {
    render(<RequestList {...base} rows={[WITH_PARTS]} />);
    const section = screen.getByRole("region", { name: "Requests this shift" });
    expect(section.querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
  });

  it("a row without parts shows no status list", () => {
    render(<RequestList {...base} rows={[ACKED]} />);
    expect(screen.queryByRole("group", { name: /Source status/ })).toBeNull();
  });
});
