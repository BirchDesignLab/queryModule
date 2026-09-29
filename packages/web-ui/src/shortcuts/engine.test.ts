import { resolveShortcuts } from "@querymodule/core/config";
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
  it("EDITING_COMBOS lists Ctrl+A, C, V, X, Z, Y", () => {
    expect([...EDITING_COMBOS].sort()).toEqual(
      ["Ctrl+KeyA", "Ctrl+KeyC", "Ctrl+KeyV", "Ctrl+KeyX", "Ctrl+KeyY", "Ctrl+KeyZ"].sort(),
    );
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
