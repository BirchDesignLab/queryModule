/**
 * Focus the first `aria-invalid="true"` element in DOM (render) order (spec 6.2).
 * Skips disabled controls and controls under a `[hidden]`/`[inert]` ancestor, since
 * focusing them has no effect. Returns an element only when it actually took focus,
 * so the caller never gets told focus moved when it did not (FR-005).
 */
export function focusFirstInvalid(root: ParentNode): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>('[aria-invalid="true"]');
  for (const element of candidates) {
    if (element.matches(":disabled")) continue;
    if (element.closest("[hidden],[inert]") !== null) continue;
    element.focus();
    if (element.ownerDocument.activeElement === element) return element;
  }
  return null;
}
