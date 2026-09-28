import type { Announcement, Announcer } from "@querymodule/client";
import { useSyncExternalStore } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

/** Alternates a trailing no-break space so a repeated message still mutates the region's text. */
function text(announcement: Announcement | null): string {
  if (announcement === null) return "";
  return announcement.id % 2 === 0 ? announcement.text : `${announcement.text} `;
}

/**
 * Keys the region's content on the announcement's own id (not a parity trick): the client
 * announcer shares one id counter across politeness levels, so two same-parity announcements
 * on the same region (with an intervening announcement on the other region) can land on the
 * same text-alternation phase. Keying on id forces React to remount the node whenever the id
 * changes, independent of whether the alternated text happens to match, so a repeated message
 * is still perceptible to assistive tech as a DOM change (spec 6.6, critic:C1).
 */
function key(announcement: Announcement | null): string | number {
  return announcement === null ? "empty" : announcement.id;
}

export function LiveAnnouncer({ announcer }: { announcer: Announcer }) {
  const snapshot = useSyncExternalStore(announcer.subscribe, announcer.current, announcer.current);
  return (
    <VisuallyHidden>
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        <span key={key(snapshot.polite)}>{text(snapshot.polite)}</span>
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-testid="announcer-assertive">
        <span key={key(snapshot.assertive)}>{text(snapshot.assertive)}</span>
      </div>
    </VisuallyHidden>
  );
}
