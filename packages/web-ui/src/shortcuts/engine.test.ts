import { EDITING_COMBOS as CORE_EDITING_COMBOS, resolveShortcuts } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { createShortcutEngine, EDITING_COMBOS, strokeOf } from "./engine";

const outside = { inTextInput: false, contexts: ["global", "panel"] } as const;
const inInput = { inTextInput: true, contexts: ["global", "panel"] } as const;
const e = () => createShortcutEngine(resolveShortcuts());
const k = (
  code: string,
  m: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {},
) => strokeOf({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m });

describe("FR-007 single keys, combos and chords (spec 6.4)", () => {
  it("strokeOf orders modifiers and drops Meta", () => {
    expect(k("KeyG")).toBe("KeyG");
    expect(k("Enter", { ctrlKey: true })).toBe("Ctrl+Enter");
    expect(k("Digit2", { altKey: true, shiftKey: true, ctrlKey: true })).toBe(
      "Ctrl+Alt+Shift+Digit2",
    );
    expect(k("KeyK", { metaKey: true })).toBeNull();
  });
  it("strokeOf returns null for modifier-only and unknown codes", () => {
    expect(k("ShiftLeft", { shiftKey: true })).toBeNull();
    expect(k("Unidentified")).toBeNull();
  });
  it("EDITING_COMBOS lists Ctrl+A, C, V, X, Z, Y and the shifted redo and paste-plain forms", () => {
    expect([...EDITING_COMBOS].sort()).toEqual(
      [
        "Ctrl+KeyA",
        "Ctrl+KeyC",
        "Ctrl+KeyV",
        "Ctrl+KeyX",
        "Ctrl+KeyY",
        "Ctrl+KeyZ",
        "Ctrl+Shift+KeyV",
        "Ctrl+Shift+KeyZ",
      ].sort(),
    );
  });
  it("the engine's editing set is the core one (single source)", () => {
    expect(EDITING_COMBOS).toBe(CORE_EDITING_COMBOS);
  });
  it("Slash focuses the terminal outside inputs and is inert inside them", () => {
    expect(e().handle(k("Slash"), outside, 0)).toEqual({ kind: "action", action: "focusTerminal" });
    expect(e().handle(k("Slash"), inInput, 0)).toEqual({ kind: "none" });
  });
  it("Shift+Slash is a single key too, inert in inputs", () => {
    expect(e().handle(k("Slash", { shiftKey: true }), outside, 0)).toEqual({
      kind: "action",
      action: "shortcutSheet",
    });
    expect(e().handle(k("Slash", { shiftKey: true }), inInput, 0)).toEqual({ kind: "none" });
  });
  it("Ctrl+Enter submits from inside a field (panel context)", () => {
    expect(e().handle(k("Enter", { ctrlKey: true }), inInput, 0)).toEqual({
      kind: "action",
      action: "submit",
    });
  });
  it("Alt+Digit2 selects the second quick-access type", () => {
    expect(e().handle(k("Digit2", { altKey: true }), inInput, 0)).toEqual({
      kind: "action",
      action: "quickType2",
    });
  });
  it("KeyG KeyR is a chord within 1000 ms", () => {
    const en = e();
    expect(en.handle(k("KeyG"), outside, 0)).toEqual({ kind: "pending" });
    expect(en.handle(k("KeyR"), outside, 999)).toEqual({ kind: "action", action: "goResults" });
    expect(en.handle(k("KeyG"), outside, 2000)).toEqual({ kind: "pending" });
    expect(en.handle(k("KeyR"), outside, 3001)).toEqual({ kind: "none" });
  });
  it("an expired chord's next stroke starts fresh", () => {
    const en = e();
    expect(en.handle(k("KeyG"), outside, 0)).toEqual({ kind: "pending" });
    expect(en.handle(k("KeyG"), outside, 1500)).toEqual({ kind: "pending" });
    expect(en.handle(k("KeyQ"), outside, 1600)).toEqual({ kind: "action", action: "goPanel" });
  });
  it("a stroke that breaks a chord is not swallowed when it binds on its own", () => {
    const en = e();
    expect(en.handle(k("KeyG"), outside, 0)).toEqual({ kind: "pending" });
    expect(en.handle(k("Slash"), outside, 10)).toEqual({ kind: "action", action: "focusTerminal" });
    expect(en.handle(k("KeyR"), outside, 20)).toEqual({ kind: "none" });
  });
  it("reset clears a pending chord", () => {
    const en = e();
    en.handle(k("KeyG"), outside, 0);
    en.reset();
    expect(en.handle(k("KeyR"), outside, 10)).toEqual({ kind: "none" });
  });
  it("a null stroke is ignored and keeps the pending chord", () => {
    const en = e();
    en.handle(k("KeyG"), outside, 0);
    expect(en.handle(null, outside, 5)).toEqual({ kind: "none" });
    expect(en.handle(k("KeyR"), outside, 10)).toEqual({ kind: "action", action: "goResults" });
  });
  it("chords starting with a single key are inert in text inputs", () => {
    expect(e().handle(k("KeyG"), inInput, 0)).toEqual({ kind: "none" });
  });
  it("a chord pending outside does not complete once focus is in a text input", () => {
    const en = e();
    en.handle(k("KeyG"), outside, 0);
    expect(en.handle(k("KeyR"), inInput, 10)).toEqual({ kind: "none" });
  });
  it("results-context bindings need the results region", () => {
    expect(e().handle(k("ArrowDown"), outside, 0)).toEqual({ kind: "none" });
    expect(
      e().handle(k("ArrowDown"), { inTextInput: false, contexts: ["global", "results"] }, 0),
    ).toEqual({ kind: "action", action: "selectNext" });
  });
  it("editing combos never fire, even if bound", () => {
    const en = createShortcutEngine(
      resolveShortcuts({ submit: { keys: "Ctrl+KeyC", context: "global" } }),
    );
    expect(en.handle(k("KeyC", { ctrlKey: true }), outside, 0)).toEqual({ kind: "none" });
  });
  it("a site override replaces the default binding (focusTerminal on Ctrl+Slash)", () => {
    const en = createShortcutEngine(
      resolveShortcuts({ focusTerminal: { keys: "Ctrl+Slash", context: "global" } }),
    );
    expect(en.handle(k("Slash"), outside, 0)).toEqual({ kind: "none" });
    expect(en.handle(k("Slash", { ctrlKey: true }), inInput, 0)).toEqual({
      kind: "action",
      action: "focusTerminal",
    });
  });
});

