import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Demo polish (#642): measured, not eyeballed. Ghost buttons line up with the text above them, an
// also-run part has its rule, the date hint fits two lines, quick access
// keeps 36 px targets, and the Day focus ring is the 7:1 blue.

test.use({ emptyQueryList: true, colorScheme: "light", reducedMotion: "reduce" });

const LAYOUTS = [
  { name: "dispatcher", email: "dispatcher@example.test", width: 1366, height: 768 },
  { name: "dispatcher", email: "dispatcher@example.test", width: 1024, height: 768 },
  { name: "officer", email: "officer@example.test", width: 1024, height: 768 },
] as const;

async function startAs(page: Page, email: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.context().clearCookies();
  await signIn(page, seededUser(email));
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
}

/** Left edge of the first run of text inside an element, past any padding or border it has. */
async function textLeft(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null && (node.textContent ?? "").trim() === "") node = walker.nextNode();
    if (node === null) return Number.NaN;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().left;
  });
}

async function runCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press("Slash");
  const input = page.getByRole("textbox", { name: "Command" });
  await expect(input).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

for (const layout of LAYOUTS) {
  test.describe(`${layout.name} ${layout.width}x${layout.height}`, () => {
    test.use({ viewport: { width: layout.width, height: layout.height } });

    test("ghost buttons line up with the text above, the also-run part has its rule", async ({
      page,
    }) => {
      await startAs(page, layout.email, layout.width, layout.height);
      await runCommand(page, "PER.EXAMPLESON.SAMPLE.01011901");
      const region = page.getByRole("region", { name: /Requests this shift|Last request/ });
      await expect(region.getByText("NO WANTS OR WARRANTS")).toBeVisible({ timeout: 15_000 });

      // Show detail starts where the card's text does (the card's own left padding).
      const card = region.getByRole("listitem").first();
      const show = card.getByRole("button", { name: /^Show detail/ }).first();
      await expect(show).toBeVisible();
      const heading = card.getByText("State system: returned").first();
      const delta = Math.abs((await textLeft(show)) - (await textLeft(heading)));
      expect(delta, "Show detail text vs the card heading").toBeLessThanOrEqual(1);

      // Copy reference in the request row starts where the row's text does.
      const copy = card.getByRole("button", { name: /^Copy reference/ });
      const sent = card.getByText(/^Sent \d/);
      const sentLeft = await textLeft(sent);
      const copyBox = await copy.boundingBox();
      const copyLeft = await textLeft(copy);
      // On its own line it lines up with the text; beside the text it keeps a normal gap.
      const sentBox = await sent.boundingBox();
      if (copyBox !== null && sentBox !== null && copyBox.y > sentBox.y + sentBox.height - 2)
        expect(Math.abs(copyLeft - sentLeft), "Copy reference on its own line").toBeLessThanOrEqual(
          1,
        );

      // The also-run part sits under the same rule the first part does.
      const parts = card.locator(".qm-request__part");
      expect(await parts.count()).toBeGreaterThan(1);
      const rules = await parts.evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).borderBlockStartWidth),
      );
      expect(rules[1], "second part rule").toBe("1px");
      const fieldset = await card.locator(".qm-request__parts").evaluate((el) => {
        return getComputedStyle(el).borderBlockStartWidth;
      });
      expect(fieldset, "first part rule").toBe("1px");
    });

    test("the date format hint fits two lines and the type buttons keep 36 px", async ({
      page,
    }) => {
      await startAs(page, layout.email, layout.width, layout.height);
      await page.getByRole("button", { name: "Person", exact: true }).click();
      const dob = page.getByLabel(/^Date of birth/);
      await expect(dob).toBeVisible();
      const hint = page.locator(".qm-field__description", { hasText: "Accepted formats" }).first();
      await hint.scrollIntoViewIfNeeded();
      const lines = await hint.evaluate((el) => {
        const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
        return Math.round(el.getBoundingClientRect().height / lineHeight);
      });
      expect(lines, "date hint lines").toBeLessThanOrEqual(2);

      const quick = page.getByRole("group", { name: "Quick access" }).getByRole("button");
      const boxes = await quick.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), height: r.height };
        }),
      );
      expect(boxes.length).toBe(5);
      for (const b of boxes) expect(b.height, "quick access height").toBeGreaterThanOrEqual(36);
      // A focused button's ring and its gap (4 px) clear the neighbour's edge.
      const edges = await quick.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), left: r.left, right: r.right };
        }),
      );
      for (let i = 1; i < edges.length; i++) {
        const [prev, next] = [edges[i - 1], edges[i]];
        if (prev !== undefined && next !== undefined && prev.top === next.top)
          expect(next.left - prev.right, "quick access gap").toBeGreaterThanOrEqual(6);
      }
    });
  });
}

test("the Day focus ring is the 7:1 blue on a button, a field and the primary button", async ({
  page,
}) => {
  await startAs(page, "dispatcher@example.test", 1366, 768);
  const ring = "rgb(26, 63, 192)";
  for (const target of [
    page.getByRole("button", { name: "Person", exact: true }),
    page.getByLabel("Plate", { exact: true }),
    page.getByRole("button", { name: /^Run query/ }),
  ]) {
    await target.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    const color = await target.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(color).toBe(ring);
  }
});
