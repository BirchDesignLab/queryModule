import type { JSX } from "react";

/** The line icons of mockup v6 that sit beside text (#774). */
export type LineIconName =
  | "form"
  | "terminal"
  | "download"
  | "eye"
  | "back"
  | "lock"
  | "log"
  | "error"
  | "up"
  | "down";

const PATHS: Readonly<Record<LineIconName, JSX.Element>> = {
  form: (
    <>
      <rect x="4" y="4" width="16" height="6" rx="1" />
      <rect x="4" y="14" width="10" height="6" rx="1" />
    </>
  ),
  terminal: <path d="M4 6l6 6-6 6M12 18h8" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  log: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 11h7M9 15h7M9 7h3" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.01" />
    </>
  ),
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
};

/**
 * A 16 px line icon drawn with currentColor, so every theme and the focus ring apply. Always
 * decorative: the text beside it names the control, so it is hidden from the reader.
 */
export function LineIcon({
  name,
  trailing = false,
}: {
  name: LineIconName;
  /** After the words (Older's down arrow): the gap goes before the icon. */
  trailing?: boolean;
}): JSX.Element {
  return (
    <svg
      className={trailing ? "qm-line-icon qm-line-icon--trailing" : "qm-line-icon"}
      data-icon={name}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
