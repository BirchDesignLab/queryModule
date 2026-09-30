import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { COLOR_TOKENS, type ThemeMode, tokenValue } from "@querymodule/tokens";
import { expect, test } from "./fixtures.js";
import { chooseTheme, hexToRgb, openAccountMenu, seededUser, signIn } from "./helpers.js";

// D0.4 visual regression baseline (design system plan, docs/design/2026-09-29-visual-system.md).
//
// Pixel images are not asserted: Chromium rasterises text differently on Windows and Linux, so a
// baseline made on one machine fails on the other (CI runs Linux). What a screenshot would catch is
// asserted here as numbers a browser resolves the same everywhere: the tokens each theme applies,
// the fonts that load from the built app, control heights per persona (E1, density), the focus and
// invalid styles together, and no horizontal overflow, on every screen at both viewports and in all
// three themes. Set E2E_SCREENSHOT_DIR to also write a PNG per screen for review (not asserted).

// Reduced motion: the tokens drop to 0 ms, so a screenshot or a computed style never catches a
// colour mid-transition (a theme switch eases background-color over 120 ms).
test.use({ reducedMotion: "reduce" });

const MODES = ["day", "night", "redShift"] as const satisfies readonly ThemeMode[];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

const rgb = (mode: ThemeMode, token: keyof typeof COLOR_TOKENS): string =>
  hexToRgb(COLOR_TOKENS[token][mode]);

async function setTheme(page: Page, mode: ThemeMode): Promise<void> {
  await chooseTheme(page, mode);
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}

/**
 * Signs in as `email`, sets the theme, runs `body`, then puts the stored theme back to "Match
 * system" (a theme choice is a saved preference) and drops the session for the next screen.
 */
async function asUser(
  page: Page,
  email: string,
  mode: ThemeMode,
  body: () => Promise<void>,
): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, seededUser(email));
  await panelReady(page);
  await saveTheme(page, () => setTheme(page, mode));
  try {
    await body();
  } finally {
    await page.goto("/");
    await panelReady(page);
    await saveTheme(page, () => chooseTheme(page, "auto"));
  }
}

/** A signed-in theme change saves the preference in the background: wait for that PUT to land. */
async function saveTheme(page: Page, choose: () => Promise<unknown>): Promise<void> {
  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/v1/me/preferences") && r.request().method() === "PUT" && r.ok(),
  );
  await choose();
  await saved;
}

async function panelReady(page: Page): Promise<void> {
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

/** Page and main overflow horizontally by this many pixels (0 when neither does). */
async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.scrollingElement;
    const main = document.querySelector("main");
    return Math.max(
      el === null ? 0 : el.scrollWidth - el.clientWidth,
      main === null ? 0 : main.scrollWidth - main.clientWidth,
    );
  });
}

async function capture(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (dir === undefined || dir === "") return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

/** A crop around one element (with a margin for its focus ring), for E1 review. */
async function captureCrop(page: Page, target: Locator, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (dir === undefined || dir === "") return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  const box = await target.boundingBox();
  if (box === null) return;
  const m = 16;
  await page.screenshot({
    path: join(dir, `${name}.png`),
    clip: {
      x: Math.max(0, box.x - m),
      y: Math.max(0, box.y - m),
      width: box.width + 2 * m,
      height: box.height + 2 * m,
    },
  });
}

test.describe("D0 tokens and fonts reach the browser", () => {
  for (const mode of MODES) {
    test(`${mode}: every colour token is the CSS variable the design system declares`, async ({
      page,
    }) => {
      await page.goto("/");
      await setTheme(page, mode);
      const names = Object.keys(COLOR_TOKENS).map((token) => `--qm-${token.replaceAll(".", "-")}`);
      const applied = await page.evaluate((cssNames) => {
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(cssNames.map((n) => [n, style.getPropertyValue(n).trim()]));
      }, names);
      for (const [token, values] of Object.entries(COLOR_TOKENS)) {
        const cssName = `--qm-${token.replaceAll(".", "-")}`;
        // A minified stylesheet writes #ffffff as #fff: compare as colours.
        expect(hexToRgb(applied[cssName] ?? ""), `${mode} ${cssName}`).toBe(hexToRgb(values[mode]));
      }
      // The focus ring is never the invalid colour, in any mode (E1).
      expect(hexToRgb(applied["--qm-focus-ring"] ?? "")).not.toBe(
        hexToRgb(applied["--qm-field-required"] ?? ""),
      );
    });
  }

  test("IBM Plex loads from the built app: Sans 400 500 600, Condensed 600, Mono 400 500", async ({
    page,
  }) => {
    await signIn(page);
    await panelReady(page);
    const faces = [
      '400 16px "IBM Plex Sans"',
      '500 16px "IBM Plex Sans"',
      '600 16px "IBM Plex Sans"',
      '600 16px "IBM Plex Sans Condensed"',
      '400 16px "IBM Plex Mono"',
      '500 16px "IBM Plex Mono"',
    ];
    const loaded = await page.evaluate(
      async (specs) => Promise.all(specs.map(async (s) => (await document.fonts.load(s)).length)),
      faces,
    );
    expect(loaded, "each face resolves to exactly one loaded font file").toEqual(
      faces.map(() => 1),
    );
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily))
      .toMatch(/^"?IBM Plex Sans"?,/);
  });
});

