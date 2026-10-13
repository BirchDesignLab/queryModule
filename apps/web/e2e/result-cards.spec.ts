import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { ThemeMode } from "@querymodule/tokens";
import { expect, test } from "./fixtures.js";
import { chooseTheme, seededUser, signIn } from "./helpers.js";

// Result cards in the request list, mounted for real (FR-060, UX-010, UX-015; spec 6.2, 6.3, 6.5).
// The local build serves mock sources, so ZZ-0001 is a canned STOLEN vehicle at both sources. The
// officer layout is checked at 1024x768 and the colour contrast of the badge, the keyword mark and
// the severity edge in the two dark themes (Night and Red shift). Synthetic data only (spec 5.4).

test.use({ reducedMotion: "reduce", viewport: { width: 1024, height: 768 } });

async function runStolenPlate(page: Page): Promise<void> {
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  // A year makes it a full query, so both sources are dispatched.
  await page.getByLabel("Year", { exact: true }).fill("26");
  const plate = page.getByLabel("Plate", { exact: true });
  await plate.fill("ZZ-0001");
  await plate.press("Enter");
  await expect(page.getByRole("region", { name: "State system: returned" })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.getByRole("region", { name: "National system: returned" })).toBeVisible({
    timeout: 8000,
  });
}

for (const mode of ["night", "redShift"] as const satisfies readonly ThemeMode[]) {
  test(`${mode}: the officer's result card is laid out for touch and passes colour contrast`, async ({
    page,
  }) => {
    await page.context().clearCookies();
    await signIn(page, seededUser("officer@example.test"));
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/v1/me/preferences") && r.request().method() === "PUT" && r.ok(),
    );
    await chooseTheme(page, mode);
    await saved;
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    try {
      await runStolenPlate(page);
      const card = page.getByRole("region", { name: "State system: returned" });
      const look = await card.evaluate((el) => {
        const dd = el.querySelector("dd");
        const dt = el.querySelector("dt");
        const list = el.querySelector("dl");
        if (dd === null || dt === null || list === null) throw new Error("no summary grid");
        const pick = (node: Element) => {
          const s = getComputedStyle(node);
          return { size: s.fontSize, family: s.fontFamily, color: s.color };
        };
        return {
          dd: pick(dd),
          dt: pick(dt),
          columns: getComputedStyle(list).gridTemplateColumns.split(" ").length,
          edge: getComputedStyle(el).borderInlineStartWidth,
          body: getComputedStyle(document.body).color,
        };
      });
      // Officer values 20 px mono, labels 16 px in the body colour (no muted text), two columns.
      expect(look.dd.size).toBe("20px");
      expect(look.dd.family.toLowerCase()).toContain("mono");
      expect(look.dt.size).toBe("16px");
      expect(look.dt.color).toBe(look.body);
      expect(look.columns).toBe(2);
      expect(look.edge).toBe("4px");

      // Colour contrast, explicitly: the badge, the keyword mark and the card on this theme.
      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" "))}`),
      ).toEqual([]);
    } finally {
      await page.goto("/");
      await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
      const reset = page.waitForResponse(
        (r) =>
          r.url().includes("/api/v1/me/preferences") && r.request().method() === "PUT" && r.ok(),
      );
      await chooseTheme(page, "auto");
      await reset;
    }
  });
}

// Results keyboard (UX-015; spec 6.4): arrows move the selected request, a new request leaves the selection
// on the same request. Enter's detail toggle is covered in the web-ui tests: the default config
// maps no detail row yet, so no card has a toggle here.
test("arrow keys move between requests and an incoming request keeps the selection", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await page.getByLabel("Year", { exact: true }).fill("26");
  const plate = page.getByLabel("Plate", { exact: true });
  await plate.fill("ZZ-0001");
  await plate.press("Enter");
  await expect(page.getByRole("region", { name: "State system: returned" })).toBeVisible({
    timeout: 8000,
  });
  await plate.fill("ZZ-0002");
  await plate.press("Enter");
  const rows = page.getByRole("region", { name: "Requests this shift" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).focus();
  await expect(rows.nth(1)).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  // A third request arrives on top (typing took focus to the form): the selection stays on the
  // same request, now third.
  await plate.fill("ZZ-0003");
  await plate.press("Enter");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toHaveAttribute("tabindex", "0");
  // The after-each axe run (fixtures.ts) covers serious and critical violations on the final page.
});
