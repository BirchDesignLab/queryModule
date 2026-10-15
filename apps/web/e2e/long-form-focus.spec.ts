import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// G13 (demo dry run): a long form (Property, Firearm) ends under the sticky action bar until it is
// scrolled. That is only acceptable if every field a person reaches by Tab, and the fields a blocked
// submit points at, are scrolled fully clear of the bar (WCAG 2.4.11 focus not obscured).

test.use({ emptyQueryList: true });

/** The viewport band a focused control must sit inside: below the top edge, above the bar. */
async function clearOfBar(page: Page, label: string): Promise<void> {
  const box = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const bar = document.querySelector<HTMLElement>(".qm-action-bar");
    if (el === null || bar === null) return null;
    // The bar's own controls (Run query, Clear) are the bar: never "under" it.
    if (bar.contains(el)) return { top: 0, bottom: 0, barTop: 1 };
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, barTop: bar.getBoundingClientRect().top };
  });
  expect(box, label).not.toBeNull();
  expect(box?.top, `${label}: top`).toBeGreaterThanOrEqual(0);
  expect(box?.bottom, `${label}: bottom clear of the bar`).toBeLessThanOrEqual(box?.barTop ?? 0);
}

async function openFirearmForm(page: Page): Promise<void> {
  await signIn(page, seededUser("dispatcher@example.test"));
  await page.getByRole("button", { name: "Form mode" }).click();
  await page
    .getByRole("button", { name: /Property/ })
    .first()
    .click();
  await page.getByRole("radio", { name: "Firearm" }).check({ force: true, timeout: 10_000 });
}

for (const [width, height] of [
  [1366, 768],
  [1024, 768],
] as const) {
  test.describe(`${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("Tab through the Firearm form keeps every focused control clear of the action bar", async ({
      page,
    }) => {
      await openFirearmForm(page);
      await page.getByLabel("Serial number").focus();
      let reachedCaliber = false;
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        const name = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el?.getAttribute("aria-label") ?? el?.id ?? el?.textContent ?? "";
        });
        await clearOfBar(page, `Tab ${i + 1} (${name.slice(0, 30)})`);
        const label = await page.evaluate(
          () => (document.activeElement as HTMLInputElement | null)?.labels?.[0]?.textContent ?? "",
        );
        if (label.startsWith("Caliber")) reachedCaliber = true;
        const onRun = await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.textContent?.startsWith("Run query"),
        );
        if (onRun === true) break;
      }
      expect(reachedCaliber, "Tab reached Caliber").toBe(true);
    });

    test("a blocked submit leaves Make and Caliber, with their messages, clear of the bar", async ({
      page,
    }) => {
      await openFirearmForm(page);
      await page.getByLabel("Serial number").fill("ZZ123");
      await page.getByRole("button", { name: /Run query/ }).click();
      await expect(page.getByText("Caliber is required.")).toBeVisible();
      await clearOfBar(page, "focused first invalid field");
      const bar = await page
        .locator(".qm-action-bar")
        .evaluate((el) => el.getBoundingClientRect().top);
      for (const message of ["Make is required.", "Caliber is required."]) {
        const bottom = await page
          .getByText(message)
          .evaluate((el) => el.getBoundingClientRect().bottom);
        expect(bottom, message).toBeLessThanOrEqual(bar);
      }
    });
  });
}
