import type { CSSProperties, ReactNode } from "react";

export const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Text for assistive technology only. React applies style through the CSSOM, allowed by style-src 'self'. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span style={visuallyHiddenStyle}>{children}</span>;
}
