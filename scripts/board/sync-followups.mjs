// sync-followups.mjs: bring docs/board/board-data.json follow-ups in line with GitHub
// before a board --apply (checker chore, 09-29-26).
//
// Why: gh-setup-project.mjs --apply writes the stored body back to each issue, so a box
// someone ticked on GitHub is reverted unless the stored body is refreshed first. This
// script (1) refreshes title and body of every stored follow-up from GitHub, and
// (2) upserts the entries given in a JSON file (metadata the board needs: milestone,
// parent, track, phase, size, priority, reqIds; title and body always come from GitHub).
//
// Usage (repo root):
//   node scripts/board/sync-followups.mjs [--add <entries.json>] [--as BirchDesignLab]
// Reads only from GitHub; writes only docs/board/board-data.json. Review the diff, then
// run the board dry run.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const as = opt("--as") ?? "BirchDesignLab";
const addPath = opt("--add");
const token = execFileSync("gh", ["auth", "token", "-u", as], { encoding: "utf8" }).trim();
const gh = (n) =>
  JSON.parse(
    execFileSync("gh", ["issue", "view", String(n), "--json", "title,body,labels"], {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: token },
    }),
  );

const dataPath = "docs/board/board-data.json";
const data = JSON.parse(readFileSync(dataPath, "utf8"));
const adds = addPath ? JSON.parse(readFileSync(addPath, "utf8")) : [];

for (const entry of adds) {
  const live = gh(entry.number);
  const next = { ...entry, title: live.title, body: live.body };
  if (!next.labels) next.labels = live.labels.map((l) => l.name);
  const i = data.followUps.findIndex((f) => f.number === entry.number);
  if (i === -1) data.followUps.push(next);
  else data.followUps[i] = { ...data.followUps[i], ...next };
  console.log(`${i === -1 ? "added" : "updated"} #${entry.number}`);
}

for (const f of data.followUps) {
  const live = gh(f.number);
  if (live.title !== f.title || live.body !== f.body) {
    f.title = live.title;
    f.body = live.body;
    console.log(`synced #${f.number} from GitHub`);
  }
}

data.followUps.sort((a, b) => a.number - b.number);
writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
