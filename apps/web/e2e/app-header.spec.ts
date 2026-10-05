import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseTheme, liveResponse, openAccountMenu, seededUser, signIn } from "./helpers.js";

// B1 app shell and header (docs/design/2026-09-29-visual-system.md, app shell): a 52 px bar with
// the Main nav and an account disclosure that holds the theme choice and sign out.
test.describe("B1 app header (dispatch layout)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("52 px bar, Queries is the current page, Status goes to /status and Queries back", async ({
    page,
  }) => {
    await signIn(page);
    const header = page.getByRole("banner");
    const box = await header.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(52);
    const nav = header.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Queries" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: "Status" }).click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(nav.getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Queries" }).click();
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test("the account disclosure opens, passes axe, changes theme, and Esc returns focus", async ({
    page,
  }) => {
    await signIn(page);
    const button = page.getByRole("banner").locator(".qm-account__button");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    // At rest the trigger is a ghost button: no border, no ring (the amber seen after Esc is the
    // focus ring, checked below).
    await expect(button).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await expect(button).toHaveCSS("outline-style", "none");
    const panel = await openAccountMenu(page);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("account-menu.png") });
    await expectNoSeriousAxeViolations(page);
    await chooseTheme(page, "night");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await openAccountMenu(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    // A theme choice is a saved preference: put it back and wait for the PUT to land.
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/v1/me/preferences") && r.request().method() === "PUT" && r.ok(),
    );
    await chooseTheme(page, "auto");
    await saved;
  });
});

