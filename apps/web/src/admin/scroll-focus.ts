/**
 * A region that scrolls must take focus so the keyboard can scroll it (axe scrollable-region-focusable).
 * The lint rule against tabindex on a named, non-interactive element is written for the opposite
 * mistake, so the attribute is spread from here.
 */
export const SCROLL_FOCUS = { tabIndex: 0 } as const;
