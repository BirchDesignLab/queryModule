import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

test("[A3] a blocked submit names the missing field, focuses it and announces (FR-006, UX-004)", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("Query type").selectOption("PER");
  const first = page.getByLabel("First name");
  const last = page.getByLabel("Last name");
  await expect(last).toHaveAttribute("aria-required", "true");
  await first.focus();
  await page.keyboard.press("Enter");

  await expect(last).toHaveAttribute("aria-invalid", "true");
  const describedBy = await last.getAttribute("aria-describedby");
  expect(describedBy).not.toBeNull();
  const messageId = (describedBy ?? "").split(" ").find((id) => id.endsWith("-error"));
  expect(messageId).toBeDefined();
  await expect(page.locator(`#${messageId}`)).toHaveText("Last name is required.");
  await expect(last).toBeFocused();
  await expect(page.getByTestId("announcer-polite")).toHaveText(/1 field needs attention\./);
  await expectNoSeriousAxeViolations(page);
});
