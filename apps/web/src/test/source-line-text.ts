/**
 * Finds a source status line by its whole words (#835): the line sets the source name in bold, so
 * its text spans two nodes and a plain text query no longer matches it.
 */
export function lineText(text: string | RegExp) {
  return (_content: string, element: Element | null): boolean =>
    element?.classList.contains("qm-source__text") === true &&
    (typeof text === "string"
      ? element.textContent === text
      : text.test(element.textContent ?? ""));
}
