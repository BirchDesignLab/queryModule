import { type ShortcutBinding, usLayoutChar } from "@querymodule/core/config";
import { type JSX, useEffect, useRef } from "react";

export interface ShortcutSheetProps {
  open: boolean;
  onClose(): void;
  bindings: Readonly<Record<string, readonly ShortcutBinding[]>>;
  t(key: string): string;
}

const TITLE_ID = "qm-shortcut-sheet-title";

/** Each stroke as the character it types on a US layout where one resolves, else its code. */
function strokeLabel(stroke: string): string {
  return usLayoutChar(stroke) ?? stroke;
}

/** Modal list of every bound action (spec 6.4, 6.2 dialogs): Escape closes, focus returns to the opener. */
export function ShortcutSheet({ open, onClose, bindings, t }: ShortcutSheetProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

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
    if (!open && opener.current instanceof HTMLElement) {
      opener.current.focus();
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
                  <kbd key={i}>{strokeLabel(stroke)}</kbd>
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
