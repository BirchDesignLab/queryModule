# Workflows: `sdd-task` and `wave-review`

Saved Workflow scripts that run implementation plans in place of hand-dispatched subagents (ADR-0006, developer direction 09-26-26). One PR per wave: each task of a wave runs through `sdd-task` in turn on one wave branch `feat/<phase>-wave-<k>`, and `wave-review` runs once per wave PR that touches sensitive paths.

| File | Purpose |
|---|---|
| `sdd-task.js` | One plan task: implement, review, rule, fix, gate, ledger |
| `wave-review.js` | Whole-branch review of a sensitive wave PR, one fix pass, one re-review, the `docs/reviews/pr-<n>.md` artifact |
| `../../scripts/sdd/task-brief.sh` | Extracts one `### Task N:` section of a plan into a brief file |
| `../../scripts/sdd/workflow-harness.mjs` | Mock harness: runs both scripts against stubbed agents |

Vocabulary: **role** (implementer, spec reviewer, quality reviewer, critic, ruler, fixer, escalated fixer, progress checker, re-reviewer, gate, ledger; in `wave-review`, reviewer and the rest). Not "seat".

## Script facts

- Plain JavaScript. Each file starts with `export const meta = {...}` as a pure literal. The body returns its result with a top-level `return`, so Biome skips `.claude/workflows` (`biome.json`) and a raw `node --check` fails with "Illegal return statement". The harness imports each body wrapped in an async function, which also proves that it parses.
- `Date.now()`, `Math.random()` and an argless `new Date()` are unavailable. There is no filesystem or Node API; agents do all file and git IO.
- Every agent is fresh. Fix rounds re-read the brief, report and findings from files.
- A resume re-runs from the first changed `agent()` call; completed calls are cached.
- Every `agent()` call goes through `role(name)`, which merges `args.roles[name]` over the defaults, returns `{ model, effort }`, drops effort for Haiku, and throws on a missing model, a model outside `haiku|sonnet|opus` (Fable is rejected), or a missing or invalid effort.

## `sdd-task`

### Arguments

```
{
  task: 7, title: "SiteConfig schema v1: fields, conditions, query types", issue: 8,
  repoDir: "C:\\git\\queryModule", branch: "feat/p0-wave-2", base: "<full sha, HEAD before the task>",
  briefPath, reportPath, workDir,          // workDir: per-task review files (SDD workspace)
  scratchRoot, runLabel: "w2-t7",          // agent scratch: <scratchRoot>/<runLabel>/<agent label>/
  ledgerPath,                              // optional; the ledger step appends lines
  sensitive: false, ui: false,
  ids: "BR-001, FR-032",
  specRefs: "spec 4.1 lines 140-260; ...", // what the spec reviewer and the ruler read
  requirementsDoc,                         // optional; default the repo-root Requirements Definition
  globalConstraints: "<plan bullets>",     // required, non-empty
  carries: "<controller rulings and interfaces the brief cannot know>",
  trailer: "Co-Authored-By: ...",          // fallback commit trailer
  roles: { ... optional overrides ... },
  maxRounds: 5,                            // numeric strings and floats are coerced (logged); clamped to 1..8
  answers: { at: "<stopped value>", text } // only on a re-run after a stop (below)
}
```

Required: `task`, `title`, `repoDir`, `branch`, `base`, `briefPath`, `reportPath`, `workDir`, `scratchRoot`, `runLabel`, `specRefs`, `globalConstraints`, `trailer`. A missing or empty one throws before any agent runs.

### Roles and defaults

| Role | Ordinary task | Sensitive task (`sensitive: true`) |
|---|---|---|
| implementer (also `implementer-continue`) | sonnet / medium | opus / medium |
| specReviewer | sonnet / medium | sonnet / medium |
| qualityReviewer | sonnet / high | sonnet / high |
| critic (only when `sensitive` or `ui`) | opus / medium | opus / medium |
| ruler | opus / low | opus / medium |
| fixer (rounds 1 to 3) | same as implementer | same as implementer |
| escalatedFixer (round 4 on, or a finding NOT ADDRESSED twice) | one step up from fixer | opus / high |
| progressChecker | sonnet / low | sonnet / low |
| reReviewer | sonnet / medium | opus / medium |
| gate | sonnet / low | sonnet / low |
| ledger | haiku (no effort) | haiku |

Step-up ladder: haiku to sonnet/medium; sonnet/low to sonnet/medium; sonnet/medium to sonnet/high; sonnet/high or xhigh to opus/medium; opus/low to opus/medium; opus/medium to opus/high; opus/high to opus/xhigh.

### Flow

1. **Implement.** The implementer reads the brief, checks the precondition (branch is `branch`, HEAD is `base`), works TDD, commits only its files with the brief's message and the trailer, and writes `reportPath`. Returns `{ status, commits, head, testSummary, concerns:[{kind: planVsSpec|correctness|observation, text}], questions }`.
   - BLOCKED or NEEDS_CONTEXT: stop (`stopped: "implementer"`), unless `answers` is given (below).
   - A planVsSpec or correctness concern goes to the ruler (`ruler-concerns`). A `fix` ruling gets one pre-review fixer and progress check; progress problems there are passed to the reviewers.
   - Observations become deferred minors.
