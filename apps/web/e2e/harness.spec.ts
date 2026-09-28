import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";

test.describe("M0 harness", () => {
  test("index.html carries the nonce CSP and no-store (spec 5.9)", { tag: "@smoke" }, async ({
    page,
  }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("script-src 'nonce-");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
  test("sign-in page has no serious or critical axe violations", { tag: "@smoke" }, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });
  test("the CSP fixture records a violation", async ({ page, cspViolations }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // Loads the served CSP must block: a cross-origin image (img-src 'self' data:) and an
    // inline style element (style-src 'self'). Playwright's own script injection runs outside
    // the page CSP, so it cannot serve as the trigger.
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "https://example.invalid/qm-csp-probe.png";
      img.alt = "";
      document.body.append(img);
      const style = document.createElement("style");
      style.textContent = "body { outline: 0; }";
      document.head.append(style);
    });
    await expect.poll(() => cspViolations.join(" | ")).toMatch(/img-src/);
    await expect.poll(() => cspViolations.join(" | ")).toMatch(/style-src/);
    // Collected: clear them so this test's own fixture teardown (which expects none) passes.
    cspViolations.splice(0);
  });
});
