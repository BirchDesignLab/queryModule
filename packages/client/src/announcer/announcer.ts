export type Politeness = "polite" | "assertive";

export interface Announcement {
  id: number;
  text: string;
  politeness: Politeness;
}

export interface AnnouncerSnapshot {
  polite: Announcement | null;
  assertive: Announcement | null;
}

export interface Announcer {
  announce(text: string, politeness?: Politeness): Announcement;
  clear(): void;
  current(): AnnouncerSnapshot;
  subscribe(listener: () => void): () => void;
}

/**
 * One announcer queue (spec 6.6); web binds it to two live regions, native to
 * announceForAccessibility. Assertive is reserved for critical severity (M2 rules).
 */
export function createAnnouncer(): Announcer {
  let nextId = 1;
  let snapshot: AnnouncerSnapshot = { polite: null, assertive: null };
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    announce(text, politeness = "polite") {
      const announcement: Announcement = { id: nextId++, text, politeness };
      snapshot =
        politeness === "polite"
          ? { ...snapshot, polite: announcement }
          : { ...snapshot, assertive: announcement };
      emit();
      return announcement;
    },
    clear() {
      snapshot = { polite: null, assertive: null };
      emit();
    },
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