2. **Review** (parallel): spec reviewer, quality reviewer, and the critic on sensitive or UI tasks. Each builds its own diff file in its scratch path, reads it once, writes `workDir/task-<n>-review-<spec|quality|critic>.md` and returns `{ verdict: pass|fail, findings:[{id, severity, file, line, summary, fix, planMandated, contestsRuling}], cannotVerify:[{item, check}] }`.
   - Reviewers see the rulings in force. A finding that contradicts one sets `contestsRuling` to its id.
   - The spec reviewer cites requirement IDs verbatim, checks fixtures against the fixture policy, and treats missing or implausible RED evidence as important.
   - A null reviewer stops the run (`stopped: "review"`).
3. **Rule** (`ruler-review`) on plan-mandated critical or important findings, findings that contest a ruling, and cannot-verify items. Decisions: `fix` (with fixInstruction), `stands`, `verified` (the check passed; a failed check is `fix`), `escalate`. Optional `carryForward` lists obligations for later tasks. The spec is binding.
   - On sensitive tasks the ruler prompt carries this rule verbatim: "On sensitive tasks the ruler must escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules." The script also escalates a critical ruled `stands` or `verified` on a sensitive task.
   - Any escalation stops the run (`stopped: "ruler-review"`, or `"ruler-concerns"` before review). An item with no ruling is parked.
4. **Fix loop**, round r = 1..maxRounds, while critical or important findings are open: fixer (escalated fixer from round 4 or on a repeat), progress checker (new commits, clean tree, no `.skip`/`.only`, no test file deleted or emptied, test count not lower), re-reviewer (ADDRESSED or NOT ADDRESSED per finding over the fix diff only; new breakage; out-of-scope minors). Fixers see the rulings in force and never reverse one. Progress problems become open findings. A new finding that contests a ruling is parked for the controller.
5. **Gate** (`gate-0` after a clean review, `gate-r<r>` after a fix loop that ends clean): runs `pnpm lint`, `pnpm typecheck` and `pnpm test` once each in `repoDir`, confirms the branch and that HEAD equals the reported head, and that the tree is clean. Returns `{ ok, head, problems }`. Problems become open findings and go back through the fix loop within `maxRounds`. `complete` needs a green gate.
6. **Ledger** (optional; Haiku, Edit append only). The script computes the lines; they also come back as `ledgerLines`.
7. **Return** (below).

Worst case at the default maxRounds 5: 30 agents (implementer, concern ruler, pre-review fixer and progress check, three reviewers, review ruler, a red gate after review, five rounds of fixer, progress, re-review and red gate, ledger). A run whose findings are never addressed stops at 24. An answered implementer stop adds one `implementer-continue`. Typical ordinary task: 5 agents clean (6 with a ruler), 8 or 9 with one fix round.

### Return

```
{ task, status: "complete" | "parked" | "stopped", base, head, commits, rounds, rulings,
  carryForward, deferredMinors, parked, questions, concerns, ledgerLines?,
  stopped?: "implementer" | "ruler-concerns" | "fixer-pre" | "review" | "ruler-review" | "fixer-r<r>" | "gate",
  escalated?: [ruling] }
```

- `complete`: review clean and gate green. Tick the plan checkboxes, move `carryForward` into the next task's `carries`, and read `rulings` (every planVsSpec ruling goes into the wave PR body).
- `parked`: the round cap was reached, or an item got no ruling, or a new finding contests a ruling. Adjudicate `parked`.
- `stopped`: a controller decision is needed. Answer `questions` or `escalated`, then re-run with `answers`.

### Ledger lines

```
- Task <N>: Ruling: <what> {EM DASH} <decision>: <why> {EM DASH} <cost if wrong>
- Task <N>: carry forward: <obligation>
- Task <N>: fix round <r>/<max> (<k> addressed, <m> open; head <h7>)
- Task <N>: gate-r<r> red (<k> problem(s))
- Task <N>: minor (deferred): <id> <file:line> <summary>
- Task <N>: complete (commits <base7>..<head7>, review clean, gate green) | (..., <K> parked)
- Task <N>: stopped at <stage> (head <h7>); controller action needed
```

`{EM DASH}` stands for the U+2014 separator the SDD ledger (git-ignored scratch) already uses; committed docs do not contain the character itself.

## `wave-review`

### Arguments

```
{ pr, base, head, repoDir, planPath, ledgerPath, workDir, scratchRoot, runLabel,
  sensitiveFiles: [], questions: [], artifactPath: "docs/reviews/pr-<pr>.md",
  specPath?, requirementsDoc?, date?: "MM-DD-YY", trailer, roles }
```

