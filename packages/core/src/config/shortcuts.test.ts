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

describe("fix round 1: I1 stroke allowlist (spec 4.1, 6.4)", () => {
  it("rejects non-code strokes and modifier misuse", () => {
    expect(isValidShortcutKeys("A")).toBe(false);
    expect(isValidShortcutKeys("ShiftKeyA")).toBe(false);
    expect(isValidShortcutKeys("Ctrlx")).toBe(false);
    expect(isValidShortcutKeys("Shift+ShiftLeft")).toBe(false);
    expect(isValidShortcutKeys("Meta+KeyA")).toBe(false);
    expect(isValidShortcutKeys("Shift+Ctrl+KeyA")).toBe(false);
    expect(isValidShortcutKeys("KeyG  KeyR")).toBe(false);
    expect(isValidShortcutKeys("KeyG ")).toBe(false);
  });

  it("accepts representative codes from every allowlisted family and multi-stroke chords", () => {
    expect(isValidShortcutKeys("KeyA")).toBe(true);
    expect(isValidShortcutKeys("Digit5")).toBe(true);
    expect(isValidShortcutKeys("IntlBackslash")).toBe(true);
    expect(isValidShortcutKeys("IntlRo")).toBe(true);
    expect(isValidShortcutKeys("IntlYen")).toBe(true);
    expect(isValidShortcutKeys("Space")).toBe(true);
    expect(isValidShortcutKeys("ContextMenu")).toBe(true);
    expect(isValidShortcutKeys("PageUp")).toBe(true);
    expect(isValidShortcutKeys("ArrowLeft")).toBe(true);
    expect(isValidShortcutKeys("Escape")).toBe(true);
    expect(isValidShortcutKeys("F1")).toBe(true);
    expect(isValidShortcutKeys("F24")).toBe(true);
    expect(isValidShortcutKeys("Numpad5")).toBe(true);
    expect(isValidShortcutKeys("NumpadEnter")).toBe(true);
    expect(isValidShortcutKeys("KeyG KeyQ")).toBe(true);
  });

  it("every DEFAULT_SHORTCUTS entry still validates", () => {
    for (const binding of Object.values(DEFAULT_SHORTCUTS)) {
      expect(isValidShortcutKeys(binding.keys)).toBe(true);
    }
  });
});

describe("fix round 1: I2 immutable defaults", () => {
  it("freezes DEFAULT_SHORTCUTS and its bindings", () => {
    expect(Object.isFrozen(DEFAULT_SHORTCUTS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SHORTCUTS.focusTerminal)).toBe(true);
    expect(() => {
      (DEFAULT_SHORTCUTS.focusTerminal as { keys: string }).keys = "MUTATED";
    }).toThrow();
  });

  it("returns fresh binding objects, isolated from DEFAULT_SHORTCUTS and other calls", () => {
    const originalKeys = DEFAULT_SHORTCUTS.focusTerminal.keys;
    const first = resolveShortcuts();
    const binding = first.focusTerminal?.[0];
    expect(binding).toBeDefined();
    if (binding) binding.keys = "MUTATED";
    expect(DEFAULT_SHORTCUTS.focusTerminal.keys).toBe(originalKeys);
    const second = resolveShortcuts();
    expect(second.focusTerminal?.[0]?.keys).toBe(originalKeys);
  });

  it("does not let a mutated caller override object change the returned result", () => {
    const override = { focusTerminal: { keys: "Ctrl+Slash", context: "global" as const } };
    const resolved = resolveShortcuts(override);
    override.focusTerminal.keys = "MUTATED";
    expect(resolved.focusTerminal?.[0]?.keys).toBe("Ctrl+Slash");
  });
});

describe("fix round 1: I3 override branch coverage", () => {
  it("keeps a single-binding override as one binding", () => {
    const resolved = resolveShortcuts({ submit: { keys: "Ctrl+KeyS", context: "panel" } });
    expect(resolved.submit).toEqual([{ keys: "Ctrl+KeyS", context: "panel" }]);
  });

  it("keeps an array override's bindings in order", () => {
    const resolved = resolveShortcuts({
      goPanel: [
        { keys: "KeyG KeyQ", context: "global" },
        { keys: "F2", context: "global" },
      ],
    });
    expect(resolved.goPanel).toEqual([
      { keys: "KeyG KeyQ", context: "global" },
      { keys: "F2", context: "global" },
    ]);
  });
});
