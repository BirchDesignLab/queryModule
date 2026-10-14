import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { midSentence, sourceWhy } from "./result-view.js";

const t = (key: string, params?: Record<string, string | number | boolean>) =>
  `${key}${params === undefined ? "" : JSON.stringify(params)}`;

describe("G33 a field label inside a sentence", () => {
  it("lowercases a title-case label and keeps an acronym", () => {
    expect(midSentence("Last name")).toBe("last name");
    expect(midSentence("Date of birth")).toBe("date of birth");
    expect(midSentence("VIN")).toBe("VIN");
    expect(midSentence("")).toBe("");
  });
});

describe("G5 why a source did not return", () => {
  it("has a reason for every problem status and none for pending or returned", () => {
    for (const status of ["failed", "interrupted", "credentialsMissing", "credentialsRejected"]) {
      expect(sourceWhy(status, CLIENT_CONFIG, "stateSource", t)).toBe(`sourceStatus.why.${status}`);
    }
    expect(sourceWhy("pending", CLIENT_CONFIG, "stateSource", t)).toBeUndefined();
    expect(sourceWhy("returned", CLIENT_CONFIG, "stateSource", t)).toBeUndefined();
  });

  it("says the source's own limit for a timeout, and a plain sentence when the source is unlisted", () => {
    expect(sourceWhy("timedOut", CLIENT_CONFIG, "stateSource", t)).toContain('"seconds":10');
    expect(sourceWhy("timedOut", CLIENT_CONFIG, "gone", t)).toBe(
      "sourceStatus.why.timedOutNoLimit",
    );
  });
});
