import { type RefObject, useEffect } from "react";

/** A control that has its own text undo: text-like inputs, textareas and editable content. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return ![
    "checkbox",
    "radio",
    "button",
    "submit",
    "reset",
    "range",
    "color",
    "file",
    "image",
  ].includes(target.type);
}

/**
 * Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y (Command on a Mac) inside the builder only, and never in a text
 * entry, where the browser's own undo belongs to the field (a native listener: the scope is a
 * wrapper with no role, so a React key handler on it would be a lint error and a false widget).
 */
export function useUndoKeys(
  scopeRef: RefObject<HTMLDivElement | null>,
  step: (direction: "undo" | "redo") => void,
): void {
  useEffect(() => {
    const scope = scopeRef.current;
    if (scope === null) return;
    const onKeys = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // The key by its letter, or by its place on the keyboard on a layout with no Latin letter.
      const key = /^[a-z]$/i.test(e.key)
        ? e.key.toLowerCase()
        : e.code.replace("Key", "").toLowerCase();
      const undo = key === "z" && !e.shiftKey;
      // Ctrl+Y only: Cmd+Y is the browser's History on a Mac.
      const redo =
        (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey);
      if ((!undo && !redo) || isTextEntry(e.target)) return;
      e.preventDefault();
      step(undo ? "undo" : "redo");
    };
    scope.addEventListener("keydown", onKeys);
    return () => scope.removeEventListener("keydown", onKeys);
  }, [scopeRef, step]);
}