Required: `pr`, `base`, `head`, `repoDir`, `planPath`, `workDir`, `scratchRoot`, `runLabel`, `trailer`.

### Roles and defaults

| Role | Default |
|---|---|
| reviewer | opus / xhigh |
| ruler | opus / high |
| fixer | opus / medium |
| progressChecker | sonnet / low |
| reReviewer | opus / xhigh |

### Flow

1. **Review.** Whole-branch review of `base..head` against the plan, the spec (binding) and the requirements, with the sensitive-file list, the ledger's `Ruling` and `minor (deferred)` lines, the controller's questions and a "declined to judge" list. Writes `workDir/<runLabel>-review.md`, and the artifact only on approve with no open critical or important finding. Returns `{ verdict: approve|fixes, reviewedSha, findings:[... contests], answers, declined, artifactWritten }`.
2. **Rule** on critical or important findings that are plan-mandated or contest a ledger Ruling. The ruler prompt carries the escalation rule above verbatim, always, plus "A Critical finding may be ruled fix or escalate, never stands." The script escalates a critical ruled `stands` or `verified`. Any escalation stops the run.
3. **One fix pass** with the complete list (critical and important must be fixed; minors when small). Rulings in force are passed; the fixer never reverses one. Then the progress checker. Its problems become findings `progress-<k>`.
4. **One re-review** of the fix diff against the first review file. It verdicts every finding including `progress-*`: ADDRESSED, NOT ADDRESSED (also to reject a ruling), or STANDS. A critical is never STANDS. Every important accepted as STANDS must be listed in `acceptedStands` with the id of the stands ruling. No approve while any critical is open. It writes the artifact at the fix head on approve. There is no second fix pass.

Worst case: 5 agents.

### Artifact

```
---
reviewer: "opus-5.5"
effort: "xhigh"
reviewedSha: "<full head sha>"
verdict: "approve"
---
```

Front matter comes from the role that writes it; an override changes it, so the sensitive-review check fails closed. The body: scope, findings summary (with each ruling id kept as stands), answers, remaining minors. No em dashes; MM-DD-YY dates. The agent writes but never commits it.

### Return

```
{ verdict: "approve" | "fixes", reviewedSha, artifactWritten, findings, residual, answers,
  declined, rulings, fixCommits?, strayArtifact?,
  stopped?: "reviewer" | "ruler" | "fixer" | "re-review", escalated?, questions? }
```

- `approve` with `artifactWritten`: commit the artifact on top of the reviewed head and push.
- `approve` without `artifactWritten`: re-run the review. Never hand-write the artifact.
- `fixes` without `stopped`: adjudicate `residual`.
- `stopped` set: a decision is needed (see the script header for each value).
- `strayArtifact` set: delete that file.
- `declined` lists behaviours the reviewer set aside; the controller rules on each.

## Controller procedure

Before an `sdd-task` run:
1. The wave branch is checked out in `repoDir` with a clean tree. `base = git rev-parse HEAD` (full sha).
2. `bash scripts/sdd/task-brief.sh PLAN N <workDir>/task-<N>-brief.md`.
3. Fill `specRefs` with real spec line ranges, `globalConstraints` with the plan's bullets (P0: note the one-PR-per-wave exception), `carries` with earlier rulings, `carryForward` items and interfaces.
4. State the role plan (model and effort per role) before the run.

After it: act on `status` (above). Every run leaves its review files in `workDir`.

Answering a stop, without re-implementing:
1. Keep every arg identical, `carries` included. Add `answers: { at: <the returned stopped value>, text: "<answers>" }`.
2. Re-run: `Workflow({ scriptPath: ".claude/workflows/sdd-task.js", args: <same args + answers>, resumeFromRunId: "<runId>" })`.
3. Answers go only into agent calls at and after the stop point (rulers, fixers, the continue implementer), never into the implementer's prompt, so every earlier call replays from cache.
4. After an implementer stop, the cached implementer replays and `implementer-continue` gets the brief, the report, the questions and the answers, and finishes on top of the existing commits.
5. If the continue implementer stops again, re-run with new `answers.text`; only the continuation re-runs.

Resume after a pause, kill or script edit: the same call without new answers. Changing `roles` or any prompt input invalidates the cache from that call on.

Before a `wave-review` run: every task of the wave is `complete`, the branch is committed and clean, the ledger is current, `head` is the sha to review. After it: see Return.

## Harness

`node scripts/sdd/workflow-harness.mjs` (repo root, PowerShell or Git Bash). It imports each script from a data URL with the body wrapped in an async function, stubs `agent()` and `parallel()`, and asserts: every call has a model and an effort (none for Haiku); no prompt contains `undefined`; every schema has an object root with `required` inside `properties`; every mock return validates. Scenarios cover the happy path, the gate, worst-case counts, rulings routing, the sensitive ruler rule, answers re-runs, arg validation, `maxRounds` coercion, and the `wave-review` guards. Run it after any change to a workflow; it exits 1 on a failure.
