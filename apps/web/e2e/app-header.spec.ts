import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseTheme, openAccountMenu, signIn } from "./helpers.js";

// B1 app shell and header (docs/design/2026-09-29-visual-system.md, app shell): a 52 px bar with
// the Main nav and an account disclosure that holds the theme choice and sign out.
test.describe("B1 app header (dispatch layout)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("52 px bar, Queries is the current page, Status goes to /status and Queries back", async ({
    page,
  }) => {
    await signIn(page);
    const header = page.getByRole("banner");
    const box = await header.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(52);
    const nav = header.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Queries" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: "Status" }).click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(nav.getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Queries" }).click();
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test("the account disclosure opens, passes axe, changes theme, and Esc returns focus", async ({
    page,
  }) => {
    await signIn(page);
    const button = page.getByRole("banner").locator(".qm-account__button");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    // At rest the trigger is a ghost button: no border, no ring (the amber seen after Esc is the
    // focus ring, checked below).
    await expect(button).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await expect(button).toHaveCSS("outline-style", "none");
    const panel = await openAccountMenu(page);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("account-menu.png") });
    await expectNoSeriousAxeViolations(page);
    await chooseTheme(page, "night");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await openAccountMenu(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    // A theme choice is a saved preference: put it back and wait for the PUT to land.
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/v1/me/preferences") && r.request().method() === "PUT" && r.ok(),
    );
    await chooseTheme(page, "auto");
    await saved;
  });
});

// Persona flip (ruling): a newer config that changes the persona's layout swaps the header bar.
// Focus stays on the button for the same theme mode in the new bar, with no announcement.
test.describe("B1 theme focus survives a persona flip", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("focus on a theme button in the account menu lands on the same mode in the compact bar", async ({
    page,
  }) => {
    let flipped = false;
    await page.route("**/api/v1/config", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        configHash: string;
        personas: { layout: string }[];
      };
      if (flipped) {
        body.configHash = "d".repeat(64);
        for (const persona of body.personas) persona.layout = "mobileUnit";
      }
      await route.fulfill({ response, json: body });
    });
    await page.clock.install();
    await signIn(page);
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    const panel = await openAccountMenu(page);
    // Focus a mode without pressing it, so the focused mode is not the pressed one.
    const night = panel.getByRole("button", { name: "Night" });
    await night.focus();
    await expect(night).toBeFocused();

    flipped = true;
    await page.clock.fastForward(16_000);

    const banner = page.getByRole("banner");
    await expect(banner).toHaveClass(/qm-app-header--compact/);
    await expect(
      banner.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Night" }),
    ).toBeFocused();
    await expect(page.getByTestId("announcer-polite")).not.toContainText(/theme|night/i);
  });
});
