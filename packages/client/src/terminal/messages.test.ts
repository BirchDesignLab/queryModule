import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTranslator, type LocaleBundle } from "../i18n/translator.js";
import { terminalErrorText } from "./messages.js";

const en: LocaleBundle = JSON.parse(
  readFileSync(new URL("../../../config/locales/en.json", import.meta.url), "utf8"),
);
const { t } = createTranslator("en", en);
const dot = { t, delimiter: "." };

describe("FR-055 terminal error text resolves the label (#297 item 2)", () => {
  it("terminal.delimiterInValue names the label from labelKey", () => {
    const text = terminalErrorText(
      {
        key: "terminal.delimiterInValue",
        params: { field: "plate", labelKey: "field.plate", position: 1 },
      },
      dot,
    );
    expect(text).toContain("Plate cannot be written in a command position");
    expect(text).not.toContain("{label}");
  });

  it("falls back to the field key when there is no labelKey", () => {
    const text = terminalErrorText(
      { key: "terminal.delimiterInValue", params: { field: "plate", position: 1 } },
      dot,
    );
    expect(text.startsWith("plate cannot be written")).toBe(true);
  });

  it("validation.required names the field's label", () => {
    expect(
      terminalErrorText(
        { key: "validation.required", params: { field: "plateType", labelKey: "field.plateType" } },
        dot,
      ),
    ).toBe("Plate type is required.");
  });
});

describe("FR-055 terminal error text resolves the site delimiter", () => {
  const missing = { key: "terminal.missingDelimiter", params: { length: 5 } };
  it("uses the default site delimiter", () => {
    expect(terminalErrorText(missing, dot)).toBe("Separate the command and its values with ..");
  });
  it("uses another site's delimiter from the option (example-ok)", () => {
    expect(terminalErrorText(missing, { t, delimiter: "/" })).toBe(
      "Separate the command and its values with /.",
    );
  });
  it("never takes the delimiter from the error params", () => {
    const spoofed = { key: "terminal.missingDelimiter", params: { length: 5, delimiter: "#" } };
    expect(terminalErrorText(spoofed, { t, delimiter: "/" })).toContain("with /.");
  });
});

describe("FR-055 other terminal and unknown keys", () => {
  it("terminal.unknownCommand shows the typed code", () => {
    expect(
      terminalErrorText({ key: "terminal.unknownCommand", params: { code: "XYZ" } }, dot),
    ).toBe("Unrecognized command XYZ.");
  });
  it("an error without params renders", () => {
    expect(terminalErrorText({ key: "terminal.emptyInput" }, dot)).toBe("Type a command.");
  });
  it("an unknown key renders through t unchanged", () => {
    expect(terminalErrorText({ key: "terminal.notAKey", params: { field: "plate" } }, dot)).toBe(
      "terminal.notAKey",
    );
  });
});
