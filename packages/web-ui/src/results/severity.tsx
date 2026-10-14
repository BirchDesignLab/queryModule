import type { Severity } from "@querymodule/core/contracts";
import { cssVarName } from "@querymodule/tokens";
import type { CSSProperties, JSX } from "react";

/** The parts of a keywordSeverityStyles entry the primitives draw (spec 4.1, 6.2). */
export interface SeverityStyleView {
  /** Token name of the text colour, for example `color.severity.critical.fg`. */
  color: string;
  /** Token name of the background colour. */
  background: string;
  bold: boolean;
  /** Icon name from the shipped set; an unknown name draws a generic mark. */
  icon: string;
  /** Short marker text such as `!!`; decorative, so always aria-hidden. */
  marker: string;
}

export type SeverityStyles = Readonly<Record<Severity, SeverityStyleView>>;

export type ResultT = (
  key: string,
  params?: Readonly<Record<string, string | number | boolean>>,
) => string;

/** The token pair as inline colours; custom properties resolve per theme mode. */
export function severityColors(style: SeverityStyleView): CSSProperties {
  return {
    color: `var(${cssVarName(style.color)})`,
    background: `var(${cssVarName(style.background)})`,
    fontWeight: style.bold ? 600 : 400,
  };
}

const ICON_PATHS: Readonly<Record<string, JSX.Element>> = {
  "alert-octagon": (
    <>
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
      <path d="M12 8v5M12 16v.5" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 9v5M12 17v.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
};

const GENERIC_ICON = <circle cx="12" cy="12" r="9" />;

/** Decorative: the word beside it carries the severity, so it is always aria-hidden. */
export function SeverityIcon({ name }: { name: string }): JSX.Element {
  return (
    <svg
      className="qm-severity-icon"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name] ?? GENERIC_ICON}
    </svg>
  );
}
