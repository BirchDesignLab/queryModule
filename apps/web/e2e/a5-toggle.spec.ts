import type { Locator } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

/** A visible focus indicator on the focused element (WCAG 2.4.7), reached by keyboard. */
async function hasFocusRing(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  });
}

test("[A5] toggling keeps positioned and unpositioned values (FR-056, spec 4.4)", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();

  // Form: State OK reveals Plate type (a value the command cannot carry), then Passenger car.
  const state = page.getByLabel("State", { exact: true });
  await state.focus();
  await page.keyboard.type("Ok");
  await expect(state).toHaveValue("OK");
  const plateType = page.getByLabel("Plate type");
  await plateType.focus();
  await page.keyboard.type("Pa");
  await expect(plateType).toHaveValue("PC");
  const plate = page.getByLabel("Plate", { exact: true });
  await plate.focus();
  await page.keyboard.type("ZZ-0003");
  await expectNoSeriousAxeViolations(page);

  // Form to terminal.
  const toggle = page.getByRole("button", { name: "Terminal mode" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Control+Backquote");
  const input = page.getByRole("textbox", { name: "Command" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("VEH.ZZ-0003.OK");
  await expect(page.getByText("1 field not shown")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousAxeViolations(page);

  // Edit the command, then back to the form: the plate follows, Plate type is kept.
  await page.keyboard.press("Control+A");
  await page.keyboard.type("VEH.ZZ-0004.OK");
  await page.keyboard.press("Control+Backquote");
  await expect(plate).toBeFocused();
  await expect(plate).toHaveValue("ZZ-0004");
  await expect(plateType).toHaveValue("PC");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expectNoSeriousAxeViolations(page);
});

test("[A5] the toggle and the command line have a keyboard focus ring and a 24px target (spec 6.2, 6.6)", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Quick access" })).toBeVisible();
  const toggle = page.getByRole("button", { name: "Terminal mode" });
  const box = await toggle.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  // Tab reaches it (:focus-visible does not show for locator.focus()).
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press("Tab");
    if (await toggle.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(toggle).toBeFocused();
  expect(await hasFocusRing(toggle)).toBe(true);

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const input = page.getByRole("textbox", { name: "Command" });
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  expect(await hasFocusRing(input)).toBe(true);

  // The error list in a real browser: contrast and rules via axe.
  await page.keyboard.type("XYZ.1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Command problems" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});
