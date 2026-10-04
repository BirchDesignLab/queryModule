// m1-web-minors-ticks-2026-10-04.mjs: after PR #516 (M1 web and UI minors, wave WM), tick every
// open box of #319, #382, #410, #480, #483, #485 and #507 with a short note, and move #507 item 17
// (password minimum from the server, gate tier) to the M2 carry issue #511. As BirchDesignLab
// (session "M1 finish 3").
//
// Why: sdd agents never write to GitHub; the controller ticks boxes from the wave reports
// (.superpowers/sdd/track-a-p3/wm1-report.md to wm4-report.md) and the read-only verifier pass of
// 10-03-26. A box with no special note below was done in #516. Only open boxes change and the #511
// line is added once, so a rerun is a no-op.
// Usage (repo root): node scripts/board/m1-web-minors-ticks-2026-10-04.mjs [--apply]
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
const PR = "#516";
const CARRY = 511;
const tok = spawnSync("gh", ["auth", "token", "-u", "BirchDesignLab"], { encoding: "utf8" });
if (tok.status !== 0) throw new Error("no gh token for BirchDesignLab");
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
const getBody = (n) => JSON.parse(gh(["api", `repos/${REPO}/issues/${n}`])).body ?? "";
const setBody = (n, body) =>
  gh(
    ["api", `repos/${REPO}/issues/${n}`, "--method", "PATCH", "--input", "-"],
    JSON.stringify({ body }),
  );

const ALREADY = "already done on main, verified 10-03-26";
/** Per issue: [unique substring of an open box, note]. Every other open box: done in #516. */
const SPECIAL = {
  319: [
    ["The 1000 ms chord boundary rule", ALREADY],
    ["Shift+Slash shows", ALREADY],
    ["Global-last enforced twice", ALREADY],
    ["AltGr tested only at engine level", ALREADY],
    ["Keyboard submit path not covered", ALREADY],
  ],
  382: [
    [
      "B3 a response after reset maps to `failed`",
      "no change: deliberate, pinned by submit.test.ts (WM1)",
    ],
    ["Preview announces field reveals through the global announcer", "carried to #357 (Task 32)"],
    ["T19 run evidence", "process note, no code"],
    [
      "Builder preview: reopening on the live config",
      `no change: not reproducible; live and draft derive from the same quickAccess, parity test added in ${PR}`,
    ],
  ],
  483: [
    [
      "Focus repair B",
      "stands (controller 10-03-26): unreachable in the built app (a route change focuses the heading and closes the menu first); covered by AccountMenu.test.tsx; add the e2e if a route ever keeps the menu open while the item goes",
    ],
  ],
  507: [
    ["2b Q2: `PublishFlow.tsx` reload()", ALREADY],
    [
      'Observation: "Sign out everywhere" skips',
      `decided (controller 10-03-26): keep skipping the admin's own session; documented in ${PR}`,
    ],
    [
      "M6: `ChangePasswordPage.tsx` hard-codes MIN_LENGTH",
      `moved to #${CARRY} (gate: needs an API change)`,
    ],
  ],
};
const ISSUES = [319, 382, 410, 480, 483, 485, 507];

let changes = 0;
for (const n of ISSUES) {
  const before = getBody(n);
  const specials = SPECIAL[n] ?? [];
  for (const [box] of specials) {
    const hits = before.split("\n").filter((l) => l.startsWith("- [") && l.includes(box));
    if (hits.length !== 1) throw new Error(`#${n}: "${box}" matches ${hits.length} boxes`);
  }
  const lines = before.split("\n").map((l) => {
    if (!l.startsWith("- [ ] ")) return l;
    const note = specials.find(([box]) => l.includes(box))?.[1] ?? `done in ${PR}`;
    changes += 1;
    console.log(`${APPLY ? "" : "would "}tick #${n}: ${l.slice(6, 66)} (${note.slice(0, 40)})`);
    return `${l.replace("- [ ] ", "- [x] ")} (${note})`;
  });
  if (APPLY && lines.join("\n") !== before) setBody(n, lines.join("\n"));
}

const ITEM17 =
  "- [ ] (from #507, gate) `apps/web/src/app/ChangePasswordPage.tsx` hard-codes MIN_LENGTH 12, a copy of the server's minimum: expose the minimum through the client config or the change-password error (`packages/api/src/auth`, gate), then read it in the page (WM4 found neither source carries it today).";
const carry = getBody(CARRY);
if (!carry.includes("(from #507, gate)")) {
  const anchor = "\n\n**Source:**";
  if (!carry.includes(anchor)) throw new Error(`#${CARRY}: no Source line to insert before`);
  changes += 1;
  console.log(`${APPLY ? "" : "would "}add #507 item 17 to #${CARRY}`);
  if (APPLY) setBody(CARRY, carry.replace(anchor, `\n${ITEM17}${anchor}`));
}
console.log(`${APPLY ? "applied" : "planned"} ${changes} change(s)`);
