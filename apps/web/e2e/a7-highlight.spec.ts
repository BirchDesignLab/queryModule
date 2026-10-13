import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";
import { type ClientMapping, serveMappings } from "./mapped-config.js";

// A7 (FR-060, UX-010, UX-011, UX-016; spec 10.2, 10.6): a result with a critical keyword shows a
// critical card, the keyword is marked in words and a marker (never colour alone), and a keyword
// found only in a detail path still badges the summary card. Officer layout, 1024x768, keyboard
// only. ZZ-0001 is a canned STOLEN vehicle at both mock sources.

test.use({ reducedMotion: "reduce", viewport: { width: 1024, height: 768 } });

async function runStolen(page: Page): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, seededUser("officer@example.test"));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await page.getByLabel("Year", { exact: true }).fill("26");
  const plate = page.getByLabel("Plate", { exact: true });
  await plate.focus();
  await page.keyboard.type("ZZ-0001");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "State system: returned" })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.getByRole("region", { name: "National system: returned" })).toBeVisible({
    timeout: 8000,
  });
}

test("[A7] ZZ-0001 shows critical cards with STOLEN marked by a marker, not colour alone", async ({
  page,
}) => {
  await runStolen(page);
  for (const name of ["State system: returned", "National system: returned"]) {
    const card = page.getByRole("region", { name });
    await expect(card).toHaveClass(/qm-card--critical/);
    await expect(card.locator(".qm-badge--critical")).toContainText("Critical");
    // The mark: the word, a visible marker and a hidden severity for assistive tech.
    const mark = card.locator("mark", { hasText: "STOLEN" }).first();
    await expect(mark).toBeVisible();
    await expect(mark.locator(".qm-mark__marker")).toHaveText("!!");
    await expect(mark).toContainText("(critical)");
    await expect(mark.locator("svg")).toHaveCount(1);
  }
  await expectNoSeriousAxeViolations(page);
});

test("[A7] a STOLEN only in a detail-only path still badges the summary card", async ({ page }) => {
  // The vehicle card keeps the plate in its summary and moves the remarks (STOLEN VEHICLE) to detail.
  await serveMappings(
    page,
    (mappings) =>
      mappings.map(
        (m): ClientMapping =>
          m.id === "veh-summary"
            ? {
                ...m,
                elements: [
                  {
                    kind: "value",
                    path: "plate",
                    labelKey: "field.plate",
                    view: "summary",
                    highlight: false,
                  },
                  { kind: "value", path: "remarks", labelKey: "e2e.remarks", view: "detail" },
                ],
              }
            : m,
      ),
    { "e2e.remarks": "Remarks" },
  );
  await runStolen(page);
  const card = page.getByRole("region", { name: "National system: returned" });
  // The summary shows no keyword mark, and the badge still says Critical.
  await expect(card.locator("mark")).toHaveCount(0);
  await expect(card.locator(".qm-badge--critical")).toContainText("Critical");
  await expect(card).toHaveClass(/qm-card--critical/);
  const toggle = card.getByRole("button", { name: / detail/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("mark", { hasText: "STOLEN" }).first()).toBeVisible();
  await expect(toggle).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});
