import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// M1 P3 hardening (query surfaces): the dispatcher panel and the officer layout under the
// conditions the requirements name (spec 6.3, 6.6; WCAG 2.2 1.4.4, 1.4.10, 2.3.3, 2.4.11, 2.5.8).
// Nothing here is a pixel image: every check is a number the browser resolves the same everywhere.
// The overflow block in visual.spec.ts covers 1440 and 1024, panel-layout.spec.ts 320x800 and
// 1280x800; this file adds the other conditions and the checks those two do not make (clipping,
// target sizes, focus not obscured by the sticky action bar, motion).

/** "200% zoom" is a half-size CSS viewport at twice the pixel density (1280x800 at 200% = 640x400);
 *  "320 px reflow" is 1280x1024 at 400% (WCAG 1.4.10: 320 CSS px wide, content scrolls vertically). */
const CONDITIONS = [
  { name: "1366x768", viewport: { width: 1366, height: 768 }, scale: 1 },
  { name: "800x600", viewport: { width: 800, height: 600 }, scale: 1 },
  { name: "200% zoom (640x400 CSS px)", viewport: { width: 640, height: 400 }, scale: 2 },
  { name: "320 px reflow (320x256 CSS px)", viewport: { width: 320, height: 256 }, scale: 4 },
] as const;

/** Persona, seeded account, and the smallest interactive target its layout promises (spec 6.3). */
const PERSONAS = [
  {
    name: "dispatcher",
    email: "dispatcher@example.test",
    minTarget: 24,
    minControl: 36,
    minRun: 36,
  },
  { name: "officer", email: "officer@example.test", minTarget: 48, minControl: 56, minRun: 64 },
] as const;

interface Problems {
  overflow: number;
  outside: string[];
  scrollRegions: string[];
  clipped: string[];
  small: string[];
}

/** One pass over the signed-in page: everything in the header and main must be reachable and whole. */
async function audit(
  page: Page,
  { minTarget, minControl, minRun }: { minTarget: number; minControl: number; minRun: number },
): Promise<Problems> {
  return page.evaluate(
    ({ minTarget, minControl, minRun }) => {
      const vw = document.documentElement.clientWidth;
      const scroller = document.scrollingElement;
      const main = document.querySelector("main");
      const overflow = Math.max(
        scroller === null ? 0 : scroller.scrollWidth - scroller.clientWidth,
        main === null ? 0 : main.scrollWidth - main.clientWidth,
      );
      const label = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className)}`.trim();
      const outside: string[] = [];
      const scrollRegions: string[] = [];
      const clipped: string[] = [];
      const small: string[] = [];
      for (const el of document.querySelectorAll("header *, main *")) {
        const box = el.getBoundingClientRect();
        // Visually hidden text (a 1 px clipped box) and collapsed content are not on the page.
        if (box.width <= 1 || box.height <= 1) continue;
        if (box.right > vw + 0.5 || box.left < -0.5)
          outside.push(`${label(el)} ${box.left}..${box.right}`);
        // A text box scrolls its own value as the caret moves: that is what an input is.
        const isField = el.matches("input, select, textarea");
        const s = getComputedStyle(el);
        const overX = el.scrollWidth > el.clientWidth + 1;
        const overY = el.scrollHeight > el.clientHeight + 1;
        if ((s.overflowX === "auto" || s.overflowX === "scroll") && overX)
          scrollRegions.push(label(el));
        if (!isField && (s.overflowX === "hidden" || s.overflowX === "clip") && overX)
          clipped.push(label(el));
        if (!isField && (s.overflowY === "hidden" || s.overflowY === "clip") && overY)
          clipped.push(label(el));
        if (el.matches("a, button, select, summary, input:not([type=hidden])")) {
          // A checkbox is drawn by its chip: the label is the target.
          const target = el.matches("input[type=checkbox]") ? (el.closest("label") ?? el) : el;
          const tb = target.getBoundingClientRect();
          // Controls in the page (fields, buttons, quick access) hold the persona's control height;
          // the segmented switches and the header hold its target size; Run holds its own.
          const isControl =
            el.closest("main") !== null &&
            el.closest(".qm-seg") === null &&
            el.matches("select, input:not([type=checkbox]), .qm-button, .qm-quick-access__button");
          const min = el.matches("button[type=submit]")
            ? minRun
            : isControl
              ? minControl
              : minTarget;
          if (tb.height + 0.5 < min || tb.width + 0.5 < min)
            small.push(`${label(el)} ${tb.width}x${tb.height} < ${min}`);
        }
      }
      return { overflow, outside, scrollRegions, clipped, small };
    },
    { minTarget, minControl, minRun },
  );
}

async function expectWhole(page: Page, where: string, persona: (typeof PERSONAS)[number]) {
  const p = await audit(page, persona);
  expect(p.overflow, `${where}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect(p.outside, `${where}: outside the viewport`).toEqual([]);
  expect(p.scrollRegions, `${where}: a sideways scroll region (WCAG 1.4.10)`).toEqual([]);
  expect(p.clipped, `${where}: clipped content`).toEqual([]);
  expect(p.small, `${where}: targets below the persona's minimum`).toEqual([]);
}

