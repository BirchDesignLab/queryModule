import { describe, expect, it } from "vitest";
import { FEATURES } from "./features";
import {
  DEFAULT_SHORTCUTS,
  isValidShortcutKeys,
  resolveShortcuts,
  SHORTCUT_ACTIONS,
  strokesCollide,
  usLayoutChar,
} from "./shortcuts";

describe("FEATURES catalogue (spec 5.8)", () => {
  it("is the closed list", () => {
    expect([...FEATURES]).toEqual(["credentials", "delegation", "resultHide", "adminAudit"]);
  });
});

describe("FR-006 FR-007 FR-053 shortcut catalogue (spec 6.4)", () => {
  it("defines a default binding for every action", () => {
    expect(Object.keys(DEFAULT_SHORTCUTS).sort()).toEqual([...SHORTCUT_ACTIONS].sort());
    expect(DEFAULT_SHORTCUTS.focusTerminal).toEqual({ keys: "Slash", context: "global" });
    expect(DEFAULT_SHORTCUTS.quickType9).toEqual({ keys: "Alt+Digit9", context: "global" });
    expect(DEFAULT_SHORTCUTS.goResults).toEqual({ keys: "KeyG KeyR", context: "global" });
  });

  it("validates stroke syntax", () => {
    expect(isValidShortcutKeys("Ctrl+Alt+Shift+KeyA")).toBe(true);
    expect(isValidShortcutKeys("KeyG KeyR")).toBe(true);
    expect(isValidShortcutKeys("ctrl+x")).toBe(false);
    expect(isValidShortcutKeys("Alt+Ctrl+KeyA")).toBe(false);
    expect(isValidShortcutKeys("KeyG  KeyR")).toBe(false);
    expect(isValidShortcutKeys("")).toBe(false);
  });

  it("detects equal and prefix sequences", () => {
    expect(strokesCollide("KeyG", "KeyG KeyR")).toBe(true);
    expect(strokesCollide("Ctrl+Enter", "Ctrl+Enter")).toBe(true);
    expect(strokesCollide("KeyG KeyQ", "KeyG KeyR")).toBe(false);
    expect(strokesCollide("Slash", "Shift+Slash")).toBe(false);
  });

  it("resolves single-key strokes to US-layout characters", () => {
    expect(usLayoutChar("Slash")).toBe("/");
    expect(usLayoutChar("Shift+Slash")).toBe("?");
    expect(usLayoutChar("Period")).toBe(".");
    expect(usLayoutChar("KeyA")).toBe("a");
    expect(usLayoutChar("Shift+KeyA")).toBe("A");
    expect(usLayoutChar("Digit1")).toBe("1");
    expect(usLayoutChar("Shift+Digit1")).toBe("!");
    expect(usLayoutChar("Ctrl+Slash")).toBeNull();
    expect(usLayoutChar("KeyG KeyR")).toBeNull();
    expect(usLayoutChar("Escape")).toBeNull();
  });

  it("override replaces the default binding per action", () => {
    const resolved = resolveShortcuts({ focusTerminal: { keys: "Ctrl+Slash", context: "global" } });
    expect(resolved.focusTerminal).toEqual([{ keys: "Ctrl+Slash", context: "global" }]);
    expect(resolved.submit).toEqual([{ keys: "Ctrl+Enter", context: "panel" }]);
  });

  it("the default map has no collisions", () => {
    const all = Object.entries(resolveShortcuts()).flatMap(([action, bs]) =>
      bs.map((b) => ({ action, ...b })),
    );
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (!a || !b) continue;
        const shared = a.context === b.context || a.context === "global" || b.context === "global";
        expect(shared && strokesCollide(a.keys, b.keys), `${a.action} vs ${b.action}`).toBe(false);
      }
    }
  });
});
