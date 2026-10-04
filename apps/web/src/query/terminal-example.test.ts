import { createTranslator } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { terminalExample } from "./terminal-example.js";

const t = createTranslator("en", EN_BUNDLE).t;

describe("#382 W4 the terminal's example command comes from the site config (FR-051, FR-052)", () => {
  it("is the first command with its first two positions, named by their labels", () => {
    expect(terminalExample(CLIENT_CONFIG, t)).toBe("VEH.plate.state");
  });

  it("follows the site's delimiter", () => {
    const config: ClientSiteConfig = {
      ...CLIENT_CONFIG,
      terminal: { ...CLIENT_CONFIG.terminal, delimiter: "/" },
    };
    expect(terminalExample(config, t)).toBe("VEH/plate/state");
  });

  it("follows the site's command order and positions", () => {
    const per = CLIENT_CONFIG.commands.find((c) => c.code === "NAM");
    if (per === undefined) throw new Error("fixture: NAM missing");
    const config: ClientSiteConfig = {
      ...CLIENT_CONFIG,
      commands: [{ ...per, positions: ["last", "first", "dob"] }],
    };
    expect(terminalExample(config, t)).toBe("NAM.last name.first name");
  });

  it("names a rest position by its field too, and shows a one-position command as is", () => {
    const pro = CLIENT_CONFIG.commands.find((c) => c.code === "PRO");
    if (pro === undefined) throw new Error("fixture: PRO missing");
    const config: ClientSiteConfig = {
      ...CLIENT_CONFIG,
      commands: [{ ...pro, positions: [{ field: "description", rest: true }] }],
    };
    expect(terminalExample(config, t)).toBe("PRO.description");
  });

  it("is null for a site with no commands", () => {
    expect(terminalExample({ ...CLIENT_CONFIG, commands: [] }, t)).toBeNull();
  });
});
