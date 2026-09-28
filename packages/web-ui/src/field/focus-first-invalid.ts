/** Focus the first `aria-invalid="true"` element in DOM (render) order (spec 6.2). */
export function focusFirstInvalid(root: ParentNode): HTMLElement | null {
  const element = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  element?.focus();
  return element;
}
