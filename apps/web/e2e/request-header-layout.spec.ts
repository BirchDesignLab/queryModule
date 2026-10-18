import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// R22 (#680): at 1024 a long command must not push the badges and the meta line into extra rows.
// The entry header is the type, the command and the badges (at most two rows: the badges wrap
// under the command only when the three do not fit), then one meta row (sent, reference, Copy
// reference). Measured by box tops, so a wrapped line counts however it got there.
// REQUEST_SHOTS_DIR=<dir> also writes the entry as a PNG per width.

test.use({ emptyQueryList: true, colorScheme: "light", reducedMotion: "reduce" });

const COMMAND = "PRO.ZZSTOLEN1.ELECTRONICS";

async function rows(boxes: Array<{ y: number; height: number } | null>): Promise<number> {
  const tops: number[] = [];
  for (const box of boxes) {
    if (box === null) continue;
    // Boxes whose tops are within half a line of one another share a row.
    if (!tops.some((top) => Math.abs(top - box.y) < box.height / 2)) tops.push(box.y);
  }
  return tops.length;
}

for (const width of [1024, 1366]) {
  test(`R22 the request entry header stays at most two rows plus one meta row at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 768 });
    await signIn(page, seededUser("dispatcher@example.test"));
    await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
    await page.keyboard.press("Slash");
    const input = page.getByRole("textbox", { name: "Command" });
    await expect(input).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(COMMAND);
    await page.keyboard.press("Enter");
    const entry = page.getByRole("region", { name: /Requests this shift|Last request/ });
    const row = entry.getByRole("listitem").first();
    await expect(row.locator(".qm-request__meta")).toContainText("Reference");
    const head = await rows([
      await row.locator(".qm-request__type").boundingBox(),
      await row.locator(".qm-request__summary").boundingBox(),
      await row.locator(".qm-request__badges").boundingBox(),
    ]);
    const meta = await rows([
      await row.locator(".qm-request__meta > span").nth(0).boundingBox(),
      await row.locator(".qm-request__meta > span").nth(1).boundingBox(),
      await row.getByRole("button", { name: /^Copy reference/ }).boundingBox(),
    ]);
    const shotDir = process.env.REQUEST_SHOTS_DIR;
    if (shotDir !== undefined && shotDir !== "") {
      mkdirSync(shotDir, { recursive: true });
      await row.screenshot({ path: join(shotDir, `request-entry-${width}.png`) });
    }
    test.info().annotations.push({ type: "rows", description: `head ${head}, meta ${meta}` });
    expect(head, "type, command and badges").toBeLessThanOrEqual(2);
    expect(meta, "sent, reference and Copy reference").toBe(1);
  });
}
