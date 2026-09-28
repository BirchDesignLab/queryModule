import { createAnnouncer } from "@querymodule/client";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveAnnouncer } from "./LiveAnnouncer.js";

describe("FR-005 live regions present from first render (spec 6.6)", () => {
  it("renders an empty polite status and assertive alert", () => {
    render(<LiveAnnouncer announcer={createAnnouncer()} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });
  it("shows polite and assertive messages in their own region and clears", () => {
    const announcer = createAnnouncer();
    render(<LiveAnnouncer announcer={announcer} />);
    act(() => {
      announcer.announce("2 fields need attention");
      announcer.announce("critical hit", "assertive");
    });
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("2 fields need attention");
    expect(screen.getByTestId("announcer-assertive")).toHaveTextContent("critical hit");
    act(() => announcer.clear());
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("");
  });
  it("a repeated message changes the DOM so it is announced again", () => {
    const announcer = createAnnouncer();
    render(<LiveAnnouncer announcer={announcer} />);
    act(() => {
      announcer.announce("same");
    });
    const first = screen.getByTestId("announcer-polite").textContent;
    act(() => {
      announcer.announce("same");
    });
    expect(screen.getByTestId("announcer-polite").textContent).not.toBe(first);
  });
});
