import type { Severity } from "@querymodule/core/contracts";
import type { JSX } from "react";
import { type ResultT, SeverityIcon, type SeverityStyles, severityColors } from "./severity.js";

export interface SeverityBadgeProps {
  /** The highest severity found, or null for none: then nothing is drawn. */
  severity: Severity | null;
  styles: SeverityStyles;
  t: ResultT;
}

/** Icon (aria-hidden), the severity word and the marker (aria-hidden) in the style's token colours (UX-010). */
export function SeverityBadge({ severity, styles, t }: SeverityBadgeProps): JSX.Element | null {
  if (severity === null) return null;
  const style = styles[severity];
  return (
    <span className={`qm-badge qm-badge--${severity}`} style={severityColors(style)}>
      <SeverityIcon name={style.icon} />
      <span>{t(`severity.${severity}`)}</span>
      <span aria-hidden="true" className="qm-badge__marker">
        {style.marker}
      </span>
    </span>
  );
}
