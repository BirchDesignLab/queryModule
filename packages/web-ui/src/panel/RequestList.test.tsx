import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatAckTime, RequestList, type RequestRowView } from "./RequestList.js";

const LABELS: Record<string, string> = {
  "requests.status.sending": "Sending",
  "requests.status.acknowledged": "Acknowledged",
  "requests.status.failed": "Failed",
  "requests.sentAt": "Sent {time}",
  "submit.reference": "Reference",
  "requests.copyReferenceOf": "Copy reference for {summary}",
  "submit.copyReference": "Copy reference",
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
    const button = screen.getByRole("button", { name: "Copy reference for VEH.ZZ-0001.TX" });
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

  it("formatAckTime is MM-DD-YY HH:mm:ss in local time (spec 6.2)", () => {
    expect(formatAckTime(new Date(2026, 8, 29, 13, 4, 5).getTime())).toBe("09-29-26 13:04:05");
  });
});