describe("FR-007 engine edges (#313)", () => {
  it("Ctrl+Shift+KeyZ and Ctrl+Shift+KeyV never fire, even if bound", () => {
    for (const code of ["KeyZ", "KeyV"]) {
      const en = createShortcutEngine(
        resolveShortcuts({ submit: { keys: `Ctrl+Shift+${code}`, context: "global" } }),
      );
      expect(en.handle(k(code, { ctrlKey: true, shiftKey: true }), outside, 0)).toEqual({
        kind: "none",
      });
    }
  });

  it("an AltGr keystroke (Ctrl+Alt plus AltGraph) is not a Ctrl+Alt combo", () => {
    const altGr = (state: boolean) =>
      strokeOf({
        code: "Digit2",
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        getModifierState: (key: string) => key === "AltGraph" && state,
      });
    expect(altGr(true)).toBeNull();
    expect(altGr(false)).toBe("Ctrl+Alt+Digit2");
  });

  it("chord timeout boundary: fires at 999 ms, times out at exactly 1000 ms", () => {
    const at999 = e();
    at999.handle(k("KeyG"), outside, 0);
    expect(at999.handle(k("KeyR"), outside, 999)).toEqual({ kind: "action", action: "goResults" });
    const at1000 = e();
    at1000.handle(k("KeyG"), outside, 0);
    expect(at1000.handle(k("KeyR"), outside, 1000)).toEqual({ kind: "none" });
  });

  it("a combo-first chord started inside a text input completes with a combo stroke", () => {
    const en = createShortcutEngine({
      submit: [{ keys: "Ctrl+KeyK Ctrl+KeyJ", context: "global" }],
      dismiss: [{ keys: "Ctrl+KeyK KeyX", context: "global" }],
    });
    expect(en.handle(k("KeyK", { ctrlKey: true }), inInput, 0)).toEqual({ kind: "pending" });
    expect(en.handle(k("KeyJ", { ctrlKey: true }), inInput, 10)).toEqual({
      kind: "action",
      action: "submit",
    });
    // A single-key second stroke is typing inside an input: inert, and it drops the chord.
    expect(en.handle(k("KeyK", { ctrlKey: true }), inInput, 20)).toEqual({ kind: "pending" });
    expect(en.handle(k("KeyX"), inInput, 30)).toEqual({ kind: "none" });
  });

  it("the shared none result cannot be mutated by a caller", () => {
    const first = e().handle(null, outside, 0);
    expect(() => {
      (first as { kind: string }).kind = "action";
    }).toThrow(TypeError);
    expect(e().handle(null, outside, 0)).toEqual({ kind: "none" });
  });

  it("nested contexts: the innermost region wins, then outer regions, then global", () => {
    const en = createShortcutEngine({
      inGlobal: [{ keys: "F2", context: "global" }],
      inPanel: [{ keys: "F2", context: "panel" }],
      inResults: [{ keys: "F2", context: "results" }],
    });
    // contexts run innermost first; global is always last.
    expect(
      en.handle("F2", { inTextInput: false, contexts: ["results", "panel", "global"] }, 0),
    ).toEqual({ kind: "action", action: "inResults" });
    expect(
      en.handle("F2", { inTextInput: false, contexts: ["panel", "results", "global"] }, 0),
    ).toEqual({ kind: "action", action: "inPanel" });
    expect(en.handle("F2", { inTextInput: false, contexts: ["global"] }, 0)).toEqual({
      kind: "action",
      action: "inGlobal",
    });
    // A global binding listed first still loses to a region that contains focus.
    expect(en.handle("F2", { inTextInput: false, contexts: ["global", "panel"] }, 0)).toEqual({
      kind: "action",
      action: "inPanel",
    });
  });

  describe("an inner chord prefix against an outer full match (#319)", () => {
    const en = () =>
      createShortcutEngine({
        panelKey: [{ keys: "KeyG", context: "panel" }],
        resultsChord: [{ keys: "KeyG KeyX", context: "results" }],
      });
    const inResults = { inTextInput: false, contexts: ["results", "panel", "global"] } as const;
    const inPanel = { inTextInput: false, contexts: ["panel", "global"] } as const;

    it("focus in the inner region: the inner chord is reachable; the outer single key does not fire first", () => {
      const x = en();
      expect(x.handle("KeyG", inResults, 0)).toEqual({ kind: "pending" });
      expect(x.handle("KeyX", inResults, 10)).toEqual({ kind: "action", action: "resultsChord" });
    });

    it("focus only in the outer region: the outer single key still fires at once", () => {
      expect(en().handle("KeyG", inPanel, 0)).toEqual({ kind: "action", action: "panelKey" });
    });

    it("the reverse nesting: an inner full match beats an outer chord prefix", () => {
      const x = createShortcutEngine({
        resultsKey: [{ keys: "KeyG", context: "results" }],
        panelChord: [{ keys: "KeyG KeyX", context: "panel" }],
      });
      expect(x.handle("KeyG", inResults, 0)).toEqual({ kind: "action", action: "resultsKey" });
    });

    it("a global chord prefix does not delay a region's full match", () => {
      const x = createShortcutEngine({
        panelKey: [{ keys: "KeyG", context: "panel" }],
        globalChord: [{ keys: "KeyG KeyR", context: "global" }],
      });
      expect(x.handle("KeyG", inPanel, 0)).toEqual({ kind: "action", action: "panelKey" });
    });
  });
});
