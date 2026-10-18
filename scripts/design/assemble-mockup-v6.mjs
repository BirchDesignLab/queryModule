// node scripts/design/assemble-mockup-v6.mjs <v5.html> <fragments dir> <out.html>
// Builds the v6 draft mockup (M2 P2 Track B, BW1 Task 1, #724) from the approved v5 Artifact HTML
// (saved to disk) and four fragments: v6.css, v6-tabs.html, v6-sections.html, v6.js. The v5 tabs
// stay as they are, with the three builder rulings from #698 applied: "<Type> default response"
// in Try a match and the card preview, and only the selected type expanded in the Result cards
// tree. Mock data only. Run from the repo root.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are v5 template source to patch
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [v5, dir, out] = process.argv.slice(2);
if (!v5 || !dir || !out)
  throw new Error("usage: assemble-mockup-v6.mjs <v5.html> <fragments dir> <out.html>");
const frag = (name) => readFileSync(resolve(dir, name), "utf8");
let html = readFileSync(resolve(v5), "utf8");

// Replace exactly one occurrence, or fail loudly so a changed v5 never half-applies.
const swap = (from, to, label) => {
  const first = html.indexOf(from);
  if (first < 0 || html.indexOf(from, first + 1) >= 0)
    throw new Error(`${label}: expected exactly one match`);
  html = html.slice(0, first) + to + html.slice(first + from.length);
};

swap('\n</style>\n\n<svg width="0"', `${frag("v6.css")}\n</style>\n\n<svg width="0"`, "css");
swap(
  'data-screen="cardsb">v5 draft: Builder cards</button>\n',
  `data-screen="cardsb">v5 draft: Builder cards</button>\n${frag("v6-tabs.html")}`,
  "tabs",
);
swap("</main>\n", `${frag("v6-sections.html")}</main>\n`, "sections");
swap("\n</body></html>", `\n${frag("v6.js")}\n</body></html>`, "script");
swap(
  "result cards v5 draft 10-13-26</span>",
  "result cards v5 draft 10-13-26; audit console v6 draft 10-18-26</span>",
  "title",
);

// #698 rulings (the developer, 10-18-26): default answer label, one expanded type in the tree.
swap(
  'const which = m ? `${m.k < 0 ? "Default" : `Scenario ${m.k + 1}`} of ${QTN[tryV.qt]}` : "";',
  'const which = m ? (m.k < 0 ? `${QTN[tryV.qt]} default response` : `Scenario ${m.k + 1} of ${QTN[tryV.qt]}`) : "";',
  "try label",
);
swap(
  '<span>${m.k < 0 ? "Default" : `Scenario ${m.k + 1}`} of ${esc(QTN[c.qt])}, ${esc(SRC[pv.src])}.</span>',
  "<span>${m.k < 0 ? `${esc(QTN[c.qt])} default response` : `Scenario ${m.k + 1} of ${esc(QTN[c.qt])}`}, ${esc(SRC[pv.src])}.</span>",
  "preview label",
);
swap(
  "const cardsBody = Object.keys(QTN).map((qt) => { const list = sameType(qt);",
  'const selQt = sel.startsWith("card:") ? B.cards[cardIdx()]?.qt : null;\n    const cardsBody = Object.keys(QTN).map((qt) => { const list = sameType(qt); if (qt !== selQt) return `<li><button type="button" data-b5="card:${list[0]?.[1] ?? 0}">${esc(QTN[qt])}<span class="k">${qt}</span></button></li>`;',
  "tree",
);

writeFileSync(resolve(out), html);
console.log(`wrote ${out} (${html.length} bytes)`);
