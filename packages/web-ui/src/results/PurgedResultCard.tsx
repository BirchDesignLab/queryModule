import { type JSX, useId } from "react";
import type { ResultT } from "./severity.js";

export interface PurgedResultCardProps {
  /** The source's name, already resolved. */
  heading: string;
  /** The status word, already resolved ("returned"). */
  status: string;
  /** h4 in part 0, h5 in a nested part. */
  headingLevel?: 4 | 5;
  t: ResultT;
}

/**
 * A returned result whose payload retention removed (spec 5.5, 6.2; FR-062 read half, SEC-021). It
 * takes no payload, so it cannot map, badge or highlight anything: the dashed edge and the words
 * "Purged under retention" carry the state, and there is nothing in it to operate. The heading
 * reads like a result card's ("Source: returned") so the list keeps its shape.
 */
export function PurgedResultCard({
  heading,
  status,
  headingLevel = 4,
  t,
}: PurgedResultCardProps): JSX.Element {
  const headingId = useId();
  const Heading = headingLevel === 4 ? "h4" : "h5";
  return (
    <section className="qm-card qm-card--purged" aria-labelledby={headingId}>
      <div className="qm-card__head">
        <Heading id={headingId} className="qm-card__title">
          {t("sourceStatus.line", { source: heading, status })}
        </Heading>
      </div>
      <p className="qm-card__purged">
        <span aria-hidden="true" className="qm-card__purged-icon">
          ◷
        </span>
        {t("result.purged")}
      </p>
      <p className="qm-card__note">{t("result.purgedNote")}</p>
    </section>
  );
}