test.describe("D0.3 dispatcher density and E1 focus with invalid (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const mode of MODES) {
    test(`${mode}: focus ring outside a red invalid edge, both visible, 36 px controls`, async ({
      page,
    }) => {
      await asUser(page, "dispatcher@example.test", mode, async () => {
        await page.keyboard.press("Alt+Digit2");
        await page.getByRole("button", { name: "Person", exact: true }).focus();
        await page.keyboard.press("Control+Enter");
        const last = page.getByLabel("Last name");
        await expect(last).toHaveAttribute("aria-invalid", "true");
        await expect(last).toBeFocused();
        // The edge eases in over the fast motion duration; read it once it has settled.
        await expect
          .poll(() => last.evaluate((el) => getComputedStyle(el).borderTopColor))
          .toBe(rgb(mode, "field.required"));

        const style = await last.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            outlineColor: s.outlineColor,
            outlineWidth: s.outlineWidth,
            outlineStyle: s.outlineStyle,
            outlineOffset: s.outlineOffset,
            borderColor: s.borderTopColor,
            boxShadow: s.boxShadow,
            height: el.getBoundingClientRect().height,
          };
        });
        expect(style.outlineStyle).toBe("solid");
        expect(style.outlineWidth).toBe("2px");
        expect(style.outlineOffset).toBe("2px");
        expect(style.outlineColor).toBe(rgb(mode, "focus.ring"));
        expect(style.borderColor).toBe(rgb(mode, "field.required"));
        expect(style.boxShadow).toContain(rgb(mode, "field.required"));
        expect(style.boxShadow).toContain("inset");
        expect(style.outlineColor).not.toBe(style.borderColor);
        expect(Math.round(style.height)).toBe(36);
        await captureCrop(page, last, `e1-invalid-focused-${mode}`);
      });
    });
  }

  test("a select and a button are the 36 px dense height; an aria-disabled button stays focusable", async ({
    page,
  }) => {
    await signIn(page, seededUser("dispatcher@example.test"));
    await panelReady(page);
    const heights = await page.evaluate(() => {
      const h = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
      return { input: h("main .qm-field__input"), submit: h("main button[type=submit]") };
    });
    expect(Math.round(heights.input)).toBe(36);
    expect(Math.round(heights.submit)).toBe(36);
    const submit = page.locator("main button[type=submit]");
    await submit.focus();
    await expect(submit).toBeFocused();
  });
});