/**
 * Tab through the header and main from the panel heading. A focused control must not be hidden
 * behind the sticky action bar (WCAG 2.4.11): at least one sample point of it hits the control
 * itself (or its chip). The loop ends when focus leaves <main>.
 */
async function tabThroughNotObscured(page: Page): Promise<{ obscured: string[]; stops: number }> {
  await page.getByRole("heading", { name: "Query Module", exact: true }).focus();
  const obscured: string[] = [];
  let stops = 0;
  for (let stop = 0; stop < 60; stop++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (
        el === null ||
        el === document.body ||
        document.querySelector("main")?.contains(el) !== true
      )
        return null;
      const box = el.getBoundingClientRect();
      const inChip = (hit: Element | null) =>
        hit !== null &&
        (el.contains(hit) ||
          hit.contains(el) ||
          (el as HTMLInputElement).labels?.[0]?.contains(hit) === true);
      let seen = 0;
      for (const [fx, fy] of [
        [0.5, 0.5],
        [0.15, 0.15],
        [0.85, 0.15],
        [0.15, 0.85],
        [0.85, 0.85],
      ] as const) {
        const x = box.left + box.width * fx;
        const y = box.top + box.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        if (inChip(document.elementFromPoint(x, y))) seen++;
      }
      const cover = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        name: `${el.tagName.toLowerCase()}#${el.id}`,
        seen,
        cover: cover === null ? "" : `${cover.tagName.toLowerCase()}.${String(cover.className)}`,
      };
    });
    if (state === null) break;
    stops++;
    if (state.seen === 0) obscured.push(`${state.name} under ${state.cover}`);
  }
  return { obscured, stops };
}

for (const persona of PERSONAS) {
  for (const condition of CONDITIONS) {
    test.describe(`${persona.name} at ${condition.name}`, () => {
      test.use({ viewport: condition.viewport, deviceScaleFactor: condition.scale });

      test("reflows whole, targets hold, focus is never hidden behind the action bar", async ({
        page,
      }) => {
        await signIn(page, seededUser(persona.email));
        await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
        // The emulation is what the name says.
        expect(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio])).toEqual([
          condition.viewport.width,
          condition.viewport.height,
          condition.scale,
        ]);
        await expectWhole(page, "idle panel", persona);

        // A long command: the echo must wrap, not become a scroll region.
        const plate = page.getByLabel("Plate", { exact: true });
        await plate.fill("ZZ-0001");
        await page.getByLabel("VIN").fill("ZZ0000000000ZZ001");
        await expect(page.locator(".qm-command-echo__text code")).toContainText("ZZ-0001");
        await expectWhole(page, "panel with a long command", persona);
        const first = await tabThroughNotObscured(page);
        // Enough stops that the pass cannot be vacuous (mode, quick access, fields, sources, Run, Clear).
        expect(first.stops, "Tab stops visited").toBeGreaterThan(8);
        expect(first.obscured, "focus hidden behind the action bar").toEqual([]);
        // The hook keeps the bar's height clear wherever the bar sticks; under 20rem tall it does not stick.
        const padding = await page.evaluate(
          () => document.documentElement.style.scrollPaddingBlockEnd,
        );
        if (condition.viewport.height >= 320) expect(padding).toContain("calc(");
        else expect(padding).toBe("");

        const sent = page.waitForResponse(
          (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
        );
        await plate.press("Enter");
        expect((await sent).status()).toBe(202);
        await expect(page.getByText("Acknowledged").first()).toBeVisible();
        await expectWhole(page, "panel with a request row", persona);
        const second = await tabThroughNotObscured(page);
        expect(second.stops, "Tab stops visited after a request").toBeGreaterThan(8);
        expect(second.obscured, "focus hidden after a request").toEqual([]);
      });
    });
  }
}

