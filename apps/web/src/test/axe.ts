import axe from "axe-core";

export interface AxeFinding {
  id: string;
  /** CSS selectors of the offending nodes, for the failure message. */
  targets: string[];
}

/**
 * axe-core over a rendered subtree in jsdom (#644): the builder's unit tests check what e2e axe
 * checks in a browser. color-contrast is off because jsdom computes no layout or colors; e2e axe
 * and the visual specs cover contrast. Returns the violations by rule id, empty when clean.
 */
export async function axeViolations(root: Element): Promise<AxeFinding[]> {
  const result = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.map((v) => ({
    id: v.id,
    targets: v.nodes.map((n) => n.target.join(" ")),
  }));
}
