// node scripts/design/mockup-v6-shots.mjs <mockup.html> <out dir> [day|night|redShift]
// Screenshots every frame of the v6 draft tabs (audit log, request view, note and history, purged,
// terminal pane; M2 P2 Track B, BW1 Task 1, #724) and lists console errors, so the design critic and
// the BW5 comparison can read them as files. Run from the repo root.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(resolve("apps/web/package.json"));
const { chromium } = require("@playwright/test");

const [html, out, mode = "night"] = process.argv.slice(2);
if (!html || !out) throw new Error("usage: mockup-v6-shots.mjs <mockup.html> <out dir> [mode]");
mkdirSync(out, { recursive: true });

const TABS = [
  [
    "aud",
    "a6-frames",
    "a6-frame",
    ["table", "narrow", "errors", "empty", "loading", "failed", "forbidden", "notFound"],
  ],
  ["reqv", "r6-frames", "r6-frame", ["wide", "narrow", "notfound"]],
  ["note", "n6-frames", "n6-frame", ["drawer", "dlg0", "dlg1", "dlg2", "rollback"]],
  ["purged", "p6-frames", "p6-frame", ["list", "officer"]],
  ["tpane", "t6-frames", "t6-frame", ["pane", "error", "narrow", "menu", "menufail"]],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await page.goto(pathToFileURL(resolve(html)).href);
await page.waitForTimeout(1500);
await page.addStyleTag({ content: ".mk-bar { position: static !important; }" });
await page.evaluate((m) => document.querySelector(`button[data-mode="${m}"]`).click(), mode);

for (const [tab, framesId, frameId, list] of TABS) {
  await page.click(`#tab-${tab}`);
  for (const f of list) {
    await page.click(`#${framesId} button[data-f="${f}"]`);
    await page.waitForTimeout(250);
    const name = `v6-${mode}-${tab}-${f}`;
    await page.locator(`#${frameId}`).screenshot({ path: `${out}/${name}.png` });
    console.log(name);
  }
}
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
