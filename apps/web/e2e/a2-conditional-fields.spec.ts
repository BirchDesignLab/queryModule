import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

test("[A2] a field revealed by a rule is announced and focus stays put (FR-002, FR-003, FR-011, UX-004)", async ({
  page,
}) => {
  await signIn(page);
  const state = page.getByLabel("State", { exact: true });
  const plateType = page.getByLabel("Plate type");
  await expect(plateType).toHaveCount(0);

  // Keyboard only: Tab from the heading until State has focus (quick access, query type, Plate).
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    if (await state.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(state).toBeFocused();
  await page.keyboard.press("O");
  await expect(state).toHaveValue("OK");

  await expect(plateType).toBeVisible();
  await expect(plateType).toHaveAttribute("aria-required", "true");
  await expect(page.getByTestId("announcer-polite")).toHaveText(
    /Plate type is now shown and required\./,
  );
  await expect(state).toBeFocused();
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("ArrowUp");
  await expect(state).toHaveValue("TX");
  await expect(plateType).toHaveCount(0);
  await expect(state).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});
