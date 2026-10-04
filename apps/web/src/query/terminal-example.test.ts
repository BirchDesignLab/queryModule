import { createTranslator } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { terminalExample } from "./terminal-example.js";

const t = createTranslator("en", EN_BUNDLE).t;

describe("#382 W4 the terminal's example command comes from the site config (FR-051, FR-052)", () => {
  it("is the first command with its first two positions, named by their labels", () => {
    expect(terminalExample(CLIENT_CONFIG, t)).toBe("VEH.Plate.State");
  });

  it("follows the site's delimiter", () => {
    const config: ClientSiteConfig = {
      ...CLIENT_CONFIG,
      terminal: { ...CLIENT_CONFIG.terminal, delimiter: "/" },
    };
    expect(terminalExample(config, t)).toBe("VEH/Plate/State");
  });

  it("follows the site's command order and positions", () => {
    const per = CLIENT_CONFIG.commands.find((c) => c.code === "NAM");
    if (per === undefined) throw new Error("fixture: NAM missing");
    const config: ClientSiteConfig = {
      ...CLIENT_CONFIG,
      commands: [{ ...per, positions: ["last", "first", "dob"] }],
    };
    expect(terminalExample(config, t)).toBe("NAM.Last name.First name");
  });

  it("names a rest position by its field too, and shows a one-position command as is", () => {
    const pro = CLIENT_CONFIG.commands.find((c) => c.code === "PRO");
    if (pro === undefined) throw new Error("fixture: PRO missing");
    const config: ClientSiteConfig = {
      ...CLIENT_CONFIG,
      commands: [{ ...pro, positions: [{ field: "description", rest: true }] }],
    };
    expect(terminalExample(config, t)).toBe("PRO.Description");
  });

  it("shows a translated label as it is, with no case change (Q4: the case rules are the locale's)", () => {
    // A label in a language whose case mapping toLowerCase() gets wrong (Turkish dotted capital I).
    const plate = CLIENT_CONFIG.queryTypes
      .find((q) => q.code === "VEH")
      ?.fields.find((f) => f.key === "plate");
    if (plate === undefined) throw new Error("fixture: VEH plate missing");
    const turkish = (key: string): string => (key === plate.labelKey ? "İSTASYON" : t(key));
    expect(terminalExample(CLIENT_CONFIG, turkish)).toBe("VEH.İSTASYON.State");
  });

  it("is null for a site with no commands", () => {
    expect(terminalExample({ ...CLIENT_CONFIG, commands: [] }, t)).toBeNull();
  });
});
