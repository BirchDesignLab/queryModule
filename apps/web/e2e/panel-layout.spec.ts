import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

const MODES = ["day", "night", "redShift"] as const;
const MIN_TARGET = 24;

async function blockedVehiclePanel(page: Page, mode: (typeof MODES)[number]): Promise<void> {
  await page.getByLabel("Theme").selectOption(mode);
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  await page.getByLabel("Query type").selectOption("VEH");
  await page.getByLabel("State", { exact: true }).selectOption("OK");
  await expect(page.getByLabel("Plate type")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByLabel("Plate type")).toHaveAttribute("aria-invalid", "true");
}

test.describe("panel at 320px (spec 6.2, 6.5, 6.6)", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  for (const mode of MODES) {
    test(`${mode}: no overflow, 24px targets, focus ring, axe`, async ({ page }) => {
      await signIn(page);
      await blockedVehiclePanel(page, mode);

      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement;
        return el === null ? 0 : el.scrollWidth - el.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);

      const small = await page
        .locator(
          "main a, main button, main input, main select, header a, header button, header select",
        )
        .evaluateAll(
          (els, min) =>
            els
              .map((el) => ({ el, box: el.getBoundingClientRect() }))
              .filter(({ box }) => box.width > 0 && box.height > 0)
              .filter(({ box }) => box.width < min || box.height < min)
              .map(({ el, box }) => `${el.tagName} ${el.id} ${box.width}x${box.height}`),
          MIN_TARGET,
        );
      expect(small).toEqual([]);

      const plate = page.getByLabel("Plate", { exact: true });
      await plate.focus();
      const ring = await plate.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          style: s.outlineStyle,
          width: Number.parseFloat(s.outlineWidth),
          color: s.outlineColor,
        };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThan(0);
      // Contrast of the ring against the field's own surface (nearest opaque
      // background), 3:1 minimum (spec 6.5, WCAG 1.4.11). Colours are
      // normalised through a canvas so any computed colour syntax works.
      const contrast = await plate.evaluate((el) => {
        const toRgba = (css: string): [number, number, number, number] => {
          const ctx = document.createElement("canvas").getContext("2d");
          if (ctx === null) throw new Error("no 2d context");
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = css;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
        };
        const lum = ([r, g, b]: [number, number, number, number]): number => {
          const c = [r, g, b].map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
        };
        // The offset ring is drawn outside the field, over its parent's surface, not the field's own.
        let node: Element | null = el.parentElement;
        let bg: [number, number, number, number] = [0, 0, 0, 0];
        while (node !== null) {
          bg = toRgba(getComputedStyle(node).backgroundColor);
          if (bg[3] === 255) break;
          node = node.parentElement;
        }
        if (bg[3] !== 255) bg = [255, 255, 255, 255];
        const ringRgba = toRgba(getComputedStyle(el).outlineColor);
        const l1 = lum(ringRgba);
        const l2 = lum(bg);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(3);

      await expectNoSeriousAxeViolations(page);
    });
  }
});

test("Tab order puts the header before the panel; Enter attempts one submit (FR-006, UX-004)", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("Query type").selectOption("PER");
  const order = await page.evaluate(() => {
    const focusable = [
      ...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea"),
    ];
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    return {
      hasHeader: header !== null && main !== null,
      headerFirst:
        focusable.findIndex((el) => main?.contains(el)) >
        focusable.map((el) => header?.contains(el) === true).lastIndexOf(true),
      headerHasTheme: header !== null && header.querySelector("select") !== null,
    };
  });
  expect(order.hasHeader).toBe(true);
  expect(order.headerFirst).toBe(true);
  expect(order.headerHasTheme).toBe(true);

  await page.getByRole("heading", { name: "Query Module" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByLabel("Theme")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Status" })).toBeFocused();

  const submit = page.getByRole("button", { name: "Submit" });
  await expect(submit).not.toBeDisabled();
  const attempts: string[] = [];
  await page.exposeFunction("__qmAttempt", (text: string) => attempts.push(text));
  await page.evaluate(() => {
    const polite = document.querySelector('[data-testid="announcer-polite"]');
    if (polite === null) return;
    new MutationObserver(() => {
      const text = polite.textContent?.trim() ?? "";
      if (text !== "") (window as unknown as { __qmAttempt(t: string): void }).__qmAttempt(text);
    }).observe(polite, { childList: true, characterData: true, subtree: true });
  });
  await page.getByLabel("First name").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Last name")).toHaveAttribute("aria-invalid", "true");
  // Sentinel instead of a fixed wait: a later, distinct announcement proves every announcement
  // from the Enter press has landed before the count is checked.
  await page.getByLabel("Query type").selectOption("VEH");
  await page.getByLabel("State", { exact: true }).selectOption("OK");
  await expect
    .poll(() => attempts.some((a) => a.includes("Plate type is now shown and required.")))
    .toBe(true);
  expect(attempts.filter((a) => a.includes("needs attention"))).toHaveLength(1);
});
