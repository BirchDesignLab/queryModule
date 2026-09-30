import { describe, expect, it } from "vitest";
import { humanize } from "./controls.js";

describe("A3 humanize: a config key as words for the generic form", () => {
  it("splits camel case, acronyms, underscores and dashes, and capitalizes the first word", () => {
    expect(humanize("maxDurationMinutes", (n) => `Item ${n}`)).toBe("Max duration minutes");
    expect(humanize("URLPath", (n) => `Item ${n}`)).toBe("Url path");
    expect(humanize("role_claim-name", (n) => `Item ${n}`)).toBe("Role claim name");
  });

  it("an index is a one-based item in the translated word order", () => {
    expect(humanize(1, (n) => `Item ${n}`)).toBe("Item 2");
    expect(humanize(0, (n) => `#${n} item`)).toBe("#1 item");
  });
});
