import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AckStatus } from "./AckStatus.js";

const LABELS: Record<string, string> = {
  "submit.sentHeading": "Last query",
  "submit.reference": "Reference",
  "submit.copyReference": "Copy reference",
  "submit.partSkipped": "{queryType} was not run: {reason}",
  "submit.partNotRun": "{queryType} was not run.",
};
const t = (key: string, params?: Readonly<Record<string, string | number | boolean>>) =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    LABELS[key] ?? key,
  );

const ACK = {
  queryTypeLabel: "Vehicle",
  correlationId: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  acknowledgedAt: new Date(2026, 8, 29, 13, 4, 5).getTime(),
  skipped: [{ queryTypeLabel: "Person", reasonText: "no sources" }],
};

describe("FR-064 acknowledgment status (spec 6.2)", () => {
  it("renders nothing without an acknowledgment", () => {
    const { container } = render(<AckStatus ack={null} onCopy={() => {}} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a labelled section with the type, local MM-DD-YY time and the full reference", () => {
    render(<AckStatus ack={ACK} onCopy={() => {}} t={t} />);
    const section = screen.getByRole("region", { name: "Last query" });
    expect(section).toHaveTextContent("Vehicle");
    expect(section).toHaveTextContent("09-29-26 13:04:05");
    expect(section.querySelector("code")).toHaveTextContent(ACK.correlationId);
    expect(section).not.toHaveAttribute("aria-live");
    expect(section).not.toHaveAttribute("role", "alert");
  });

  it("lists one line per skipped part", () => {
    render(<AckStatus ack={ACK} onCopy={() => {}} t={t} />);
    expect(screen.getByText("Person was not run: no sources")).toBeInTheDocument();
  });

  it("#382 A1 a skipped part with no reason says only that it was not run", () => {
    render(
      <AckStatus
        ack={{ ...ACK, skipped: [{ queryTypeLabel: "Person", reasonText: null }] }}
        onCopy={() => {}}
        t={t}
      />,
    );
    expect(screen.getByText("Person was not run.")).toBeInTheDocument();
  });

  it("Copy reference hands the correlation ID to onCopy", async () => {
    const onCopy = vi.fn();
    render(<AckStatus ack={ACK} onCopy={onCopy} t={t} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(onCopy).toHaveBeenCalledWith(ACK.correlationId);
  });
});
