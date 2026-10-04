export const TABS = ["form", "raw", "changes"] as const;
export type TabId = (typeof TABS)[number];

/** The tab a key moves to from `tab` (arrows by direction with wrap, Home and End), or undefined. */
export function tabAfterKey(tab: TabId, key: string): TabId | undefined {
  const i = TABS.indexOf(tab);
  return key === "ArrowRight"
    ? TABS[(i + 1) % TABS.length]
    : key === "ArrowLeft"
      ? TABS[(i - 1 + TABS.length) % TABS.length]
      : key === "Home"
        ? TABS[0]
        : key === "End"
          ? TABS[TABS.length - 1]
          : undefined;
}
