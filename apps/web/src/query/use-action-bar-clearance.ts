import { type RefObject, useEffect } from "react";

const PROPERTY = "scroll-padding-block-end";

/** Where the action bar stops sticking (packages/web-ui styles.css): nothing is kept clear there. */
const SHORT_VIEWPORT = "(max-height: 20rem)";

/**
 * Focus not obscured (WCAG 2.4.11): the action bar sticks to the bottom of the viewport, so a
 * focus scroll that only brings a field into view leaves it under the bar. While the live panel is
 * mounted, the page's `scroll-padding-block-end` is as tall as the bar (plus a gap), so a focus
 * scroll clears it. On a short viewport the bar does not stick and nothing is kept clear.
 *
 * Cheap by design (a query-type switch remounts the bar, and each commit counts): the height comes
 * from the ResizeObserver entry, which reports after layout, so nothing here reads layout or
 * computed style inside a commit; the property is written only when its value changes and stays
 * while the bar re-mounts (`rebindKey`), and goes only with the panel. The preview never sets it:
 * its bar belongs to the builder's own scroller. Inline on <html>, memory-only.
 */
export function useActionBarClearance(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  rebindKey: string,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebindKey re-finds a re-mounted bar
  useEffect(() => {
    const bar = containerRef.current?.querySelector<HTMLElement>(".qm-action-bar");
    if (!enabled || bar === null || bar === undefined || typeof ResizeObserver === "undefined")
      return;
    const root = document.documentElement;
    const short =
      typeof window.matchMedia === "function" ? window.matchMedia(SHORT_VIEWPORT) : null;
    let height = 0;
    const publish = (): void => {
      if (short?.matches === true || height <= 0) {
        if (root.style.getPropertyValue(PROPERTY) !== "") root.style.removeProperty(PROPERTY);
        return;
      }
      const next = `calc(${height}px + var(--qm-space-2))`;
      if (root.style.getPropertyValue(PROPERTY) !== next) root.style.setProperty(PROPERTY, next);
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
      publish();
    });
    observer.observe(bar);
    short?.addEventListener("change", publish);
    return () => {
      observer.disconnect();
      short?.removeEventListener("change", publish);
    };
  }, [containerRef, enabled, rebindKey]);

  // The panel going away is what clears it, not a re-bind (the preview never set it).
  useEffect(() => {
    if (!enabled) return;
    return () => {
      document.documentElement.style.removeProperty(PROPERTY);
    };
  }, [enabled]);
}
