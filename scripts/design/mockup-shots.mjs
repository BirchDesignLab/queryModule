// node scripts/design/mockup-shots.mjs <mockup.html> <out dir>
// Screenshots the v5 "Result cards" and "Builder cards" frames of the approved mockup (the
// Artifact HTML saved to disk) so a reviewer can set them beside the app's own screenshots
// (apps/web/e2e/visual-shots.spec.ts, SHOTS_DIR). Run from the repo root.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");

const [html, out] = process.argv.slice(2);
if (!html || !out) throw new Error("usage: mockup-shots.mjs <mockup.html> <out dir>");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(pathToFileURL(resolve(html)).href);
await page.waitForTimeout(1500);

const shoot = async (tab, framesId, frame, target, name) => {
  await page.click(`#tab-${tab}`);
  await page.click(`#${framesId} button[data-f="${frame}"]`);
  await page.waitForTimeout(300);
  await page.locator(target).first().screenshot({ path: `${out}/${name}.png` });
  console.log(name);
};

for (const f of ["card", "wins", "table", "keywords", "try"]) {
  await shoot("cardsb", "b5-frames", f, "#screen-cardsb .frame", `mockup-builder-${f}`);
}
for (const f of ["dispatch", "officer"]) {
  await shoot("cards", "c5-frames", f, "#c5-frame", `mockup-cards-${f}`);
}
await browser.close();
