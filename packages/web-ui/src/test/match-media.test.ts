import { afterEach, describe, expect, it } from "vitest";
import { installMatchMedia } from "./match-media";

describe("installMatchMedia", () => {
  afterEach(() => {
    installMatchMedia();
  });

  it("reports the initial match state for a query", () => {
    installMatchMedia({ "(prefers-color-scheme: dark)": true });
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
  });

  it("defaults an unlisted query to not matching", () => {
    installMatchMedia();
    expect(window.matchMedia("(min-width: 999px)").matches).toBe(false);
  });

  it("records every query() call in order", () => {
    const controller = installMatchMedia();
    window.matchMedia("(min-width: 640px)");
    window.matchMedia("(min-width: 1024px)");
    expect(controller.queries).toEqual(["(min-width: 640px)", "(min-width: 1024px)"]);
  });

  it("notifies a subscribed listener when set() flips the query", () => {
    const controller = installMatchMedia({ "(min-width: 640px)": false });
    const mql = window.matchMedia("(min-width: 640px)");
    let notified = false;
    mql.addEventListener("change", () => {
      notified = true;
    });
    controller.set("(min-width: 640px)", true);
    expect(mql.matches).toBe(true);
    expect(notified).toBe(true);
  });
});
