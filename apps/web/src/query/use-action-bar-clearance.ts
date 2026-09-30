import { type RefObject, useEffect } from "react";

/**
 * Focus not obscured (WCAG 2.4.11): the action bar sticks to the bottom of the viewport, so a
 * focus scroll that only brings a field into view leaves it under the bar. While the live panel is
 * mounted, the page's `scroll-padding-block-end` is as tall as the bar (plus a gap), so a focus
 * scroll clears it. Under 20rem of viewport height the bar is not sticky (styles.css) and nothing
 * is kept clear. The bar mounts again when the mode or the query type changes, so `rebindKey`
 * re-finds it. The preview never sets it: its bar belongs to the builder's own scroller.
 * Inline on <html>, memory-only, and removed with the panel.
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
    const publish = () => {
      if (getComputedStyle(bar).position === "sticky")
        root.style.setProperty(
          "scroll-padding-block-end",
          `calc(${bar.getBoundingClientRect().height}px + var(--qm-space-2))`,
        );
      else root.style.removeProperty("scroll-padding-block-end");
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    // A viewport that crosses the short-height breakpoint flips the bar between sticky and static
    // without resizing it.
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("scroll-padding-block-end");
    };
  }, [containerRef, enabled, rebindKey]);
}
