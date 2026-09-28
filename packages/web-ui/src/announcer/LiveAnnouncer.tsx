import type { Announcement, Announcer } from "@querymodule/client";
import { useSyncExternalStore } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

/** Alternates a trailing no-break space so a repeated message still mutates the region. */
function text(announcement: Announcement | null): string {
  if (announcement === null) return "";
  return announcement.id % 2 === 0 ? announcement.text : `${announcement.text} `;
}

export function LiveAnnouncer({ announcer }: { announcer: Announcer }) {
  const snapshot = useSyncExternalStore(announcer.subscribe, announcer.current, announcer.current);
  return (
    <VisuallyHidden>
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        {text(snapshot.polite)}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-testid="announcer-assertive">
        {text(snapshot.assertive)}
      </div>
    </VisuallyHidden>
  );
}
