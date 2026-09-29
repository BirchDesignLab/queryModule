import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

const MODES = ["day", "night", "redShift"] as const;
const MIN_TARGET = 24;

async function blockedVehiclePanel(page: Page, mode: (typeof MODES)[number]): Promise<void> {
  await page.getByLabel("Theme").selectOption(mode);
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await page.getByLabel("Query type").selectOption("VEH");
  await page.getByLabel("State", { exact: true }).selectOption("OK");
  await expect(page.getByLabel("Plate type")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByLabel("Plate type")).toHaveAttribute("aria-invalid", "true");
}

test.describe("panel at 320px (spec 6.2, 6.5, 6.6)", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  for (const mode of MODES) {
    test(`${mode}: no overflow, 24px targets, focus ring, axe`, async ({ page }) => {
      await signIn(page);
      await blockedVehiclePanel(page, mode);

      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement;
        return el === null ? 0 : el.scrollWidth - el.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);

      const small = await page
        .locator(
          "main a, main button, main input, main select, header a, header button, header select",
        )
        .evaluateAll(
          (els, min) =>
            els
              .map((el) => ({ el, box: el.getBoundingClientRect() }))
              .filter(({ box }) => box.width > 0 && box.height > 0)
              .filter(({ box }) => box.width < min || box.height < min)
              .map(({ el, box }) => `${el.tagName} ${el.id} ${box.width}x${box.height}`),
          MIN_TARGET,
        );
      expect(small).toEqual([]);

      const plate = page.getByLabel("Plate", { exact: true });
      await plate.focus();
      const ring = await plate.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          style: s.outlineStyle,
          width: Number.parseFloat(s.outlineWidth),
          color: s.outlineColor,
        };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThan(0);
      const surface = await plate.evaluate((el) => {
        const raised = el.closest(".qm-query-panel") ?? el.parentElement;
        return raised === null ? "" : getComputedStyle(raised).backgroundColor;
      });
      expect(ring.color).not.toBe(surface);

      await expectNoSeriousAxeViolations(page);
    });
  }
});

test("Tab order puts the header before the panel; Enter attempts one submit (FR-006, UX-004)", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("Query type").selectOption("PER");
  const order = await page.evaluate(() => {
    const focusable = [
      ...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea"),
    ];
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    return {
      headerFirst:
        focusable.findIndex((el) => main?.contains(el)) >
        focusable.map((el) => header?.contains(el) === true).lastIndexOf(true),
      headerHasTheme: header?.querySelector("select") !== null,
    };
  });
  expect(order.headerFirst).toBe(true);
  expect(order.headerHasTheme).toBe(true);

  await page.getByRole("heading", { name: "Query Module" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByLabel("Theme")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Status" })).toBeFocused();

  const submit = page.getByRole("button", { name: "Submit" });
  await expect(submit).not.toBeDisabled();
  const attempts: string[] = [];
  await page.exposeFunction("__qmAttempt", (text: string) => attempts.push(text));
  await page.evaluate(() => {
    const polite = document.querySelector('[data-testid="announcer-polite"]');
    if (polite === null) return;
    new MutationObserver(() => {
      const text = polite.textContent?.trim() ?? "";
      if (text !== "") (window as unknown as { __qmAttempt(t: string): void }).__qmAttempt(text);
    }).observe(polite, { childList: true, characterData: true, subtree: true });
  });
  await page.getByLabel("First name").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Last name")).toHaveAttribute("aria-invalid", "true");
  await page.waitForTimeout(300);
  expect(attempts.filter((a) => a.includes("needs attention"))).toHaveLength(1);
});
