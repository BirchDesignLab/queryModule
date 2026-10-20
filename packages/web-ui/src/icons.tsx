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
  | "down"
  | "chevron"
  | "sliders"
  | "users"
  | "check"
  | "ring"
  | "clock"
  | "cross"
  | "dash"
  | "skip"
  | "info";

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
  chevron: <path d="M6 9l6 6 6-6" />,
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20c.8-3.5 3.5-5 7-5s6.2 1.5 7 5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.4 2.2 4 5" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
  ring: <circle cx="12" cy="12" r="8" strokeDasharray="4 3" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  cross: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  dash: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  skip: (
    <>
      <path d="M5 5l9 7-9 7z" />
      <path d="M18 5v14" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
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
