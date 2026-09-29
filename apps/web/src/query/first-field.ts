/**
 * The control a run or a mode switch leaves focus on: the first field in the container, except
 * that an unchecked radio never takes it (Space on a segment would change the value): a checked
 * radio, or any other control, whichever comes first.
 */
export function firstField(container: ParentNode | null | undefined): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>(
      "input:not([type=radio]), input[type=radio]:checked, select, textarea",
    ) ?? null
  );
}
