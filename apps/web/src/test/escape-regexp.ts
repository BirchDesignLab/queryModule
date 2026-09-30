/** `text` as a regular-expression source that matches exactly that text: every metacharacter escaped, backslash included. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
