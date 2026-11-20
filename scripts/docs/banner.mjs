// Writes the README hero banner in the app's Day and Night palettes (packages/tokens/src/tokens.ts),
// so the README can follow the reader's GitHub theme with <picture>. Mock values only (ZZ-0001).
//   node scripts/docs/banner.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dirname, "../../docs/assets");

const palettes = {
  day: {
    bg: "#f7f9fb",
    glow: "#e1ebfa",
    text: "#121820",
    muted: "#4d5968",
    accent: "#0b4a9e",
    surface: "#ffffff",
    border: "#dde2e8",
    term: "#10151c",
    termText: "#e7ecf2",
    termAccent: "#8ab4ff",
    crit: "#a00000",
    critText: "#a00000",
    badgeText: "#ffffff",
  },
  night: {
    bg: "#0a0e13",
    glow: "#1b2f4d",
    text: "#e7ecf2",
    muted: "#9eabbc",
    accent: "#8ab4ff",
    surface: "#161d26",
    border: "#263140",
    term: "#10151c",
    termText: "#e7ecf2",
    termAccent: "#8ab4ff",
    crit: "#8b0000",
    critText: "#ff8080",
    badgeText: "#0a0e13",
  },
};

const sans = "'IBM Plex Sans', 'Segoe UI', -apple-system, Helvetica, Arial, sans-serif";
const mono = "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace";

function card(p, x, y, source, status, badge) {
  const crit = badge === "CRITICAL";
  const fill = crit ? p.crit : p.accent;
  const ink = crit ? "#ffffff" : p.badgeText;
  return `
  <g transform="translate(${x} ${y})">
    <rect width="300" height="92" rx="10" fill="${p.surface}" stroke="${p.border}"/>
    <rect width="5" height="92" rx="2" fill="${fill}"/>
    <text x="20" y="28" font-family="${sans}" font-size="14" font-weight="600" fill="${p.text}">${source}</text>
    <rect x="${crit ? 196 : 210}" y="12" width="${crit ? 88 : 74}" height="22" rx="11" fill="${fill}"/>
    <text x="${crit ? 240 : 247}" y="27.5" text-anchor="middle" font-family="${sans}" font-size="11" font-weight="700" letter-spacing="0.06em" fill="${ink}">${badge}</text>
    <text x="20" y="56" font-family="${mono}" font-size="13" fill="${p.muted}">PLATE ZZ-0001 · 2026</text>
    <text x="20" y="77" font-family="${mono}" font-size="13" font-weight="700" fill="${crit ? p.critText : p.muted}">${status}</text>
  </g>`;
}

function banner(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="360" viewBox="0 0 1280 360" role="img" aria-labelledby="t d">
  <title id="t">Query Module 2.0</title>
  <desc id="d">A command typed in the terminal and two mock result cards, one marked critical.</desc>
  <defs>
    <radialGradient id="g" cx="78%" cy="40%" r="60%">
      <stop offset="0" stop-color="${p.glow}"/>
      <stop offset="1" stop-color="${p.bg}"/>
    </radialGradient>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="${p.border}"/>
    </pattern>
  </defs>
  <rect width="1280" height="360" rx="18" fill="url(#g)"/>
  <rect width="1280" height="360" rx="18" fill="url(#dots)" opacity="0.55"/>

  <text x="64" y="96" font-family="${sans}" font-size="15" font-weight="600" letter-spacing="0.18em" fill="${p.accent}">COMPUTER-AIDED DISPATCH</text>
  <text x="62" y="160" font-family="${sans}" font-size="62" font-weight="700" fill="${p.text}">Query Module <tspan fill="${p.accent}">2.0</tspan></text>
  <text x="64" y="206" font-family="${sans}" font-size="21" fill="${p.muted}">Type a command. Every source answers live.</text>
  <text x="64" y="236" font-family="${sans}" font-size="21" fill="${p.muted}">Change forms, rules and cards without a release.</text>
  <g font-family="${sans}" font-size="14" font-weight="600">
    <rect x="64" y="270" width="148" height="34" rx="17" fill="none" stroke="${p.border}"/>
    <text x="138" y="292" text-anchor="middle" fill="${p.text}">Keyboard-first</text>
    <rect x="224" y="270" width="160" height="34" rx="17" fill="none" stroke="${p.border}"/>
    <text x="304" y="292" text-anchor="middle" fill="${p.text}">Config, not code</text>
    <rect x="396" y="270" width="176" height="34" rx="17" fill="none" stroke="${p.border}"/>
    <text x="484" y="292" text-anchor="middle" fill="${p.text}">Audited end to end</text>
  </g>

  <g transform="translate(700 52)">
    <rect width="516" height="62" rx="12" fill="${p.term}" stroke="${p.border}"/>
    <circle cx="22" cy="31" r="5" fill="#ff6b6b"/><circle cx="40" cy="31" r="5" fill="#ffd24d"/><circle cx="58" cy="31" r="5" fill="#5fd39a"/>
    <text x="84" y="38" font-family="${mono}" font-size="20" fill="${p.termAccent}">›</text>
    <text x="104" y="38" font-family="${mono}" font-size="20" fill="${p.termText}">VEH.ZZ-0001..26</text>
    <rect x="290" y="21" width="11" height="22" fill="${p.termAccent}" opacity="0.85"/>
    <text x="492" y="37" text-anchor="end" font-family="${mono}" font-size="12" fill="#9eabbc">202 Accepted</text>
  </g>
  ${card(p, 700, 140, "State system", "STOLEN", "CRITICAL")}
  ${card(p, 916, 248, "National system", "awaiting answer…", "PENDING")}
  <path d="M850 114 V140 M1066 114 V248" stroke="${p.accent}" stroke-width="2" stroke-dasharray="4 5" opacity="0.6"/>
</svg>
`;
}

mkdirSync(out, { recursive: true });
for (const [name, palette] of Object.entries(palettes)) {
  writeFileSync(resolve(out, `banner-${name}.svg`), banner(palette));
}
console.log(`banner: wrote ${out}`);
