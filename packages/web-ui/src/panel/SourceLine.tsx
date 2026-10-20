import type { JSX } from "react";
import { LineIcon, type LineIconName } from "../icons.js";

/** `notRun`: dropped before dispatch. `unknown`: a status this app does not know (#650), neutral. */
export type SourceLineTone = "pending" | "ok" | "problem" | "notRun" | "unknown";

/** Line icons that differ from the tone's own (mockup v6: a clock for timed out, a dash for interrupted). */
export type SourceLineIcon = "clock" | "dash";

/** Decorative: the line's text says the status (aria-hidden at the use site). Mockup v6 .src-line. */
const SOURCE_ICON: Readonly<Record<SourceLineTone, LineIconName>> = {
  pending: "ring",
  ok: "check",
  problem: "cross",
  notRun: "dash",
  unknown: "info",
};

/**
 * One source's status line: an icon that only repeats the status, the text that carries it, and
 * the reason it did not return when there is one. The request list and the admin card preview
 * draw it the same way (T10-Q3, #642).
 */
export function SourceLine({
  tone,
  text,
  why,
  source,
  icon,
}: {
  tone: SourceLineTone;
  text: string;
  why?: string | undefined;
  /** The source's name: set in bold where the text leads with it (the locale's word order decides). */
  source?: string | undefined;
  icon?: SourceLineIcon | undefined;
}): JSX.Element {
  return (
    <div className={`qm-source qm-source--${tone}`}>
      <span aria-hidden="true" className="qm-source__icon">
        <LineIcon name={icon ?? SOURCE_ICON[tone]} />
      </span>
      <span className="qm-source__text">
        <LineText text={text} source={source} />
      </span>
      {why === undefined ? null : (
        <>
          {/* A space for assistive technology; a flex row drops it visually. */}{" "}
          <span className="qm-source__why">{why}</span>
        </>
      )}
    </div>
  );
}

/** The name and its colon in bold, the rest plain, so the line reads as one run of words. */
function LineText({ text, source }: { text: string; source: string | undefined }) {
  if (source === undefined || source === "" || !text.startsWith(source)) return <>{text}</>;
  const lead = text.charAt(source.length) === ":" ? `${source}:` : source;
  return (
    <>
      <b className="qm-source__name">{lead}</b>
      {text.slice(lead.length)}
    </>
  );
}
