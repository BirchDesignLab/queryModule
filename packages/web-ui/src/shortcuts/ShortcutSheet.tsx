import type { ShortcutBinding } from "@querymodule/core/config";
import { type JSX, useEffect, useRef, useState } from "react";

export interface ShortcutSheetProps {
  open: boolean;
  onClose(): void;
  bindings: Readonly<Record<string, readonly ShortcutBinding[]>>;
  t(key: string): string;
  /** Where focus goes on close when the opener has left the page (a persona flip remounts the
   *  account menu; a shortcut pressed inside an open menu closes it). Null or absent: focus stays
   *  where the browser leaves it. Never used while the opener is still connected. */
  returnFocus?(): HTMLElement | null;
}

const TITLE_ID = "qm-shortcut-sheet-title";

/** `navigator.keyboard.getLayoutMap()` result: KeyboardEvent.code to the character on this layout. */
type LayoutMap = { get(code: string): string | undefined };

const MODIFIERS = ["Ctrl", "Alt", "Shift"] as const;

/** Modifiers and key joined with " + ". The key is the layout's label where the browser gave one,
 *  else the code (spec 6.4). Never a US character: on another layout it would name the wrong key.
 *  The layout map gives each key's unshifted character, so Shift+Slash reads "Shift + /", not "?". */
function strokeLabel(stroke: string, layout: LayoutMap | null): string {
  const parts = stroke.split("+");
  const code = parts[parts.length - 1] ?? stroke;
  const mods = parts.slice(0, -1);
  const key = layout?.get(code) ?? code;
  return [...MODIFIERS.filter((m) => mods.includes(m)), key].join(" + ");
}

/** The layout map where the browser exposes one (Chromium); null until it resolves, and for good
 *  when it is absent, throws or rejects. The sheet renders with the fallback labels meanwhile.
 *  Asked once per mount, on the first open (#319); later opens reuse the answer. */
function useLayoutMap(open: boolean): LayoutMap | null {
  const [layout, setLayout] = useState<LayoutMap | null>(null);
  const asked = useRef(false);
  // Cancelled on unmount only: closing the sheet before the map resolves must not lose it.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    try {
      const keyboard = (navigator as { keyboard?: { getLayoutMap?(): Promise<LayoutMap> } })
        .keyboard;
      keyboard
        ?.getLayoutMap?.()
        .then((map) => {
          if (mounted.current) setLayout(map);
        })
        .catch(() => undefined);
    } catch {
      // Layout map unavailable: keep the fallback labels.
    }
  }, [open]);
  return layout;
}

/** Modal list of every bound action (spec 6.4, 6.2 dialogs): Escape closes, focus returns to the opener. */
export function ShortcutSheet({
  open,
  onClose,
  bindings,
  t,
  returnFocus,
}: ShortcutSheetProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const layout = useLayoutMap(open);
  // Read at close time only: a new function identity per render must not re-run the effect below.
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      // Engines without dialog support (jsdom) still get the open attribute.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    if (!open && opener.current !== null) {
      const target =
        opener.current instanceof HTMLElement && opener.current.isConnected
          ? opener.current
          : (returnFocusRef.current?.() ?? null);
      target?.focus();
      opener.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="qm-shortcut-sheet"
      aria-labelledby={TITLE_ID}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={TITLE_ID}>{t("shortcut.sheetTitle")}</h2>
      <ul className="qm-shortcut-sheet__list">
        {Object.entries(bindings).flatMap(([action, list]) =>
          list.map((binding) => (
            <li key={`${action}:${binding.context}:${binding.keys}`}>
              <span className="qm-shortcut-sheet__action">{t(`shortcut.action.${action}`)}</span>{" "}
              <span className="qm-shortcut-sheet__keys">
                {binding.keys.split(" ").map((stroke, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a chord may repeat a stroke; order is fixed
                  <kbd key={i}>{strokeLabel(stroke, layout)}</kbd>
                ))}
              </span>{" "}
              <span className="qm-shortcut-sheet__context">
                {t(`shortcut.context.${binding.context}`)}
              </span>
            </li>
          )),
        )}
      </ul>
      {/* A focusable control inside the scrolling dialog (axe scrollable-region-focusable) and the
          element showModal focuses first; Escape still closes through the cancel event. */}
      <button type="button" className="qm-button" onClick={onClose}>
        {t("shortcut.close")}
      </button>
    </dialog>
  );
}