/** Elements with text whose colour is exactly `color` (an rgb() string), under `root`, as "tag.class: text". */
const textInColor = (page: Page, root: string, color: string): Promise<string[]> =>
  page.evaluate(
    ([rootSel, rgbColor]) =>
      [...document.querySelectorAll(`${rootSel} *`)]
        .filter(
          (el) =>
            // Text that is not rendered (display: none) is neither seen nor read.
            el.getClientRects().length > 0 &&
            [...el.childNodes].some(
              (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
            ) &&
            getComputedStyle(el).color === rgbColor,
        )
        .map(
          (el) => `${el.tagName.toLowerCase()}.${el.className}: ${(el.textContent ?? "").trim()}`,
        ),
    [root, color] as const,
  );

test.describe("D0.3 officer touch density (1024x768)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  for (const mode of MODES) {
    test(`${mode}: controls are 56 px, the header's buttons 48 px, no muted text, and E1`, async ({
      page,
    }) => {
      await asUser(page, "officer@example.test", mode, async () => {
        await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(1);
        const sizes = await page.evaluate(() => {
          const h = (sel: string) =>
            document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
          return {
            input: h(".qm-layout--mobile-unit .qm-field__input"),
            submit: h(".qm-layout--mobile-unit button[type=submit]"),
            headerButton: h(".qm-app-header--compact .qm-button"),
          };
        });
        expect(Math.round(sizes.input)).toBeGreaterThanOrEqual(56);
        expect(Math.round(sizes.submit)).toBeGreaterThanOrEqual(56);
        expect(Math.round(sizes.headerButton)).toBeGreaterThanOrEqual(48);
        const muted = rgb(mode, "color.text.muted");
        expect(
          await textInColor(page, ".qm-layout--mobile-unit", muted),
          "officer muted text",
        ).toEqual([]);
        // E1 at touch density (no sign-in of its own: the suite stays under the auth rate limit).
        await page.getByRole("button", { name: "Person", exact: true }).click();
        await page.getByRole("button", { name: "Run query" }).click();
        const last = page.getByLabel("Last name");
        await expect(last).toHaveAttribute("aria-invalid", "true");
        await expect(last).toBeFocused();
        await expect
          .poll(() => last.evaluate((el) => getComputedStyle(el).borderTopColor))
          .toBe(rgb(mode, "field.required"));
        const e1 = await last.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}`,
            outlineColor: s.outlineColor,
            boxShadow: s.boxShadow,
            height: el.getBoundingClientRect().height,
          };
        });
        expect(e1.outline).toBe("solid 2px 2px");
        expect(e1.outlineColor).toBe(rgb(mode, "focus.ring"));
        expect(e1.boxShadow).toContain(rgb(mode, "field.required"));
        expect(e1.boxShadow).toContain("inset");
        expect(Math.round(e1.height)).toBeGreaterThanOrEqual(56);
        await captureCrop(page, last, `e1-officer-invalid-focused-${mode}`);
        // The bar sits outside the layout: scan it with the account disclosure open.
        await openAccountMenu(page);
        expect(
          await textInColor(page, ".qm-app-header--compact", muted),
          "officer bar muted text",
        ).toEqual([]);
      });
    });
  }

  for (const mode of MODES) {
    test(`${mode}: tiles are 88 px in one row, Run is 64 px, and the last request sits under the card`, async ({
      page,
    }) => {
      await asUser(page, "officer@example.test", mode, async () => {
        const tiles = await page
          .locator(".qm-layout--mobile-unit .qm-quick-access button")
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
        expect(tiles.length).toBeGreaterThanOrEqual(3);
        expect(new Set(tiles.map((r) => Math.round(r.top))).size, "one row").toBe(1);
        for (const r of tiles) expect(Math.round(r.height)).toBeGreaterThanOrEqual(88);
        const run = await page.locator(".qm-layout--mobile-unit button[type=submit]").boundingBox();
        expect(Math.round(run?.height ?? 0)).toBe(64);
        await capture(page, `officer-1024x768-${mode}-top`);

        await page.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
        const sent = page.waitForResponse(
          (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Run query" }).click();
        expect((await sent).status()).toBe(202);
        const ack = page.locator(".qm-layout--mobile-unit .qm-requests");
        await expect(ack).toBeVisible();
        const [card, ackBox] = await Promise.all([
          page.locator(".qm-layout--mobile-unit .qm-panel__body").boundingBox(),
          ack.boundingBox(),
        ]);
        expect(ackBox?.y ?? 0).toBeGreaterThan((card?.y ?? 0) + (card?.height ?? 0));
        expect(await overflowX(page), "officer after a run").toBeLessThanOrEqual(0);
        expect(
          await textInColor(page, ".qm-layout--mobile-unit", rgb(mode, "color.text.muted")),
          "officer muted text after a run",
        ).toEqual([]);
        await capture(page, `officer-1024x768-${mode}-ack`);
      });
    });
  }

  test("the muted check is live: a .qm-tag in the dispatch layout is muted, the same tag in the officer layout is not", async ({
    page,
  }) => {
    const probe = () =>
      page.evaluate(() => {
        const layout =
          document.querySelector(".qm-layout--mobile-unit") ?? document.querySelector("main");
        const tag = document.createElement("span");
        tag.className = "qm-tag";
        tag.textContent = "probe";
        layout?.append(tag);
        const color = getComputedStyle(tag).color;
        tag.remove();
        return color;
      });
    await asUser(page, "dispatcher@example.test", "night", async () => {
      expect(await probe()).toBe(rgb("night", "color.text.muted"));
    });
    await asUser(page, "officer@example.test", "night", async () => {
      expect(await probe()).toBe(rgb("night", "color.text.body"));
    });
  });
});

test.describe("B3 dispatcher requests list beside the panel (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const mode of MODES) {
    test(`${mode}: two panes, rows with text status, the copy button 36 px, no overflow`, async ({
      page,
    }) => {
      await asUser(page, "dispatcher@example.test", mode, async () => {
        const plate = page.getByLabel("Plate", { exact: true });
        for (const value of ["ZZ-0001", "ZZ-0002"]) {
          await plate.fill(value);
          const sent = page.waitForResponse(
            (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
          );
          await plate.press("Enter");
          expect((await sent).status()).toBe(202);
        }
        const list = page.getByRole("region", { name: "Requests this shift" });
        await expect(list.getByRole("listitem")).toHaveCount(2);
        await expect(list.getByText("Acknowledged")).toHaveCount(2);
        const [panel, pane] = await Promise.all([
          page.locator(".qm-panes__panel").boundingBox(),
          list.boundingBox(),
        ]);
        expect(pane?.x ?? 0).toBeGreaterThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0));
        expect(Math.round(panel?.width ?? 0)).toBeLessThanOrEqual(640);
        const copy = await list
          .getByRole("button", { name: /^Copy reference / })
          .first()
          .boundingBox();
        expect(Math.round(copy?.height ?? 0)).toBeGreaterThanOrEqual(36);
        expect(await overflowX(page), "dispatcher with requests").toBeLessThanOrEqual(0);
        await capture(page, `dispatcher-1440x900-${mode}-requests`);
      });
    });
  }
});

test.describe("D0 must-fixes from the design review (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const mode of MODES) {
    test(`${mode}: the primary button is the accent fill, on the login and the panel`, async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await setTheme(page, mode);
      const signInButton = page.getByRole("button", { name: "Sign in" });
      await expect(signInButton).toHaveCSS("background-color", rgb(mode, "color.accent.fill"));
      await expect(signInButton).toHaveCSS("color", rgb(mode, "color.accent.onFill"));
      await asUser(page, "dispatcher@example.test", mode, async () => {
        const submit = page.locator("main button[type=submit]");
        await expect(submit).toHaveCSS("background-color", rgb(mode, "color.accent.fill"));
        // The Default tag: an accent.subtle pill in uppercase, not a dashed outline.
        const tag = page.locator("main .qm-field__tag").first();
        await expect(tag).toHaveCSS("background-color", rgb(mode, "color.accent.subtle"));
        await expect(tag).toHaveCSS("text-transform", "uppercase");
        await expect(tag).toHaveCSS("border-top-style", "none");
      });
    });
  }

  test("headings that take focus draw no ring (login heading, admin section heading)", async ({
    page,
  }) => {
    await page.goto("/");
    const signIn = page.getByRole("heading", { name: "Sign in" });
    await expect(signIn).toBeFocused();
    await expect(signIn).toHaveCSS("outline-style", "none");
    await asUser(page, "admin@example.test", "night", async () => {
      await page.goto("/admin/config");
      const section = page.getByRole("heading", { name: "Site configuration" });
      await expect(section).toBeFocused();
      await expect(section).toHaveCSS("outline-style", "none");
    });
  });

  test("an unavailable admin button (Publish, History) has the disabled look, not the primary fill", async ({
    page,
  }) => {
    await asUser(page, "admin@example.test", "night", async () => {
      await page.goto("/admin/config");
      await expect(page.getByRole("heading", { name: "Site configuration" })).toBeVisible();
      for (const name of ["Publish", "History"]) {
        const button = page.getByRole("button", { name });
        await expect(button, name).toHaveCSS("border-top-style", "dashed");
        await expect(button, name).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(button, name).toHaveCSS("color", rgb("night", "color.text.muted"));
      }
    });
  });
});

test.describe("A3 builder editors in plain language (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const mode of MODES) {
    test(`${mode}: a rule reads as a sentence in body text on the sunken surface; Advanced is closed`, async ({
      page,
    }) => {
      await asUser(page, "admin@example.test", mode, async () => {
        await page.goto("/admin/config");
        const tree = page.getByRole("navigation", { name: "Configuration items" });
        await tree.getByRole("button", { name: /^Property PRO/ }).click();
        // The rule's own fieldset: the legend's parent (the type's fieldset holds it too).
        const rule = page.locator("legend", { hasText: /^Rule 1$/ }).locator("xpath=..");
        const sentence = rule.locator(":scope > .qm-rule__sentence");
        await expect(sentence).toHaveText(
          "Show Make when Property type is one of Firearm, Electronics.",
        );
        await sentence.scrollIntoViewIfNeeded();
        await expect(sentence).toHaveCSS("color", rgb(mode, "color.text.body"));
        await expect(sentence).toHaveCSS("background-color", rgb(mode, "color.surface.sunken"));
        const advanced = page.locator(".qm-admin__item .qm-advanced").first();
        await expect(advanced).not.toHaveAttribute("open");
        expect(await overflowX(page), "builder editor").toBeLessThanOrEqual(0);
        await captureCrop(page, rule, `a3-rule-${mode}`);
      });
    });
  }
});

test.describe("A4 builder preview: persona switch and states (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const mode of MODES) {
    test(`${mode}: Officer in the preview pane has 88 px tiles and a 64 px Run without sideways scroll; Dispatcher stays dense`, async ({
      page,
    }) => {
      await asUser(page, "admin@example.test", mode, async () => {
        await page.goto("/admin/config");
        const preview = page.getByRole("region", { name: "Live preview" });
        const run = preview.getByRole("button", { name: "Run query" });
        await expect(run).toBeVisible();
        expect(Math.round((await run.boundingBox())?.height ?? 0), "dispatcher Run").toBe(36);
        await preview.getByRole("button", { name: "Officer" }).click();
        const pane = await preview.boundingBox();
        expect(pane?.width ?? 0, "pane width").toBeGreaterThan(300);
        expect(Math.round((await run.boundingBox())?.height ?? 0), "officer Run").toBe(64);
        const tiles = await preview
          .locator(".qm-quick-access button")
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
        expect(tiles.length).toBeGreaterThanOrEqual(3);
        for (const r of tiles) expect(Math.round(r.height)).toBeGreaterThanOrEqual(88);
        // The preview scrolls inside its own pane: nothing pushes it wider than the pane.
        const over = await preview.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(over, "preview overflow").toBeLessThanOrEqual(0);
        await captureCrop(page, preview, `a4-preview-officer-${mode}`);
        await preview.getByRole("button", { name: "Dispatcher" }).click();
        expect(Math.round((await run.boundingBox())?.height ?? 0), "back to dispatcher").toBe(36);
      });
    });

    test(`${mode}: paused dims the last valid preview and keeps the banner in body text; focus stays where it was`, async ({
      page,
    }) => {
      await asUser(page, "admin@example.test", mode, async () => {
        await page.goto("/admin/config");
        await page.getByRole("tab", { name: "Raw JSON" }).click();
        const raw = page.getByRole("textbox", { name: "Draft JSON" });
        await raw.click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type("xx");
        const preview = page.getByRole("region", { name: "Live preview" });
        const banner = preview.locator(".qm-preview__banner");
        await expect(banner).toContainText("Preview paused: the JSON does not parse.");
        const panel = preview.locator(".qm-preview__panel");
        await expect(panel).toHaveAttribute("inert", "");
        await expect(panel).toHaveCSS("opacity", "0.55");
        await expect(banner).toHaveCSS("color", rgb(mode, "color.text.body"));
        await expect(banner).toHaveCSS("background-color", rgb(mode, "color.surface.raised"));
        // Nothing moved focus: the raw box still has it.
        await expect(raw).toBeFocused();
        await captureCrop(page, preview, `a4-preview-paused-${mode}`);
      });
    });
  }

  test("focus inside the preview when it pauses moves to the banner's Go to the error, in a real browser", async ({
    page,
  }) => {
    await asUser(page, "admin@example.test", "day", async () => {
      await page.goto("/admin/config");
      await page.getByRole("tab", { name: "Raw JSON" }).click();
      const preview = page.getByRole("region", { name: "Live preview" });
      const plate = preview.getByLabel("Plate", { exact: true });
      await plate.click();
      await expect(plate).toBeFocused();
      // The draft breaks from outside the preview: set the raw text without focusing its box.
      await page.getByRole("textbox", { name: "Draft JSON" }).evaluate((el) => {
        const box = el as HTMLTextAreaElement;
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        set?.call(box, `${box.value}xx`);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await expect(preview.locator(".qm-preview__banner")).toBeVisible();
      // A parse error has no Go to the error: the banner itself takes the focus.
      await expect(preview.locator(".qm-preview__banner")).toBeFocused();
    });
  });

  test("a site item shows the empty state and hides the panel", async ({ page }) => {
    await asUser(page, "admin@example.test", "day", async () => {
      await page.goto("/admin/config");
      const tree = page.getByRole("navigation", { name: "Configuration items" });
      await tree.getByRole("button", { name: /(^| )commands$/ }).click();
      const preview = page.getByRole("region", { name: "Live preview" });
      await expect(preview.getByText("Select a query type or field to preview it.")).toBeVisible();
      await expect(preview.locator(".qm-preview__panel")).toBeHidden();
    });
  });
});

test.describe("every screen, viewport and theme: no horizontal overflow", () => {
  for (const viewport of VIEWPORTS) {
    for (const mode of MODES) {
      test(`${viewport.width}x${viewport.height} ${mode}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const name = (screen: string) => `${screen}-${viewport.width}x${viewport.height}-${mode}`;

        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
        await setTheme(page, mode);
        expect(await overflowX(page), "login").toBeLessThanOrEqual(0);
        await capture(page, name("login"));

        await asUser(page, "dispatcher@example.test", mode, async () => {
          expect(await overflowX(page), "dispatcher panel").toBeLessThanOrEqual(0);
          await capture(page, name("dispatcher"));
        });
        await asUser(page, "admin@example.test", mode, async () => {
          await page.goto("/admin/config");
          await expect(page.getByRole("heading", { name: "Site configuration" })).toBeVisible();
          expect(await overflowX(page), "admin config").toBeLessThanOrEqual(0);
          await capture(page, name("admin-config"));
        });
        await asUser(page, "officer@example.test", mode, async () => {
          await expect(page.locator(".qm-layout--mobile-unit")).toHaveCount(1);
          expect(await overflowX(page), "officer layout").toBeLessThanOrEqual(0);
          await capture(page, name("officer"));
        });
      });
    }
  }
});

// tokenValue keeps the import used for a scale-token sanity check: the density tokens the CSS uses.
test("the density tokens are 36 px dense and 56 px touch", () => {
  expect(tokenValue("control.height.dense", "day")).toBe("36px");
  expect(tokenValue("control.height.touch", "day")).toBe("56px");
});
