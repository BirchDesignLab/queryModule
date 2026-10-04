// m1-phase-review-carry-2026-10-04.mjs: file the M1 whole-phase review findings deferred to M2
// (docs/reviews/m1-phase-review.md, developer-approved split 10-04-26) on the carry issue #511,
// as BirchDesignLab (session "M1 finish 3").
//
// Why: the findings fixed in M1 ride the exit PR; the rest need M2 design work or belong with an
// M2 task, and must not be lost. The section is added once, so a rerun is a no-op.
// Usage (repo root): node scripts/board/m1-phase-review-carry-2026-10-04.mjs [--apply]
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
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

const HEAD = "**From the M1 whole-phase review (docs/reviews/m1-phase-review.md, 10-04-26)**";
const SECTION = [
  HEAD,
  "- [ ] AUD-1 with AC-3/CFG-7 (gate and critical, M2 P2 with the session sweeper): Better Auth's getSession deletes absolute-expired sessions with no sessionRevoked row and no endSession, and Better Auth's expiresIn is fixed at boot while published session limits are promised live (ADR-0011). Give Better Auth a fixed ceiling, enforce the live limit in identity, derive the admin list's expiresAt from createdAt plus the live limit, and let the sweeper own expiry with its audit row.",
  "- [ ] CFG-3 (critical, M2 P0.5, before any config schema change): admin/config/store.ts boot hash compare refuses every stored row once an additive schema default is added. Hash the stored document as stored, or migrate stored rows with the schema version.",
  "- [ ] CFG-4 (gate, M2 P0.5): on a seeded deploy, changes to the image's site config and mock file are ignored and there is no import path. Decide an import or merge step for image config changes.",
  "- [ ] CFG-2 (ordinary, M2 P0.5, design): on a mock-source site the builder cannot publish a new query type or source (config.missingMockResponse). Decide how mock coverage is authored from the builder.",
  "- [ ] CFG-1 (ordinary, M2 P1): label-only changes never reach open clients: the config hash covers siteConfig only and the translator is built once at boot.",
  "- [ ] (from X2 IC2, ordinary or gate, M2) a server endpoint for shipped-only label keys, so the builder's browser label check matches the server in every locale (today exact for English only; server Review is authoritative).",
].join("\n");

const body = JSON.parse(gh(["api", `repos/${REPO}/issues/${CARRY}`])).body ?? "";
if (body.includes(HEAD)) {
  console.log("planned 0 change(s)");
} else {
  const anchor = "\n\n**Source:**";
  if (!body.includes(anchor)) throw new Error(`#${CARRY}: no Source line to insert before`);
  console.log(`${APPLY ? "" : "would "}add the M1 phase review section (6 boxes) to #${CARRY}`);
  if (APPLY)
    gh(
      ["api", `repos/${REPO}/issues/${CARRY}`, "--method", "PATCH", "--input", "-"],
      JSON.stringify({ body: body.replace(anchor, `\n\n${SECTION}${anchor}`) }),
    );
  console.log(`${APPLY ? "applied" : "planned"} 1 change(s)`);
}
