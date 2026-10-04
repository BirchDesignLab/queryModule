import { useEffect, useRef } from "react";
import { revealAndFocus } from "./controls.js";
import { parentPointer } from "./issues.js";
import type { Selection } from "./selection.js";
import { topItem } from "./selection.js";
import type { TabId } from "./tabs.js";

/** A top-level item's own pointer ("/commands", "/queryTypes/2"), which the editor shows whole. */
function isTopPointer(pointer: string): boolean {
  const depth = pointer.split("/").length - 1;
  return depth <= (topItem(pointer) === "queryTypes" ? 2 : 1);
}

/**
 * Marks the selected item in the editor and scrolls to it (A-D1 A2); for the issue button, also
 * focuses the issue's control. The mark is a DOM attribute, not React state, so memoized rows do
 * not re-render on every selection.
 */
export function useMarkSelected(
  panel: React.RefObject<HTMLDivElement | null>,
  selection: Selection,
  tab: TabId,
) {
  // The seq whose Changes-view open already took focus: coming back to the Form tab later, with
  // that selection still current, must not pull focus into the item again.
  const focused = useRef(-1);
  useEffect(() => {
    const root = panel.current;
    const pointer = selection.pointer;
    // The Raw JSON view has no items; returning to the form marks and scrolls again (critic m7).
    if (root === null || pointer === null || tab !== "form") return;
    for (const el of root.querySelectorAll("[data-selected]")) el.removeAttribute("data-selected");
    const focus = selection.focus;
    const find = (p: string) => root.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`);
    // Done when the item has rendered and, for the issue button, the issue's message too.
    const nearest = (from: string | null) => {
      let el: HTMLElement | null = null;
      for (let p = from; p !== null && p !== "" && el === null; p = parentPointer(p)) el = find(p);
      return el;
    };
    const ready = () => {
      if (focus === undefined) {
        const el = find(pointer);
        return el === null ? null : { el, message: null };
      }
      // An issue may sit on a leaf value with no item of its own: once its message has rendered,
      // mark the nearest item that holds it.
      const message = root.querySelector(
        `[data-issue-pointer="${CSS.escape(focus)}"]`,
      )?.parentElement;
      const el = message === null || message === undefined ? null : nearest(pointer);
      return el === null ? null : { el, message };
    };
    const apply = (el: HTMLElement, message: Element | null | undefined) => {
      // The editor shows only the selected top-level item, so marking that item would tint the
      // whole pane: only a part inside it (a section, a field) is marked (critic m6).
      if (!isTopPointer(pointer)) el.setAttribute("data-selected", "true");
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
      el.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
      const rootMessages = message?.closest<HTMLElement>("[data-root-issues]");
      if (rootMessages) rootMessages.focus();
      else if (message?.id) {
        // The control the issue's message describes, or the first control of the item it
        // describes (an item-level issue).
        const described = root.querySelector<HTMLElement>(
          `[aria-describedby~="${CSS.escape(message.id)}"]`,
        );
        const control = described?.matches("input, select, textarea, button, summary, [tabindex]")
          ? described
          : described?.querySelector<HTMLElement>("input, select, textarea, button");
        if (control) revealAndFocus(control);
      } else if (selection.focusNode === true && focused.current !== selection.seq) {
        focused.current = selection.seq;
        // Opened from the Changes view: the button that was clicked went with its view, so focus
        // goes to the item's first control, else to the selected tree row.
        const control = el.querySelector<HTMLElement>(
          "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled):not([aria-disabled=true]), summary",
        );
        if (control) revealAndFocus(control);
        else
          root
            .closest(".qm-builder__scope")
            ?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
            ?.focus();
      }
    };
    const now = ready();
    if (now !== null) {
      apply(now.el, now.message);
      return;
    }
    // The section or type opens on this selection, so the item renders after this effect: watch
    // the editor until it appears. If it never does (an issue on a value with no item of its own),
    // mark the nearest rendered item above it after a while.
    const observer = new MutationObserver(() => {
      const found = ready();
      if (found === null) return;
      stop();
      apply(found.el, found.message);
    });
    const fallback = setTimeout(() => {
      stop();
      const el = nearest(parentPointer(pointer));
      if (el !== null) {
        apply(el, undefined);
      } else if (selection.focusNode === true && focused.current !== selection.seq) {
        // Nothing to open: the clicked entry has gone, so focus goes to the selected tree row.
        focused.current = selection.seq;
        root
          .closest(".qm-builder__scope")
          ?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
          ?.focus();
      }
    }, 3000);
    const stop = () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
    observer.observe(root, { childList: true, subtree: true });
    return stop;
  }, [panel, selection, tab]);
}
