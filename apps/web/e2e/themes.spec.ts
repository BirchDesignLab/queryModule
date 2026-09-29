import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { hexToRgb, signIn } from "./helpers.js";

const MODES = ["day", "night", "redShift"] as const;

test.describe("UX-002 three theme modes render (spec 6.5)", () => {
  for (const mode of MODES) {
    test(`${mode} applies its tokens and passes axe`, async ({ page }) => {
      await page.goto("/");
      await page.getByLabel("Theme").selectOption(mode);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      const { surface, background } = await page.evaluate(() => ({
        surface: getComputedStyle(document.documentElement).getPropertyValue(
          "--qm-color-surface-base",
        ),
        background: getComputedStyle(document.body).backgroundColor,
      }));
      expect(background).toBe(hexToRgb(surface));
      await expectNoSeriousAxeViolations(page);
    });
  }

  test("the three modes have distinct surfaces", async ({ page }) => {
    await page.goto("/");
    const surfaces = new Set<string>();
    for (const mode of MODES) {
      await page.getByLabel("Theme").selectOption(mode);
      surfaces.add(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--qm-color-surface-base")
            .trim(),
        ),
      );
    }
    expect(surfaces.size).toBe(3);
  });
});

test.describe("OS dark scheme with no preference", () => {
  test.use({ colorScheme: "dark" });
  test("defaults to night", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  });
});

test.describe("OS light scheme with no preference", () => {
  test.use({ colorScheme: "light" });
  test("defaults to day", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  });
});

// ADR-0009: the shipped site defaults to auto (os), so a signed-in user with no preference
// follows the OS instead of the site's old fixed day. The smoke user's stored preference is
// replaced by none, so only the site default decides.
const noPreference = async (page: Page) => {
  await page.route("**/api/v1/me/preferences", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    if (!response.ok()) throw new Error(`live preferences answered ${response.status()}`);
    return route.fulfill({ json: { ...(await response.json()), themeMode: null } });
  });
};

test.describe("signed in, no preference, OS dark", () => {
  test.use({ colorScheme: "dark" });
  test("follows the OS to night after sign-in", async ({ page }) => {
    await noPreference(page);
    await signIn(page);
    await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  });
});

test.describe("signed in, no preference, OS light", () => {
  test.use({ colorScheme: "light" });
  test("follows the OS to day after sign-in", async ({ page }) => {
    await noPreference(page);
    await signIn(page);
    await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  });
});
