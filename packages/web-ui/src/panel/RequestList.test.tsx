import { resolveShortcuts } from "@querymodule/core/config";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutProvider } from "../shortcuts/ShortcutProvider.js";
import {
  formatAckTime,
  RequestList,
  type RequestPartView,
  type RequestRowView,
  shortReference,
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
  "requests.editAsNew": "Edit as new query",
  "requests.editAsNewOf": "Edit as new query: {summary}",
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
  name: "Person TESTERSON AVERY",
  notes: [],
};
const ACKED: RequestRowView = {
  id: "r1",
  status: "acknowledged",
  typeLabel: "Vehicle",
  summary: "VEH.ZZ-0001.TX",
  name: "Vehicle ZZ-0001",
  reference: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  acknowledgedAt: new Date(2026, 8, 29, 13, 4, 5).getTime(),
  notes: ["State source: pending"],
};
const FAILED: RequestRowView = {
  id: "r0",
  status: "failed",
  typeLabel: "Vehicle",
  summary: "VEH.ZZ-0002.TX",
  name: "Vehicle ZZ-0002",
  failureText: "The server did not answer.",
  notes: [],
};

const base = {
  heading: "Requests this shift",
  emptyText: "No requests yet this shift.",
  onCopy: () => {},
  t,
};

describe("SEC-014 shortReference names a request by the random part of its UUIDv7", () => {
  // Two UUIDv7 ids minted in the same second: the timestamp high bits agree, the random part differs.
  const first = "01a139c3-5e2a-7b10-8c4d-9f0e1a2b3c4d";
  const second = "01a139c3-5e9f-7d62-9a17-e3b8c6d5f7a1";

  it("two ids from the same second have different short references, though their 8-character prefixes match", () => {
    expect(first.slice(0, 8)).toBe(second.slice(0, 8));
    expect(shortReference(first)).toBe("1a2b3c4d");
    expect(shortReference(second)).toBe("c6d5f7a1");
    expect(shortReference(first)).not.toBe(shortReference(second));
  });

  it("an id that is not UUID-shaped falls back without throwing and is never empty", () => {
    expect(shortReference("x-1")).toBe("x-1");
    expect(shortReference("a")).toBe("a");
    expect(shortReference("not-a-hex-correlation-id")).toBe("ation-id");
    expect(shortReference("")).toBe("");
  });
});

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
    expect(row).toHaveTextContent("2e3f4a5b");
    expect(row).not.toHaveTextContent("0198a1b2-c3d4");
    expect(row).toHaveTextContent("State source: pending");
  });

  it("Copy reference hands the full correlation ID to onCopy and names its row", async () => {
    const onCopy = vi.fn();
    render(<RequestList {...base} rows={[ACKED]} onCopy={onCopy} />);
    const button = screen.getByRole("button", {
      name: "Copy reference 2e3f4a5b for Vehicle ZZ-0001",
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
        rows={[
          {
            ...ACKED,
            id: "r2",
            typeLabel: "Person",
            summary: "PER.TESTERSON.AVERY",
            name: "Person TESTERSON AVERY",
          },
          ACKED,
        ]}
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

describe("G12 the list offers a toast slot", () => {
  const props = { heading: "Requests this shift", emptyText: "none", onCopy: () => undefined, t };

  it("puts the slot under the heading by default, above the list", () => {
    render(<RequestList {...props} rows={[ACKED]} />);
    const slot = document.querySelector("[data-toast-slot]") as HTMLElement;
    const heading = screen.getByRole("heading", { name: "Requests this shift" });
    const list = screen.getByRole("list");
    expect(heading.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts the slot above the heading when asked (the officer's Last request)", () => {
    render(<RequestList {...props} rows={[ACKED]} toastSlot="beforeHeading" />);
    const slot = document.querySelector("[data-toast-slot]") as HTMLElement;
    const heading = screen.getByRole("heading", { name: "Requests this shift" });
    expect(slot.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("G11 a request that starts sending scrolls the list into view when it is below the fold", () => {
  const props = {
    heading: "Last request",
    emptyText: "Nothing sent yet.",
    onCopy: () => undefined,
    t,
  };

  /** The list's top edge is read live, so a test can move it between renders. */
  function spyOnLayout(initialTop: number) {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const state = { top: initialTop };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      top: state.top,
      bottom: state.top + 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: state.top,
      toJSON: () => ({}),
    }));
    return Object.assign(scrollIntoView, { state });
  }

  it("scrolls to the list top when a new Sending row arrives and the list starts below the top 30% of the screen", () => {
    const scrollIntoView = spyOnLayout(window.innerHeight * 0.8);
    const { rerender } = render(<RequestList {...props} rows={[ACKED]} revealOnSend />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<RequestList {...props} rows={[SENDING, ACKED]} revealOnSend />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("keeps bringing the list into view while the page is still too short, then stops once it is up", () => {
    const scrollIntoView = spyOnLayout(window.innerHeight * 0.8);
    const { rerender } = render(<RequestList {...props} rows={[ACKED]} revealOnSend />);
    rerender(<RequestList {...props} rows={[SENDING, ACKED]} revealOnSend />);
    // The first scroll stopped at the end of a short page; the cards arrive and the page grows.
    const settled = [{ ...SENDING, status: "acknowledged" as const }, ACKED];
    rerender(<RequestList {...props} rows={settled} revealOnSend />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    scrollIntoView.state.top = 10;
    rerender(<RequestList {...props} rows={[...settled]} revealOnSend />);
    scrollIntoView.state.top = window.innerHeight * 0.8;
    rerender(<RequestList {...props} rows={[...settled]} revealOnSend />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the list is already in the upper half, when the prop is off, or on first render", () => {
    const scrollIntoView = spyOnLayout(10);
    const { rerender } = render(<RequestList {...props} rows={[ACKED]} revealOnSend />);
    rerender(<RequestList {...props} rows={[SENDING, ACKED]} revealOnSend />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    const low = spyOnLayout(window.innerHeight * 0.8);
    const off = render(<RequestList {...props} rows={[SENDING]} />);
    off.rerender(<RequestList {...props} rows={[{ ...SENDING, id: "r3" }, SENDING]} />);
    expect(low).not.toHaveBeenCalled();
  });

  it("never moves focus", () => {
    spyOnLayout(window.innerHeight * 0.8);
    render(
      <>
        <button type="button">Run query</button>
        <RequestList {...props} rows={[SENDING]} revealOnSend />
      </>,
    );
    screen.getByRole("button", { name: "Run query" }).focus();
    expect(screen.getByRole("button", { name: "Run query" })).toHaveFocus();
  });
});

describe("failed-row retry (the list only shows the button; the owner sends)", () => {
  const RETRYABLE: RequestRowView = { ...FAILED, retryable: true };

  it("a retryable failed row has a Retry button that names its command and calls onRetry with the row", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<RequestList {...base} rows={[RETRYABLE]} onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: "Retry Vehicle ZZ-0002" });
    // The visible text is inside the accessible name (WCAG 2.5.3).
    expect(button).toHaveTextContent("Retry");
    await user.click(button);
    expect(onRetry).toHaveBeenCalledWith("r0");
  });

  it("#576 the fieldset, Copy and Retry names come from the row's name, never its command", () => {
    const rows: RequestRowView[] = [
      {
        ...ACKED,
        summary: "SECRETCMD",
        name: "Vehicle 0198a1b2",
        parts: [{ key: "p", lines: [] }],
      },
      { ...RETRYABLE, summary: "SECRETCMD", name: "Vehicle ZZ-0002" },
    ];
    render(<RequestList {...base} rows={rows} onRetry={() => undefined} />);
    expect(screen.getByRole("button", { name: "Retry Vehicle ZZ-0002" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy reference 2e3f4a5b for Vehicle 0198a1b2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Source status for Vehicle 0198a1b2" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SECRETCMD/ })).toBeNull();
    expect(screen.queryByRole("group", { name: /SECRETCMD/ })).toBeNull();
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

  it("keeps focus on the request row when the placeholder row it was on is removed (#633 critic M2)", async () => {
    const REF = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const placeholder: RequestRowView = { ...ACKED, id: "p1", reference: REF };
    const request: RequestRowView = { ...ACKED, id: "r7", reference: REF };
    const { rerender } = render(<RequestList {...base} rows={[placeholder, FAILED]} />);
    const row = screen.getByRole("listitem", { name: placeholder.name });
    act(() => row.focus());
    expect(row).toHaveFocus();
    // The 202 lands: the real row (same reference) takes over and the placeholder leaves.
    rerender(<RequestList {...base} rows={[request, FAILED]} />);
    const successor = screen.getAllByRole("listitem")[0];
    expect(successor).toHaveFocus();
    expect(successor).toHaveAttribute("tabindex", "0");
  });

  it("does not take focus when the removed row did not have it, or no row replaces it", () => {
    const REF = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const { rerender } = render(
      <RequestList {...base} rows={[{ ...ACKED, id: "p1", reference: REF }, FAILED]} />,
    );
    rerender(<RequestList {...base} rows={[{ ...ACKED, id: "r7", reference: REF }, FAILED]} />);
    expect(document.body).toHaveFocus();
    const lone = render(
      <RequestList {...base} rows={[{ ...ACKED, id: "q1", reference: "x-1" }]} />,
    );
    act(() => screen.getAllByRole("listitem").at(-1)?.focus());
    lone.rerender(<RequestList {...base} rows={[FAILED]} />);
    expect(document.body).toHaveFocus();
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

describe("G5 a source line that did not return says why, in words", () => {
  it("shows the reason beside the status, as its own text", () => {
    const row: RequestRowView = {
      ...ACKED,
      notes: [],
      parts: [
        {
          key: "p1",
          lines: [
            {
              key: "p1:state",
              tone: "problem",
              text: "State system: failed",
              why: "the source reported an error",
            },
            { key: "p1:nat", tone: "ok", text: "National system: not run" },
          ],
        },
      ],
    };
    render(<RequestList {...base} rows={[row]} />);
    const line = screen.getByText("State system: failed").closest(".qm-source");
    expect(line).toHaveTextContent(/State system: failed the source reported an error/);
    expect(within(line as HTMLElement).getByText("the source reported an error")).toHaveClass(
      "qm-source__why",
    );
    expect(
      screen.getByText("National system: not run").closest(".qm-source"),
    ).not.toHaveTextContent("reported");
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
    const sources = screen.getByRole("group", { name: "Source status for Vehicle ZZ-0001" });
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
    const sources = screen.getByRole("group", { name: "Source status for Vehicle ZZ-0001" });
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

  it("#587 a source that was not run is its own line in words, with an aria-hidden icon", () => {
    const row: RequestRowView = {
      ...WITH_PARTS,
      parts: [
        {
          key: "c1:1",
          lines: [
            { key: "c1:1:state", tone: "pending", text: "State system: pending" },
            { key: "c1:1:national", tone: "notRun", text: "National system: not run (plate only)" },
          ],
        },
      ],
    };
    render(<RequestList {...base} rows={[row]} />);
    const line = screen.getByText("National system: not run (plate only)").closest(".qm-source");
    expect(line).toHaveClass("qm-source--notRun");
    expect(line?.querySelector(".qm-source__icon")).toHaveAttribute("aria-hidden", "true");
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

describe("FR-060 cards and the severity badge in the list (spec 6.2)", () => {
  const WITH_CARD: RequestRowView = {
    ...ACKED,
    notes: [],
    severityBadge: <span data-testid="badge">Critical</span>,
    parts: [
      {
        key: "c1:1",
        lines: [
          {
            key: "c1:1:state",
            tone: "ok",
            text: "State system: returned",
            card: <section aria-label="State card">card body</section>,
          },
          { key: "c1:1:national", tone: "pending", text: "National system: pending" },
        ],
      },
    ],
  };

  it("a line with a card shows the card in place of its status line", () => {
    render(<RequestList {...base} rows={[WITH_CARD]} />);
    const group = screen.getByRole("group", { name: /Source status/ });
    expect(within(group).getByRole("region", { name: "State card" })).toBeVisible();
    expect(within(group).queryByText("State system: returned")).toBeNull();
    expect(within(group).getByText("National system: pending")).toBeVisible();
  });

  it("the entry header carries the severity badge beside the status", () => {
    render(<RequestList {...base} rows={[WITH_CARD]} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByTestId("badge")).toBeVisible();
  });

  it("a card keeps its place when the line before it changes (stable key)", () => {
    const { rerender } = render(<RequestList {...base} rows={[WITH_CARD]} />);
    const card = screen.getByRole("region", { name: "State card" });
    const first = WITH_CARD.parts?.[0]?.lines[0];
    if (first === undefined) throw new Error("fixture");
    rerender(
      <RequestList
        {...base}
        rows={[
          {
            ...WITH_CARD,
            parts: [
              {
                key: "c1:1",
                lines: [
                  first,
                  { key: "c1:1:national", tone: "ok", text: "National system: returned" },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole("region", { name: "State card" })).toBe(card);
  });
});

describe("UX-015 results keyboard (spec 6.4, 6.6)", () => {
  const row = (id: string, name: string): RequestRowView => ({
    id,
    status: "acknowledged",
    typeLabel: "Vehicle",
    summary: `VEH.${name}`,
    name,
    reference: `${id}-0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`,
    acknowledgedAt: new Date(2026, 8, 29, 13, 4, 5).getTime(),
    notes: [],
  });
  const ROWS = [row("a", "Vehicle A"), row("b", "Vehicle B"), row("c", "Vehicle C")];

  /** A card-like toggle, as the app's result cards render it. */
  function Toggle({ id }: { id: string }) {
    const [open, setOpen] = useState(false);
    return (
      <button
        type="button"
        className="qm-view-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {`toggle ${id}`}
      </button>
    );
  }
  const withToggle = (r: RequestRowView): RequestRowView => ({
    ...r,
    parts: [
      {
        key: `${r.id}:1`,
        lines: [{ key: `${r.id}:1:s`, tone: "ok", text: "ok", card: <Toggle id={r.id} /> }],
      },
    ],
  });

  function setup(rows: readonly RequestRowView[], wrap?: (ui: ReactNode) => ReactNode) {
    const user = userEvent.setup();
    const ui = (list: readonly RequestRowView[]) => (
      <ShortcutProvider bindings={resolveShortcuts()}>
        {wrap ? wrap(<RequestList {...base} rows={list} />) : <RequestList {...base} rows={list} />}
      </ShortcutProvider>
    );
    const view = render(ui(rows));
    return { user, rerender: (next: readonly RequestRowView[]) => view.rerender(ui(next)) };
  }
  const item = (name: string) => screen.getByRole("listitem", { name });
  const rowsEl = () => screen.getAllByRole("listitem");

  it("the list is the results context and has one tab stop: the first row", () => {
    setup(ROWS);
    expect(screen.getByRole("region", { name: "Requests this shift" })).toHaveAttribute(
      "data-shortcut-context",
      "results",
    );
    expect(rowsEl().map((el) => el.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("ArrowDown and ArrowUp move focus and the tab stop, and stop at the ends", async () => {
    const { user } = setup(ROWS);
    await user.tab();
    expect(rowsEl()[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(rowsEl()[1]).toHaveFocus();
    expect(rowsEl().map((el) => el.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(rowsEl()[2]).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(rowsEl()[0]).toHaveFocus();
  });

  it("selection is tracked by id: a new row on top moves neither focus nor the selection", async () => {
    const { user, rerender } = setup(ROWS);
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(rowsEl()[1]).toHaveFocus();
    act(() => rerender([row("z", "Vehicle Z"), ...ROWS]));
    const focused = document.activeElement as HTMLElement;
    expect(focused).toHaveTextContent("VEH.Vehicle B");
    expect(rowsEl().map((el) => el.getAttribute("tabindex"))).toEqual(["-1", "-1", "0", "-1"]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("VEH.Vehicle C");
  });

  it("a selected row that leaves the list hands the tab stop to the first row", async () => {
    const { user, rerender } = setup(ROWS);
    await user.tab();
    await user.keyboard("{ArrowDown}");
    act(() => rerender([ROWS[0] as RequestRowView, ROWS[2] as RequestRowView]));
    expect(rowsEl().map((el) => el.getAttribute("tabindex"))).toEqual(["0", "-1"]);
  });

  it("Enter on a row toggles the detail of the cards in the selected row only", async () => {
    const { user } = setup(ROWS.map(withToggle));
    await user.tab();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "toggle b" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "toggle a" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(rowsEl()[1]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "toggle b" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("Enter with no card in the row does nothing", async () => {
    const { user } = setup(ROWS);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(rowsEl()[0]).toHaveFocus();
  });

  it("focus moved into a row's button selects that row", async () => {
    const { user } = setup(ROWS.map(withToggle));
    act(() => screen.getByRole("button", { name: "toggle c" }).focus());
    expect(rowsEl().map((el) => el.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
    await user.keyboard("{ArrowUp}");
    expect(rowsEl()[1]).toHaveFocus();
  });

  it("Delete is not bound here (M3)", async () => {
    const { user } = setup(ROWS);
    await user.tab();
    await user.keyboard("{Delete}");
    expect(rowsEl()).toHaveLength(3);
  });

  it("a row is named by the request", () => {
    setup(ROWS);
    expect(item("Vehicle A")).toBeInTheDocument();
  });
});

describe("edit as new query on a row that cannot be retried (#477)", () => {
  const EDITABLE: RequestRowView = { ...FAILED, editable: true };

  it("an editable failed row has the action, named by the row, and calls onEditAsNew with the row", async () => {
    const user = userEvent.setup();
    const onEditAsNew = vi.fn();
    render(<RequestList {...base} rows={[EDITABLE]} onEditAsNew={onEditAsNew} />);
    const button = screen.getByRole("button", { name: "Edit as new query: Vehicle ZZ-0002" });
    expect(button).toHaveTextContent("Edit as new query");
    await user.click(button);
    expect(onEditAsNew).toHaveBeenCalledWith("r0");
  });

  it("it is reachable by keyboard and Enter activates it", async () => {
    const user = userEvent.setup();
    const onEditAsNew = vi.fn();
    render(<RequestList {...base} rows={[EDITABLE]} onEditAsNew={onEditAsNew} />);
    await user.tab(); // the row
    await user.tab(); // its action
    expect(screen.getByRole("button", { name: /^Edit as new query/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onEditAsNew).toHaveBeenCalledWith("r0");
  });

  it("no action on a row that is not editable, sending, acknowledged, or when there is no handler", () => {
    const { rerender } = render(
      <RequestList {...base} rows={[FAILED, SENDING, ACKED]} onEditAsNew={() => undefined} />,
    );
    expect(screen.queryByRole("button", { name: /Edit as new query/ })).toBeNull();
    rerender(<RequestList {...base} rows={[EDITABLE]} />);
    expect(screen.queryByRole("button", { name: /Edit as new query/ })).toBeNull();
  });

  it("does not move focus by itself", () => {
    render(<RequestList {...base} rows={[EDITABLE]} onEditAsNew={() => undefined} />);
    expect(document.body).toHaveFocus();
  });
});
