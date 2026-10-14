import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

// Demo stories (docs/demo.md "Demo stories"): the calm record hits of the scenario pack. ZZ-0010 is
// a registered vehicle at both mock sources and EXAMPLESON / SAMPLE a person at the state source,
// and neither matches a keyword, so no card is critical. Synthetic data only (spec 5.4).

test.use({ reducedMotion: "reduce", viewport: { width: 1366, height: 768 }, emptyQueryList: true });

async function runTyped(page: Page, command: string): Promise<void> {
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await expect(page.locator("input:focus, textarea:focus")).toHaveCount(0);
  await page.keyboard.press("Slash");
  await expect(page.getByRole("textbox", { name: "Command" })).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

test("[demo] VEH.ZZ-0010 is a calm vehicle hit: REGISTERED on both sources, nothing critical", async ({
  page,
}) => {
  await runTyped(page, "VEH.ZZ-0010");
  for (const name of ["State system: returned", "National system: returned"]) {
    const card = page.getByRole("region", { name });
    await expect(card).toBeVisible({ timeout: 8000 });
    await expect(card).toContainText("REGISTERED");
    await expect(card).not.toHaveClass(/qm-card--critical/);
    await expect(card.locator(".qm-badge--critical")).toHaveCount(0);
    await expect(card.locator("mark")).toHaveCount(0);
  }
  await expect(page.getByRole("region", { name: "Requests this shift" })).not.toContainText(
    "Critical",
  );
});

test("[demo] PER.EXAMPLESON.SAMPLE.01011901 finds a person at the state source and nothing at the national one", async ({
  page,
}) => {
  await runTyped(page, "PER.EXAMPLESON.SAMPLE.01011901");
  const state = page.getByRole("region", { name: "State system: returned" });
  await expect(state).toBeVisible({ timeout: 8000 });
  await expect(state).toContainText("RECORD FOUND");
  await expect(state).toContainText("EXAMPLESON");
  await expect(state).not.toHaveClass(/qm-card--critical/);
  const national = page.getByRole("region", { name: "National system: returned" });
  await expect(national).toBeVisible({ timeout: 8000 });
  await expect(national).toContainText("NO RECORD");
});
