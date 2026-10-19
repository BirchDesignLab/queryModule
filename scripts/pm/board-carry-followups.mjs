#!/usr/bin/env node
// Phase close-out helper for docs/board/board-data.json (M2 Manager 9, 10-19-26).
//
// Edits followUps entries textually, so the rest of the file keeps its
// formatting; run `pnpm exec biome format --write docs/board/board-data.json`
// afterwards (Biome wants short arrays on one line).
//
//   --sync 754,755,760      refresh title and body from GitHub (keeps ticked
//                           boxes; otherwise --apply reverts them)
//   --move 754,755          set parent and phase from --parent and --phase
//   --add 767:S:Medium,...  append a follow-up from GitHub: title, body,
//                           milestone and labels from the issue, track from its
//                           web/platform/core label, reqIds "none"
//   --parent 46 --phase P3  target for --move and --add
//
// Reads GitHub with the active gh account; writes only the local file.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "docs/board/board-data.json";
const REPO = "BirchDesignLab/queryModule";
const TRACKS = { web: "Web (B)", platform: "Platform (A)", core: "Core" };

const argv = process.argv.slice(2);
const args = Object.fromEntries(
  argv.flatMap((a, i) => (a.startsWith("--") ? [[a.slice(2), argv[i + 1]]] : [])),
);
const list = (v) => (v ? v.split(",").filter(Boolean) : []);
const parent = args.parent ? Number(args.parent) : undefined;
const phase = args.phase;

const issue = (n) =>
  JSON.parse(
    execFileSync(
      "gh",
      ["issue", "view", String(n), "--repo", REPO, "--json", "title,body,milestone,labels"],
      {
        encoding: "utf8",
      },
    ),
  );

let text = readFileSync(FILE, "utf8");
const data = JSON.parse(text);
const byNumber = new Map(data.followUps.map((f) => [f.number, f]));

const render = (entry) =>
  JSON.stringify(entry, null, 2)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

function replaceEntry(entry) {
  const start = text.indexOf(`    {\n      "number": ${entry.number},\n`);
  if (start < 0) throw new Error(`#${entry.number}: entry not found textually`);
  const end = text.indexOf("\n    }", start) + "\n    }".length;
  text = text.slice(0, start) + render(entry) + text.slice(end);
}

const sync = new Set(list(args.sync).map(Number));
const move = new Set(list(args.move).map(Number));
for (const n of new Set([...sync, ...move])) {
  const entry = byNumber.get(n);
  if (!entry) throw new Error(`#${n}: not in followUps`);
  if (sync.has(n)) {
    const gh = issue(n);
    entry.title = gh.title;
    entry.body = gh.body.endsWith("\n") ? gh.body : `${gh.body}\n`;
  }
  if (move.has(n)) {
    if (parent === undefined || !phase) throw new Error("--move needs --parent and --phase");
    entry.parent = parent;
    entry.phase = phase;
  }
  replaceEntry(entry);
}

const added = [];
for (const spec of list(args.add)) {
  const [n, size, priority] = spec.split(":");
  const number = Number(n);
  if (byNumber.has(number)) throw new Error(`#${number}: already in followUps`);
  if (parent === undefined || !phase || !size || !priority)
    throw new Error(`--add ${spec}: needs n:size:priority, --parent, --phase`);
  const gh = issue(number);
  const labels = gh.labels.map((l) => l.name);
  const trackLabel = labels.find((l) => TRACKS[l]);
  if (!trackLabel) throw new Error(`#${number}: no web/platform/core label`);
  added.push({
    number,
    milestone: gh.milestone?.title,
    parent,
    track: TRACKS[trackLabel],
    phase,
    size,
    priority,
    reqIds: "none",
    title: gh.title,
    body: gh.body.endsWith("\n") ? gh.body : `${gh.body}\n`,
    labels,
  });
}
if (added.length > 0) {
  const tail = "\n    }\n  ]\n}";
  const at = text.lastIndexOf(tail);
  if (at < 0) throw new Error("followUps tail not found");
  const insert = added.map((e) => `,\n${render(e)}`).join("");
  text = `${text.slice(0, at + "\n    }".length)}${insert}${text.slice(at + "\n    }".length)}`;
}

JSON.parse(text);
writeFileSync(FILE, text);
console.log(
  `synced ${[...sync].join(" ") || "-"}; moved ${[...move].join(" ") || "-"}; added ${added.map((e) => e.number).join(" ") || "-"}`,
);
