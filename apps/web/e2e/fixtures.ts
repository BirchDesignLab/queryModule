import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { shouldRunAxe } from "./axe-policy.js";

/** Every scenario fails on any CSP violation (spec 9.3 step 12, from M0). */
export const test = base.extend<{ cspViolations: string[]; axeAfterEach: undefined }>({
  /**
   * Axe runs after every scenario that passed its own assertions, on the page it ended on (spec
   * 10.6, 12.7 M1 row). Opt out with `test.info().annotations.push({ type: "axe-skip", description:
   * "<why>" })`; the reason is required. Mid-test states (a dialog, a second mode) still call
   * `expectNoSeriousAxeViolations` themselves.
   */
  axeAfterEach: [
    async ({ page, baseURL }, use, testInfo) => {
      await use(undefined);
      // A failing test reports its own failure; axe on a half-finished page would only add noise.
      if (testInfo.status !== testInfo.expectedStatus) return;
      if (shouldRunAxe(page.url(), testInfo.annotations, baseURL ?? "http://localhost:3000")) {
        await expectNoSeriousAxeViolations(page);
      }
    },
    { auto: true, timeout: 15_000 },
  ],

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
      // Any console message about the CSP counts, whatever its level (a report-only or
      // eval violation is not always logged as an error).
      page.on("console", (message) => {
        if (message.text().includes("Content Security Policy")) violations.push(message.text());
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