// Persona flip (ruling): a newer config that changes the persona's layout swaps the header bar.
// Focus stays on the button for the same theme mode in the new bar, with no announcement.
test.describe("B1 theme focus survives a persona flip", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("focus on a theme button in the account menu lands on the same mode in the compact bar", async ({
    page,
  }) => {
    let flipped = false;
    await page.route("**/api/v1/config", async (route) => {
      const response = await liveResponse(route);
      const body = (await response.json()) as {
        configHash: string;
        personas: { layout: string }[];
      };
      if (flipped) {
        body.configHash = "d".repeat(64);
        for (const persona of body.personas) persona.layout = "mobileUnit";
      }
      await route.fulfill({ response, json: body });
    });
    await page.clock.install();
    await signIn(page);
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    const panel = await openAccountMenu(page);
    // Focus a mode without pressing it, so the focused mode is not the pressed one.
    const night = panel.getByRole("button", { name: "Night" });
    await night.focus();
    await expect(night).toBeFocused();

    flipped = true;
    await page.clock.fastForward(16_000);

    const banner = page.getByRole("banner");
    await expect(banner).toHaveClass(/qm-app-header--compact/);
    await expect(
      banner.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Night" }),
    ).toBeFocused();
    // Positive: the one announcement is the config update (nothing about the theme), the theme did
    // not change, and the focused mode is still not the pressed one (focus moved, the choice did not).
    await expect(page.getByTestId("announcer-polite")).toHaveText(
      /^The form was updated by your administrator\.\s*$/,
    );
    await expect(page.getByTestId("announcer-assertive")).toHaveText("");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "night");
    await expect(
      banner.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Night" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

// Header at 200% zoom (1366x768 at 200% is a 683x384 CSS viewport) and at 320 px: the bar keeps
// its one row where it fits, the account button shrinks to its avatar (still named by the email)
// instead of taking a second row, and nothing scrolls sideways. Officer targets stay 48 px.
const ROW = { dispatch: 52, compact: 64 } as const;

/** A site name at the 32ch cap: a message key with no translation renders as the key itself. */
const CAP_SITE_NAME = "site.thirtyTwoCharacterSiteNameX";

/** A longer site name than the seeded "Default site", so a squashed label shows up as truncation. */
async function useLongSiteName(page: Page, labelKey = "site.exampleOk"): Promise<void> {
  await page.route("**/api/v1/config", async (route) => {
    const response = await liveResponse(route);
    const body = (await response.json()) as { site: { labelKey: string } };
    body.site.labelKey = labelKey;
    await route.fulfill({ response, json: body });
  });
}

async function headerMetrics(page: Page) {
  return page.evaluate(async () => {
    // Fallback-font widths differ from Plex: measure after the fonts have loaded.
    await document.fonts.ready;
    const header = document.querySelector("header");
    const scroller = document.scrollingElement;
    const box = (el: Element) => el.getBoundingClientRect();
    const targets = [...(header?.querySelectorAll("a, button") ?? [])].flatMap((el) => {
      const b = box(el);
      return b.width === 0 || b.height === 0
        ? []
        : [
            {
              name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
              w: b.width,
              h: b.height,
            },
          ];
    });
    const account = header?.querySelector(".qm-account__button");
    const site = header?.querySelector(".qm-app-header__site");
    return {
      // The site name is either absent (officer bar) or shown in full: no ellipsis (WCAG 1.4.10).
      siteTruncated: site ? site.scrollWidth > site.clientWidth : false,
      siteWidth: site ? site.getBoundingClientRect().width : 0,
      height: header === null || header === undefined ? 0 : box(header).height,
      overflowX: scroller === null ? 0 : scroller.scrollWidth - scroller.clientWidth,
      accountRight: account === null || account === undefined ? 0 : box(account).right,
      accountWidth: account === null || account === undefined ? 0 : box(account).width,
      productNameWidth: (() => {
        const n = header?.querySelector(".qm-app-header__name");
        return n === null || n === undefined ? 0 : box(n).width;
      })(),
      themeButtons: [...(header?.querySelectorAll(".qm-seg button") ?? [])].map((el) => {
        const b = box(el);
        return { w: b.width, h: b.height };
      }),
      targets,
    };
  });
}

for (const { persona, email, row, minTarget } of [
  { persona: "dispatcher", email: "dispatcher@example.test", row: ROW.dispatch, minTarget: 36 },
  { persona: "admin", email: "admin@example.test", row: ROW.dispatch, minTarget: 36 },
  { persona: "officer", email: "officer@example.test", row: ROW.compact, minTarget: 48 },
] as const) {
  test.describe(`B1 header at 200% zoom and 320 px: ${persona}`, () => {
    test(`683x384: one ${row} px row, account named by the email, targets hold`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 683, height: 384 });
      await useLongSiteName(page);
      await signIn(page, seededUser(email));
      await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
      await expect(page.getByRole("button", { name: email })).toBeVisible();
      const m = await headerMetrics(page);
      expect(Math.round(m.height)).toBe(row);
      expect(m.overflowX).toBeLessThanOrEqual(0);
      // A long name may truncate here (the bar keeps its row) but stays readable, never a stub.
      expect(m.siteWidth === 0 || m.siteWidth >= 100).toBe(true);
      expect(m.accountRight).toBeLessThanOrEqual(683);
      if (persona === "officer") {
        // The officer bar's own rules (#482): no site name, the product name and the email hidden
        // but named, the account as its 48 px initial, the theme choice as 48 px icon squares.
        expect(m.siteWidth).toBe(0);
        expect(m.productNameWidth).toBeLessThanOrEqual(1);
        expect(m.accountWidth).toBeLessThan(120);
        expect(m.themeButtons.length).toBeGreaterThanOrEqual(2);
        for (const b of m.themeButtons) {
          expect(b.w).toBeGreaterThanOrEqual(minTarget - 0.5);
          expect(b.h).toBeGreaterThanOrEqual(minTarget - 0.5);
        }
      }
      for (const t of m.targets) {
        expect(t.w, `${t.name} width`).toBeGreaterThanOrEqual(minTarget - 0.5);
        expect(t.h, `${t.name} height`).toBeGreaterThanOrEqual(minTarget - 0.5);
      }
    });

    test("320 px: no sideways scroll, the account button stays on screen, targets hold", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await useLongSiteName(page);
      await signIn(page, seededUser(email));
      await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
      const m = await headerMetrics(page);
      expect(m.overflowX).toBeLessThanOrEqual(0);
      expect(m.siteTruncated).toBe(false);
      expect(m.accountRight).toBeLessThanOrEqual(320);
      for (const t of m.targets) {
        expect(t.w, `${t.name} width`).toBeGreaterThanOrEqual(minTarget - 0.5);
        expect(t.h, `${t.name} height`).toBeGreaterThanOrEqual(minTarget - 0.5);
      }
    });
  });
}

test("B1 header just above the shrink width: the widest bar (admin) is one row with the email shown", async ({
  page,
}) => {
  // 52rem = 832 px: the full account button returns, and the bar must still fit on one row.
  await page.setViewportSize({ width: 833, height: 600 });
  await signIn(page, seededUser("admin@example.test"));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  const m = await headerMetrics(page);
  expect(Math.round(m.height)).toBe(ROW.dispatch);
  expect(m.overflowX).toBeLessThanOrEqual(0);
  // The email text is in the button again, not clipped to the avatar.
  expect(m.accountWidth).toBeGreaterThan(120);
});

// #482: between the shrink width and about 1000 px a site name at its 32ch cap truncates instead of
// wrapping the widest bar (admin, full account button) to a second row.
for (const width of [833, 900, 960, 999]) {
  test(`B1 header at ${width} px with a 32ch site name: the admin bar keeps one row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await useLongSiteName(page, CAP_SITE_NAME);
    await signIn(page, seededUser("admin@example.test"));
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    await expect(page.getByTitle(CAP_SITE_NAME)).toBeVisible();
    const m = await headerMetrics(page);
    expect(Math.round(m.height)).toBe(ROW.dispatch);
    expect(m.overflowX).toBeLessThanOrEqual(0);
    expect(m.siteWidth).toBeGreaterThanOrEqual(100);
    expect(m.accountWidth).toBeGreaterThan(120);
  });
}
