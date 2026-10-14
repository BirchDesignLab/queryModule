import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Renders a print brief (HTML under docs/briefs/) to PDF with Chromium, with the Birch Design Lab
 * header (logo mark and wordmark, left) and footer (domain left, page n of N right).
 *
 *   node scripts/briefs/render-pdf.mjs [--allow-missing] [html] [pdf]
 *
 * Defaults to the M2 P1 design brief. A referenced image that is missing fails the render unless
 * --allow-missing is given (used while the screenshots are still pending). Playwright is a
 * dependency of apps/web only, so it is resolved from there.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const briefs = join(root, "docs", "briefs");

const args = process.argv.slice(2);
const allowMissing = args.includes("--allow-missing");
const [htmlArg, pdfArg] = args.filter((a) => !a.startsWith("--"));
const htmlPath = resolve(htmlArg ?? join(briefs, "query-module-2-design-brief-m2p1.html"));
const pdfPath = resolve(pdfArg ?? htmlPath.replace(/\.html$/u, ".pdf"));

const require = createRequire(join(root, "apps", "web", "package.json"));
const { chromium } = require("@playwright/test");

const logoSvg = readFileSync(join(briefs, "brand", "birch-design-lab-horizontal.svg"), "utf8");
const logoUri = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

// Header and footer are drawn in a separate frame: no page CSS reaches them, so everything is inline.
const headerTemplate = `<div style="width:100%;padding:0 0.75in;display:flex;align-items:center;-webkit-print-color-adjust:exact"><img src="${logoUri}" style="height:34px;width:auto" /></div>`;
const footerTemplate = `<div style="width:100%;padding:0 0.75in;display:flex;justify-content:space-between;font:9px 'Helvetica Neue',Arial,sans-serif;color:#4d5968"><span>birchdesignlab.com</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);

  const problems = await page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll("img")) {
      if (!img.complete || img.naturalWidth === 0)
        out.push(`missing image: ${img.getAttribute("src")}`);
    }
    for (const face of ["IBM Plex Sans", "IBM Plex Sans Condensed", "IBM Plex Mono"]) {
      if (!document.fonts.check(`12px "${face}"`)) out.push(`font not loaded: ${face}`);
    }
    return out;
  });
  const fatal = problems.filter((p) => !(allowMissing && p.startsWith("missing image")));
  for (const p of problems)
    console.log(`${allowMissing && p.startsWith("missing image") ? "WARN" : "ERROR"} ${p}`);
  if (fatal.length > 0) process.exitCode = 1;
  else {
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      preferCSSPageSize: true,
      headerTemplate,
      footerTemplate,
    });
    writeFileSync(pdfPath, pdf);
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/gu) ?? []).length;
    console.log(`wrote ${pdfPath} (${pdf.length} bytes, ${pages} pages)`);
  }
} finally {
  await browser.close();
}