/** Elements that would move under a user who asked for less motion (WCAG 2.3.3, spec 6.6). */
async function motion(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const moving = (list: string) => list.split(",").some((d) => Number.parseFloat(d) > 0);
    const found: string[] = [];
    for (const el of document.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      const name = `${el.tagName.toLowerCase()}.${String(el.className)}`;
      if (moving(s.transitionDuration) && s.transitionProperty !== "none")
        found.push(`${name} transition ${s.transitionDuration}`);
      if (s.animationName !== "none" && moving(s.animationDuration))
        found.push(`${name} animation ${s.animationName} ${s.animationDuration}`);
      if (s.scrollBehavior === "smooth") found.push(`${name} smooth scroll`);
    }
    const running = document.getAnimations().filter((a) => a.playState === "running");
    for (const a of running) found.push(`running animation ${a.constructor.name}`);
    return found;
  });
}

test.describe("prefers-reduced-motion: no non-essential motion (WCAG 2.3.3)", () => {
  test.use({ reducedMotion: "reduce" });

  test("sign-in, panel, a rule-revealed field and a request row all hold still", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(await motion(page), "sign-in").toEqual([]);

    await signIn(page, seededUser("dispatcher@example.test"));
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    expect(await motion(page), "panel").toEqual([]);

    // State OK reveals Plate type: the reveal flash and the Shown tag, static under reduced motion.
    const state = page.getByLabel("State", { exact: true });
    await state.focus();
    await state.selectOption("OK");
    await expect(page.locator(".qm-form-cell--revealed").first()).toBeVisible();
    await expect(page.locator(".qm-tag--shown").first()).toBeVisible();
    expect(await motion(page), "after a rule reveal").toEqual([]);

    await page.getByRole("button", { name: "Clear" }).click();
    const plate = page.getByLabel("Plate", { exact: true });
    await plate.fill("ZZ-0001");
    const sent = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
    );
    await plate.press("Enter");
    expect((await sent).status()).toBe(202);
    await expect(page.getByText("Acknowledged").first()).toBeVisible();
    expect(await motion(page), "with a request row").toEqual([]);
  });
});

test.describe("motion control", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the detector sees the transitions that reduced motion removes", async ({ page }) => {
    await signIn(page, seededUser("dispatcher@example.test"));
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    expect((await motion(page)).length).toBeGreaterThan(0);
  });
});

test.describe("focus repair A in a real browser: the sheet opened from inside the account menu", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("closing it puts focus on the account button, not <body>", async ({ page }) => {
    await signIn(page, seededUser("dispatcher@example.test"));
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    const account = page.getByRole("banner").locator(".qm-account__button");
    await account.click();
    const panel = page.getByRole("group", { name: "Account" });
    await expect(panel).toBeVisible();
    // Focus a control inside the open menu, then press Shift+/ there.
    await panel.getByRole("button", { name: "Keyboard shortcuts" }).focus();
    await page.keyboard.press("Shift+Slash");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toBeVisible();
    // The modal took focus, the menu closed with it, and its old opener left the page.
    await expect(panel).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(account).toBeFocused();
  });
});
