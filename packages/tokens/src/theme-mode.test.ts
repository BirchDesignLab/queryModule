import { describe, expect, it } from "vitest";
import { resolveThemeMode, type ThemeModeInput } from "./theme-mode";

const base: ThemeModeInput = {
  preference: null,
  selection: null,
  osPrefersDark: false,
  localHour: 12,
};

describe("UX-002 theme mode selection (spec 6.5)", () => {
  it.each([
    ["explicit day wins over dark OS", { preference: "day", osPrefersDark: true }, "day"],
    ["explicit redShift", { preference: "redShift" }, "redShift"],
    ["no preference, no site theme, light OS", {}, "day"],
    ["no preference, no site theme, dark OS", { osPrefersDark: true }, "night"],
    ["auto, no site theme, dark OS", { preference: "auto", osPrefersDark: true }, "night"],
    [
      "no preference, site default night",
      { selection: { defaultMode: "night", auto: "os" } },
      "night",
    ],
    [
      "auto os, dark OS",
      { preference: "auto", selection: { defaultMode: "day", auto: "os" }, osPrefersDark: true },
      "night",
    ],
    [
      "auto os, light OS",
      { preference: "auto", selection: { defaultMode: "night", auto: "os" } },
      "day",
    ],
    [
      "auto time, 19:00",
      { preference: "auto", selection: { defaultMode: "day", auto: "time" }, localHour: 19 },
      "night",
    ],
    [
      "auto time, 06:00",
      { preference: "auto", selection: { defaultMode: "day", auto: "time" }, localHour: 6 },
      "night",
    ],
    [
      "auto time, 07:00",
      { preference: "auto", selection: { defaultMode: "night", auto: "time" }, localHour: 7 },
      "day",
    ],
    [
      "auto off falls back to default",
      { preference: "auto", selection: { defaultMode: "redShift", auto: "off" } },
      "redShift",
    ],
    ["auto, no site theme, light OS", { preference: "auto" }, "day"],
    [
      "auto time, 18:00",
      { preference: "auto", selection: { defaultMode: "night", auto: "time" }, localHour: 18 },
      "day",
    ],
    [
      "auto time, 23:00",
      { preference: "auto", selection: { defaultMode: "day", auto: "time" }, localHour: 23 },
      "night",
    ],
    [
      "auto time, 00:00",
      { preference: "auto", selection: { defaultMode: "day", auto: "time" }, localHour: 0 },
      "night",
    ],
  ] as const)("%s", (_name, patch, expected) => {
    expect(resolveThemeMode({ ...base, ...patch })).toBe(expected);
  });
});
