import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseQueryType, seededUser, signIn } from "./helpers.js";
import { type ClientMapping, serveMappings } from "./mapped-config.js";

// A8 (FR-060, UX-015, UX-016; spec 6.2, 10.2): a configured response mapping decides what a card
// shows. Summary elements, the detail toggle, a clean no-record result, a warrants table, the
// generic dump when no mapping applies, and focus and value kept while cards arrive. Officer layout
// at 1024x768, keyboard only. The default site maps no detail rows and DL with `dl-summary`, so the
// specs that need those serve their own client mappings (ruling 10-13-26, option b); the shipped
// default.json is never edited. Synthetic mock data only (spec 5.4).

test.use({ reducedMotion: "reduce", viewport: { width: 1024, height: 768 } });

async function officer(page: Page): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, seededUser("officer@example.test"));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

async function submitPlate(page: Page, plate: string, year = "26"): Promise<void> {
  if (year !== "") await page.getByLabel("Year", { exact: true }).fill(year);
  const field = page.getByLabel("Plate", { exact: true });
  await field.focus();
  await page.keyboard.type(plate);
  await page.keyboard.press("Enter");
}

const card = (page: Page, source: string) =>
  page.getByRole("region", { name: `${source}: returned` });

test("[A8] the mapped summary shows its elements, labelled, with the keyword marked", async ({
  page,
}) => {
  await officer(page);
  await submitPlate(page, "ZZ-0001");
  const state = card(page, "State system");
  await expect(state).toBeVisible({ timeout: 8000 });
  const items = state.locator(".qm-result-list__item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator("dt")).toHaveText("Status");
  await expect(items.nth(0).locator("dd")).toContainText("STOLEN");
  await expect(items.nth(0).locator("mark")).toHaveCount(1);
  await expect(items.nth(1).locator("dt")).toHaveText("Plate");
  // The plate is not highlighted: plain text, no mark.
  await expect(items.nth(1).locator("dd")).toHaveText("ZZ-0001");
  await expect(items.nth(1).locator("mark")).toHaveCount(0);
  // The default mapping has no detail row, so there is no toggle and no payload dump.
  await expect(state.getByRole("button")).toHaveCount(0);
  await expect(state).not.toContainText("TESTMAKE");
  await expectNoSeriousAxeViolations(page);
});

test("[A8] the detail toggle opens and closes by keyboard, keeps focus, and is a 48 px target", async ({
  page,
}) => {
  await serveMappings(
    page,
    (mappings) =>
      mappings.map(
        (m): ClientMapping =>
          m.id === "veh-summary"
            ? {
                ...m,
                elements: [
                  ...(m.elements as unknown[]),
                  { kind: "value", path: "vehicle.make", labelKey: "e2e.make", view: "detail" },
                  { kind: "value", path: "owner.last", labelKey: "e2e.owner", view: "detail" },
                ],
              }
            : m,
      ),
    { "e2e.make": "Make", "e2e.owner": "Owner last name" },
  );
  await officer(page);
  await submitPlate(page, "ZZ-0001");
  const state = card(page, "State system");
  await expect(state).toBeVisible({ timeout: 8000 });
  const toggle = state.getByRole("button", { name: / detail/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("2 more items");
  const box = await toggle.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  await expect(state).not.toContainText("TESTMAKE");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(state).toContainText("Make");
  await expect(state).toContainText("TESTMAKE");
  await expect(state).toContainText("TESTERSON");
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(state).not.toContainText("TESTMAKE");
  await expect(toggle).toBeFocused();
});

test("[A8] ABC123 is a clean no-record result: an info card in words and a marker", async ({
  page,
}) => {
  await officer(page);
  await submitPlate(page, "ABC123");
  for (const source of ["State system", "National system"]) {
    const c = card(page, source);
    await expect(c).toBeVisible({ timeout: 8000 });
    await expect(c).toHaveClass(/qm-card--info/);
    await expect(c.locator(".qm-badge--info")).toContainText("Info");
    const mark = c.locator("mark", { hasText: "NO RECORD" }).first();
    await expect(mark.locator(".qm-mark__marker")).toHaveText("i");
    await expect(c.locator(".qm-badge--critical, .qm-mark--critical")).toHaveCount(0);
  }
  await expectNoSeriousAxeViolations(page);
});

test("[A8] a WANTED result shows its warrants as a labelled table in the detail", async ({
  page,
}) => {
  await serveMappings(
    page,
    (mappings) =>
      mappings.map(
        (m): ClientMapping =>
          m.id === "wnt-summary"
            ? {
                ...m,
                elements: [
                  ...(m.elements as unknown[]),
                  {
                    kind: "table",
                    path: "warrants",
                    labelKey: "e2e.warrants",
                    view: "detail",
                    columns: [
                      { path: "offense", labelKey: "e2e.offense" },
                      { path: "issued", labelKey: "e2e.issued" },
                    ],
                  },
                ],
              }
            : m,
      ),
    { "e2e.warrants": "Warrants", "e2e.offense": "Offense", "e2e.issued": "Issued" },
  );
  await officer(page);
  await chooseQueryType(page, "WNT");
  const last = page.getByLabel("Last name");
  await last.focus();
  await page.keyboard.type("WANTED");
  await page.keyboard.press("Enter");
  const national = card(page, "National system");
  await expect(national).toBeVisible({ timeout: 8000 });
  await expect(national).toHaveClass(/qm-card--critical/);
  await expect(national.locator("mark", { hasText: "WANTED" }).first()).toBeVisible();
  const toggle = national.getByRole("button", { name: / detail/ });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const region = national.getByRole("region", { name: /Warrants/ });
  await expect(region).toHaveAttribute("tabindex", "0");
  const table = region.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Offense", "Issued"]);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("cell").first()).toHaveText("FAILURE TO APPEAR");
  await expectNoSeriousAxeViolations(page);
});

test("[A8] a result with no mapping shows every field under its path, with no toggle", async ({
  page,
}) => {
  // The shipped default maps DL (dl-summary); this client config drops it, so the card is the generic dump.
  await serveMappings(page, (mappings) => mappings.filter((m) => m.queryType !== "DL"));
  await officer(page);
  await chooseQueryType(page, "DL");
  const number = page.getByLabel("License number");
  await number.focus();
  await page.keyboard.type("ZZ1234");
  await page.keyboard.press("Enter");
  const state = card(page, "State system");
  await expect(state).toBeVisible({ timeout: 8000 });
  await expect(state).toContainText("No card is set up for this result");
  const item = state.locator(".qm-result-list--paths .qm-result-list__item").first();
  await expect(item.locator("dt")).toHaveText("status");
  await expect(item.locator("dd")).toContainText("NO RECORD");
  await expect(state.getByRole("button")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
});

test("[A8] typing in Plate while cards arrive keeps focus and value", async ({ page }) => {
  await officer(page);
  await submitPlate(page, "ZZ-0001");
  const field = page.getByLabel("Plate", { exact: true });
  await field.press("Control+A");
  await field.pressSequentially("ABC", { delay: 250 });
  await expect(card(page, "State system")).toBeVisible({ timeout: 8000 });
  await expect(card(page, "National system")).toBeVisible({ timeout: 8000 });
  await field.pressSequentially("123", { delay: 100 });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("ABC123");
  await expectNoSeriousAxeViolations(page);
});
