import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";

test.describe("M0 harness", () => {
  test("index.html carries the nonce CSP and no-store (spec 5.9)", { tag: "@smoke" }, async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("script-src 'nonce-");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
  test("sign-in page has no serious or critical axe violations", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });
});
