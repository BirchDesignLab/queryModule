import { useEffect, useState } from "react";

/**
 * `value` once it has stopped changing for `delayMs`, and only while `enabled`; until then
 * `initial`. A live-region announcement uses it so a screen reader hears the settled outcome, not
 * every keystroke on the way to it (FR-043, FR-044; BW3 polish, CRITIC-M3).
 */
export function useDebouncedValue<T>(value: T, delayMs: number, enabled: boolean, initial: T): T {
  const [settled, setSettled] = useState<T>(initial);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, enabled]);
  return settled;
}
