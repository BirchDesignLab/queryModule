import type { ShortcutBinding } from "@querymodule/core/config";

type Bindings = Readonly<Record<string, readonly ShortcutBinding[]>>;

/**
 * What the shortcuts sheet lists: every binding, except "Quick access query type N" where the site
 * has fewer than N quick-access buttons (the key would pick nothing; G8).
 */
export function sheetBindings(bindings: Bindings, quickCount: number): Bindings {
  return Object.fromEntries(
    Object.entries(bindings).filter(([action]) => {
      const n = /^quickType(\d+)$/.exec(action)?.[1];
      return n === undefined || Number(n) <= quickCount;
    }),
  );
}
