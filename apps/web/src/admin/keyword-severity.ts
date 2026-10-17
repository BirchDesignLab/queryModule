import type { Highlighted } from "@querymodule/web-ui";

export const SEVERITIES = ["critical", "warning", "info"] as const;
export type Sev = (typeof SEVERITIES)[number];
export const isSeverity = (v: unknown): v is Sev =>
  (SEVERITIES as readonly string[]).includes(v as string);

/** The three severity styles as the highlighter takes them. */
export type Styles = Parameters<typeof Highlighted>[0]["styles"];
