/**
 * After a blocked submit the first invalid field has focus, but the last one (and its message) can sit
 * under the sticky action bar. Scrolls the page by what the last field's box overlaps the bar's clear
 * area (the page's scroll-padding-block-end, published by use-action-bar-clearance), and never so far
 * that the focused first field leaves the top of the viewport. Moves no focus (G13).
 */
export function revealLastInvalid(root: ParentNode): void {
  const invalid = Array.from(root.querySelectorAll<HTMLElement>('[aria-invalid="true"]')).filter(
    (el) => !el.matches(":disabled") && el.closest("[hidden],[inert]") === null,
  );
  const first = invalid[0];
  const last = invalid.at(-1);
  if (first === undefined || last === undefined || first === last) return;
  const boxOf = (el: HTMLElement): HTMLElement => el.closest<HTMLElement>("[data-field-key]") ?? el;
  const clearance =
    Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd) || 0;
  const overlap = boxOf(last).getBoundingClientRect().bottom - (window.innerHeight - clearance);
  if (overlap <= 0) return;
  const room = Math.max(0, boxOf(first).getBoundingClientRect().top);
  window.scrollBy({ top: Math.min(overlap, room) });
}
