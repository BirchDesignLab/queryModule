// m2-p0-epics-close-2026-10-18.mjs: close the M2 P0 and P0.5 epics, as BirchDesignLab
// (session "M2 Manager 8", board batch in docs/handoffs/10-18-26-m2-manager-7.md).
//
// Does: closes epics #43 (Contracts, M2 P0) and #519 (Dispatch, M2 P0.5) as completed, each
// with a one-line comment. The M2 milestone stays open (P2 and P3 are under way).
// Guard (checked before any write): neither epic has an open sub-issue. Closed epics are
// skipped, so a rerun is a no-op.
// Usage (repo root): node scripts/board/m2-p0-epics-close-2026-10-18.mjs [--apply]
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const REPO = "BirchDesignLab/queryModule";
const EPICS = [43, 519];
const tok = spawnSync("gh", ["auth", "token", "-u", "BirchDesignLab"], { encoding: "utf8" });
if (tok.status !== 0) throw new Error("no gh token for BirchDesignLab");
const env = { ...process.env, GH_TOKEN: tok.stdout.trim() };

function gh(args, input) {
  const r = spawnSync("gh", args, { env, encoding: "utf8", input });
  if (r.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}
const api = (path, method = "GET", body) =>
  JSON.parse(
    gh(
      ["api", path, "--method", method, ...(body ? ["--input", "-"] : [])],
      body ? JSON.stringify(body) : undefined,
    ) || "null",
  );
const listAll = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

let changes = 0;
const plan = (what, fn) => {
  changes += 1;
  console.log(`${APPLY ? "" : "would "}${what}`);
  if (APPLY) fn();
};

// Guard
for (const n of EPICS) {
  const subs = listAll(`repos/${REPO}/issues/${n}/sub_issues?per_page=100`);
  const open = subs.filter((s) => s.state === "open").map((s) => s.number);
  if (open.length > 0) throw new Error(`#${n} has open sub-issues: #${open.join(", #")}`);
  console.log(`#${n}: ${subs.length} sub-issue(s), all closed`);
}

// Epics
const NOTE =
  "Phase done: every sub-issue is closed (M2 P0 closed by P0-W3, #688). Closed in the M2 Manager 8 board batch, 10-18-26.";
for (const n of EPICS) {
  const issue = api(`repos/${REPO}/issues/${n}`);
  if (issue.state === "closed") continue;
  plan(`close #${n} "${issue.title}" as completed, with the phase-done note`, () => {
    api(`repos/${REPO}/issues/${n}/comments`, "POST", { body: NOTE });
    api(`repos/${REPO}/issues/${n}`, "PATCH", { state: "closed", state_reason: "completed" });
  });
}

console.log(`${APPLY ? "applied" : "planned"} ${changes} change(s)`);
