import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

/** Every scenario fails on any CSP violation (spec 9.3 step 12, from M0). */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.exposeFunction("__qmReportCsp", (violation: string) => {
        violations.push(violation);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          (window as unknown as { __qmReportCsp(v: string): void }).__qmReportCsp(
            `${event.violatedDirective} ${event.blockedURI}`,
          );
        });
      });
      page.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("Content Security Policy"))
          violations.push(message.text());
      });
      await use(violations);
      expect(violations, "CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Fails on serious or critical axe violations (spec 9.3 step 12, 10.6). */
export async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(serious).toEqual([]);
}
