import type { JSX } from "react";

/** The line icons of mockup v6 that sit beside text (#774): form, terminal, download, eye, back. */
export type LineIconName = "form" | "terminal" | "download" | "eye" | "back";

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
};

/**
 * A 16 px line icon drawn with currentColor, so every theme and the focus ring apply. Always
 * decorative: the text beside it names the control, so it is hidden from the reader.
 */
export function LineIcon({ name }: { name: LineIconName }): JSX.Element {
  return (
    <svg
      className="qm-line-icon"
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
