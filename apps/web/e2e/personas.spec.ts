import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// The v1 demo personas (spec 6.1, 6.3 subset, UX-001, UX-012, BR-002). The layout comes from the
// signed-in user's persona: the officer has a stored mobileUnit override (seed, Track A Task 36);
// the dispatcher has none and this is a mouse device, so it gets the dispatch layout.

const MIN_TARGET = 48;
const INTERACTIVE = [
  "header a",
  "header button",
  "header select",
  "main a",
  "main button",
  "main select",
  "main input",
  "main textarea",
].join(", ");

async function panelReady(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
}

/** Rendered size of every visible interactive control (a checkbox counts by its own box). */
async function undersizedTargets(page: Page, min: number): Promise<string[]> {
  return page.locator(INTERACTIVE).evaluateAll((els, minimum) => {
    const label = (el: Element): string =>
      `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`;
    return els.flatMap((el) => {
      const box = el.getBoundingClientRect();
      const visible =
        box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
      if (!visible) return [];
      if (box.width >= minimum - 0.5 && box.height >= minimum - 0.5) return [];
      return [`${label(el)} ${Math.round(box.width)}x${Math.round(box.height)}`];
    });
  }, min);
}

async function headerHeight(page: Page): Promise<number> {
  return page.getByRole("banner").evaluate((el) => el.getBoundingClientRect().height);
}

async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.scrollingElement;
    return el === null ? 0 : el.scrollWidth - el.clientWidth;
  });
}

test.describe("personas at 1024x768 (spec 6.1, 6.3 subset)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("dispatcher: dispatch layout, no Admin link, /admin shows the panel", async ({ page }) => {
    await signIn(page, seededUser("dispatcher@example.test"));
    await panelReady(page);

    await expect(page.locator("html")).toHaveAttribute("data-persona", "dispatch");
    await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(0);
    await expect(page.locator(".qm-app-header--compact")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" }),
    ).toHaveCount(0);

    // Not advertised: the console path gives what an unknown path gives.
    await page.goto("/admin");
    await panelReady(page);
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
  });

  test("officer: mobile-unit layout, 48x48 targets, header and themes, keyboard plate query", async ({
    page,
  }) => {
    // Header height of the dispatch layout at the same viewport, for the compact-bar check.
    await signIn(page, seededUser("dispatcher@example.test"));
    await panelReady(page);
    const dispatchHeader = await headerHeight(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await signIn(page, seededUser("officer@example.test"));
    await panelReady(page);

    await expect(page.locator("html")).toHaveAttribute("data-persona", "mobileUnit");
    await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(1);
    await expect(page.locator(".qm-app-header--compact")).toHaveCount(1);
    expect(await headerHeight(page)).toBeLessThanOrEqual(dispatchHeader);
    expect(await overflowX(page)).toBeLessThanOrEqual(0);

    // Night and red shift are one control away: options of the header select.
    const theme = page.getByRole("banner").getByLabel("Theme");
    await expect(theme.locator("option[value='night']")).toHaveCount(1);
    await expect(theme.locator("option[value='redShift']")).toHaveCount(1);

    // Quick access first: the bar precedes the form in the panel.
    const order = await page.evaluate(() => {
      const bar = document.querySelector(".qm-quick-access");
      const form = document.querySelector("main form");
      return bar !== null && form !== null
        ? bar.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0;
    });
    expect(order).toBeGreaterThan(0);
    // Guard against a vacuous pass: header controls, quick access, form fields and Submit.
    expect(await page.locator(INTERACTIVE).count()).toBeGreaterThan(8);
    expect(await undersizedTargets(page, MIN_TARGET)).toEqual([]);

    // Keyboard only from here: a plate query reaches the acknowledgment.
    await page.getByLabel("Plate", { exact: true }).focus();
    await page.keyboard.type("ZZ-0001");
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
    );
    await page.keyboard.press("Enter");
    expect((await response).status()).toBe(202);
    await expect(page.getByRole("heading", { name: "Last query" })).toBeVisible();

    // The Copy reference button only exists after an acknowledgment, so measure again.
    await expect(page.getByRole("button", { name: "Copy reference" })).toBeVisible();
    expect(await undersizedTargets(page, MIN_TARGET)).toEqual([]);
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    await expectNoSeriousAxeViolations(page);
  });

  test("admin: dispatch layout, Admin link, Config and Users", async ({ page }) => {
    await signIn(page, seededUser("admin@example.test"));
    await panelReady(page);
    await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(0);

    const link = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Admin" });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Site config" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);

    const sections = page.getByRole("navigation", { name: "Admin sections" });
    await sections.getByRole("link", { name: "Users" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });
});
