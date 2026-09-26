# Workflows: `sdd-task` and `wave-review`

Saved Workflow scripts that run implementation plans in place of hand-dispatched subagents (ADR-0006, developer direction 09-26-26). One PR per wave: each task of a wave runs through `sdd-task` in turn on one wave branch `feat/<phase>-wave-<k>`, and `wave-review` runs once per wave PR that touches sensitive paths.

| File | Purpose |
|---|---|
| `sdd-task.js` | One plan task: implement, review with gate-0, check, rule, fix, gate; returns the ledger lines |
| `wave-review.js` | Whole-branch review of a sensitive wave PR, one fix pass, one re-review, the `docs/reviews/pr-<n>.md` artifact |
| `../../scripts/sdd/task-brief.sh` | Extracts one `### Task N:` section of a plan into a brief file |
| `../../scripts/sdd/workflow-harness.mjs` | Mock harness: runs both scripts against stubbed agents |
| `../../scripts/sdd/append-ledger.mjs` | Appends an `sdd-task` result's `ledgerLines` to the SDD ledger (controller step) |

Vocabulary: **role** (implementer, spec reviewer, quality reviewer, critic, checker, ruler, fixer, escalated fixer, progress checker, re-reviewer, gate; in `wave-review`, reviewer and the rest). Not "seat".

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
  ledgerPath,                              // optional; only named in the log (the controller appends)
  sensitive: false, ui: false,
  critic: false,                           // optional boolean: critic on without sensitive or ui
  criticFocus: "<focus sentence>",         // optional non-empty string (see Roles)
  ids: "BR-001, FR-032",
  specRefs: "spec 4.1 lines 140-260; ...", // what the spec reviewer and the ruler read
  requirementsDoc,                         // optional; default the repo-root Requirements Definition
  globalConstraints: "<product and code constraints>", // required, non-empty (see below)
  carries: "<controller rulings and interfaces the brief cannot know>",
  trailer: "Co-Authored-By: ...",          // fallback commit trailer
  roles: { ... optional overrides ... },
  maxRounds: 5,                            // numeric strings and floats are coerced (logged); clamped to 1..8
  answers: [{ at, text?, decisions? }],   // only on a re-run after a stop: one entry per answered stop
  implemented: { head: "<full sha>" }      // optional: review stages only (see Fallbacks)
}
```

Required: `task`, `title`, `repoDir`, `branch`, `base`, `briefPath`, `reportPath`, `workDir`, `scratchRoot`, `runLabel`, `specRefs`, `globalConstraints`, `trailer`. A missing or empty one throws before any agent runs.

`globalConstraints` carries product and code constraints only: runtime, TDD, purity, fixtures, logging, docs style. It never carries process bullets (the model and effort plan, PR and push steps, commit trailers, branch naming), because every agent treats `globalConstraints` as binding. Leave out plan bullets addressed to the controller, such as the P0 plan's role plan bullet.

### Roles and defaults

| Role | Ordinary task | Sensitive task (`sensitive: true`) |
|---|---|---|
| implementer (also `implementer-continue`, `implementer-retry`) | sonnet / medium | opus / medium |
| specReviewer | sonnet / medium | sonnet / medium |
| qualityReviewer | sonnet / high | sonnet / high |
| critic (only when `sensitive`, `ui` or `critic: true`) | opus / medium | opus / medium |
| checker (only when cannot-verify items remain after controller decisions) | sonnet / low | sonnet / low |
| ruler | opus / low | opus / medium |
| fixer (rounds 1 to 3) | same as implementer | same as implementer |
| escalatedFixer (round 4 on, or a finding NOT ADDRESSED twice) | one step up from fixer | opus / high |
| progressChecker | sonnet / low | sonnet / low |
| reReviewer | sonnet / medium | opus / medium |
| gate | sonnet / low | sonnet / low |

There is no ledger role: the script returns `ledgerLines` and the controller appends them. An old `roles.ledger` override is logged as ignored, not an error.

`critic: true` turns the critic on for an ordinary task without changing any tier or ruler rule (the sensitive ruler rule still follows `sensitive` only). Its focus, when neither `sensitive` nor `ui` is set: "correctness and security risk: fail-open paths, data that crosses a trust boundary (server to client, config to audit), contract drift from the spec, tests that cannot fail". `criticFocus` replaces that sentence; on a sensitive or UI task the usual focus stays and `criticFocus` is appended. A non-boolean `critic` or an empty `criticFocus` throws at start.

Step-up ladder: haiku to sonnet/medium; sonnet/low to sonnet/medium; sonnet/medium to sonnet/high; sonnet/high or xhigh to opus/medium; opus/low to opus/medium; opus/medium to opus/high; opus/high to opus/xhigh.

### Flow

Every `sdd-task` agent can run shell commands, so every `sdd-task` prompt carries this line through the shared rules (implementer and its continue and retry, reviewers, critic, checker, rulers, fixers, progress checker, re-reviewer, gate); in `wave-review`, the fixer carries it: "Never run git push, gh pr (any subcommand), gh api writes, or git merge into another branch; the controller and the developer own the remote." (W2 incident: an implementer pushed and opened a PR after reading project memory.)

1. **Implement.** The implementer reads the brief, checks the precondition (branch is `branch`, HEAD is `base`, clean tree), works TDD, commits only its files with the brief's message and the trailer, and writes `reportPath`. Before each commit it runs `pnpm lint` (fixing formatting with `pnpm exec biome format --write <files>` or `pnpm exec biome check --write <files>` on the changed files only) and `pnpm coverage`, never commits on red, and reports both. Returns `{ status, commits, head, testSummary, concerns:[{kind: planVsSpec|correctness|observation, text}], questions }`.
   - A failed precondition stops the run (`stopped: "precondition"`, `stopPoint: "precondition:implementer"`, `problem`, which names each untracked or modified file for a dirty tree); it never becomes a finding.
   - With `implemented: { head }` the implementer is skipped and the run reviews `base..head` (review stages only).
   - BLOCKED or NEEDS_CONTEXT: stop (`stopped: "implementer"`), unless `answers` is given (below).
   - A planVsSpec or correctness concern goes to the ruler (`ruler-concerns`). A `fix` ruling gets one pre-review fixer and progress check; progress problems there are passed to the reviewers.
   - Observations become deferred minors.
2. **Review and gate-0** (parallel, on the same head `reviewHead`): spec reviewer, quality reviewer, the critic on sensitive, UI or `critic: true` tasks, and `gate-0`. Each reviewer builds its own diff file in its scratch path, reads it once, writes `workDir/task-<n>-review-<spec|quality|critic>.md` and returns `{ verdict: pass|fail, findings:[{id, severity, file, line, summary, fix, planMandated, contestsRuling}], cannotVerify:[{item, check}] }`.
   - Reviewers see the rulings in force. A finding that contradicts one sets `contestsRuling` to its id.
   - The spec reviewer cites requirement IDs verbatim, checks fixtures against the fixture policy, and treats missing or implausible RED evidence as important.
   - Reviewers are told the gate runs `pnpm lint`, `pnpm typecheck` and `pnpm coverage` on the same head, so they never list lint, typecheck, tests, coverage or the report's test counts as cannot-verify.
   - A null reviewer stops the run (`stopped: "review"`).
   - `gate-0` problems become open findings (`gate-0:<k>`) next to the reviewer findings. A `gate-0` precondition failure (branch or HEAD mismatch) stops the run after the reviewers return (`stopped: "precondition"`, `stopPoint: "precondition:gate-0"`); a null `gate-0` stops it (`stopped: "gate-0"`).
   - A finding with a controller decision (`answers.decisions`) is settled by it and skips the ruler.
3. **Check** (`checker`, read-only, one agent). Controller decisions given at or before the `review` stop (entries at `implementer`, `ruler-concerns`, `fixer-pre`, `review`, or the implementer and gate-0 precondition stops) settle their cannot-verify items first, and those items never reach the checker. A decision given later (for example at `ruler-review`) applies after the checker and overrides its result, so the checker prompt stays identical and replays from cache on resume. The checker runs each remaining item's suggested check (it may run tests, grep and git reads; it never edits or commits) and returns per item `{ id, result: verified | failed | needsJudgment, evidence }`. `verified` becomes a ruling with source `checker`; `failed` becomes an open important finding; `needsJudgment`, or no result, goes to the ruler. Re-reviews return no cannot-verify items, so the checker runs at most once.
   - A failed check is always an important finding, even on a sensitive task. If a failed check touches a sensitive invariant, the controller can escalate it: answer at the next stop with a `decisions` entry, or adjudicate it when the run parks.
   - **Repository state after gate-0.** The checker and `ruler-review` run after the only gate that saw the tree, so each reports `head`, `treeClean` and `dirtyFiles` (from `git rev-parse HEAD` and `git status --porcelain`). A head other than the gate-0 head, or a dirty tree, stops the run (`stopped: "precondition"`, `stopPoint: "precondition:checker"` or `"precondition:ruler-review"`, `problem` naming the files), and nothing from that call is applied. Fix the repo and answer at that stop point; the agent re-runs once as `checker-retry` or `ruler-review-retry`. `ruler-concerns` runs before gate-0 and has no such check.
4. **Rule** (`ruler-review`) on plan-mandated critical or important findings, findings that contest a ruling, and cannot-verify items the checker marked `needsJudgment`. It runs only if one of those remains. Decisions: `fix` (with fixInstruction), `stands`, `verified` (the check passed; a failed check is `fix`), `escalate`. Optional `carryForward` lists obligations for later tasks. The spec is binding.
   - On sensitive tasks the ruler prompt carries this rule verbatim: "On sensitive tasks the ruler must escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules." The script also escalates a critical ruled `stands` or `verified` on a sensitive task.
   - Any escalation stops the run (`stopped: "ruler-review"`, or `"ruler-concerns"` before review). An item with no ruling is parked.
   - Controller decisions settle their items before the ruler is called; if every item is decided, the ruler does not run. Rule (c) and the other escalation rules never re-escalate a controller decision.
   - One ruling per item is in force. A later ruling supersedes an earlier one on the same item, and a `fix` ruling on a finding that contests a ruling supersedes the contested ruling. Precedence: controller over ruler or checker, later over earlier. Prompts show only rulings in force; superseded ones come back as `supersededRulings`.
5. **Fix loop**, round r = 1..maxRounds, while critical or important findings are open: fixer (escalated fixer from round 4 or on a repeat), progress checker (new commits, clean tree, no `.skip`/`.only`, no test file deleted or emptied, test count not lower, and check 6 below), re-reviewer (ADDRESSED or NOT ADDRESSED per finding over the fix diff only; new breakage; out-of-scope minors). Fixers run the same `pnpm lint` and `pnpm coverage` self-check before each commit. Fixers see the rulings in force and never reverse one. Progress problems become open findings (`progress-r<r>-<k>`). A new finding that contests a ruling is parked for the controller.
   - **Mechanical round:** when every open finding going into the round came from a gate (`gate-*`) or the progress checker (`progress-*`), the re-reviewer is skipped; the progress checker and `gate-r<r>` decide. Findings from reviewers, the critic, the checker or the ruler still get the re-reviewer. The log names the path taken.
   - **Gate weakening (check 6).** Fixers are told never to change vitest config files, `biome.json`, `tsconfig*.json`, `package.json` scripts or coverage thresholds or excludes, never to add suppression comments (`biome-ignore`, `@ts-ignore`, `@ts-expect-error`, istanbul, v8 or c8 ignore, `eslint-disable`), and never to delete the code a gate complains about, unless the brief or a ruling in force asks for it. The progress checker flags each such change in `guardHits`; each hit is an open important finding `progress-r<r>-guard-<k>`, which makes the next round non-mechanical, so the re-reviewer judges it.
   - **Gate findings in a mixed round.** The re-reviewer sees the open `gate-*` findings but does not verdict them (it does not re-run the suite); they are marked "verified by gate-r<r>". They stay open while any other finding is open, so they reach every later fixer and are parked, never dropped, at the round cap. When only gate findings would remain, the round closes them and `gate-r<r>` decides.
6. **Gate.** `gate-0` ran in step 2; a clean review plus a green `gate-0` completes the task with no further gate. After a fix loop that ends clean, `gate-r<r>` runs. Each gate runs `pnpm lint`, `pnpm typecheck` and `pnpm coverage` (the full suite with the coverage thresholds) once each in `repoDir`, confirms the branch and that HEAD equals the expected head, and that the tree is clean. Returns `{ ok, head, problems, preconditionFailed? }`. A branch or HEAD mismatch is a precondition failure and stops the run. A red gate with no problem listed counts as one problem. Problems become open findings and go back through the fix loop within `maxRounds`. `complete` needs a green gate.
7. **Return** (below). The script computes the ledger lines and returns them as `ledgerLines`; no agent writes the ledger. With `ledgerPath` it logs "ledger: controller appends N lines to <ledgerPath>".

Agent counts at the default maxRounds 5:
- Typical ordinary task, clean: 4 (implementer, spec, quality, gate-0). With cannot-verify items only: 5 (plus the checker; a `needsJudgment` item adds the ruler). With a plan-mandated finding: plus the ruler.
- One fix round on reviewer findings: 8 (plus fixer, progress, re-review, gate-r1). One mechanical round after a red `gate-0`: 7 (plus fixer, progress, gate-r1).
- Worst case: 26 (implementer, concern ruler, pre-review fixer and progress check, three reviewers and `gate-0`, checker, review ruler, round 1 on a reviewer finding with fixer, progress, re-review and a red gate-r1, then four mechanical rounds of fixer, progress and a red gate). A run whose findings are never addressed parks at 24 (25 with a checker). An answered implementer or precondition stop adds one `implementer-continue` or retry agent (`implementer-retry`, `checker-retry`, `ruler-review-retry`, `gate-...-retry`). Controller decisions can remove the checker or a ruler call.

### Return

```
{ task, status: "complete" | "parked" | "stopped", base, head, commits, rounds,
  rulings, supersededRulings, carryForward, deferredMinors, parked, questions, concerns,
  answersUnconsumed?, ledgerLines, stopPoint?,
  stopped?: "implementer" | "precondition" | "ruler-concerns" | "fixer-pre" | "review" |
            "ruler-review" | "fixer-r<r>" | "gate-0" | "gate-r<r>",
  problem?, escalated?: [ruling] }
```

Each ruling carries `source`: `ruler`, `checker` (a cannot-verify item the checker verified) or `controller`. `ledgerLines` is always returned; append it with `append-ledger.mjs` (Controller procedure).

- `complete`: review clean and gate green. Tick the plan checkboxes, move `carryForward` into the next task's `carries`, and read `rulings` (every planVsSpec ruling goes into the wave PR body).
- `parked`: the round cap was reached, or an item got no ruling, or a new finding contests a ruling. Adjudicate `parked`.
- `stopped`: a controller decision is needed. Answer `questions`, `escalated` or `problem`, then re-run with `answers` (Controller procedure).

Stop points and the agent that consumes the answers there:

| `stopped` | Consumer of `answers` |
|---|---|
| `implementer` | `implementer-continue`, which finishes on top of the existing commits |
| `precondition` (`stopPoint` `precondition:implementer`, `precondition:gate-0`, `precondition:checker`, `precondition:ruler-review`, `precondition:gate-r<r>`) | the agent that failed it, re-run once as `implementer-retry`, `checker-retry`, `ruler-review-retry` or `gate-...-retry` |
| `ruler-concerns` | `ruler-concerns` |
| `fixer-pre` | `fixer-pre` |
| `review` | `ruler-review`, then the fixers |
| `ruler-review` | `ruler-review` |
| `fixer-r<r>` | `fixer-r<r>` |
| `gate-0`, `gate-r<r>` | `fixer-r1`, `fixer-r<r+1>` |

Each entry's text is delivered to exactly one agent: the first consumer at or after its stop point that runs (normally the consumer in this table). So an agent's prompt holds only the entries for its own stop point, and a later entry never changes an earlier agent's prompt. For a precondition entry, use the returned `stopPoint` as `at`; a plain `precondition` goes to the first precondition failure. An `at` that is not in this table throws at start. Answers that no agent consumed in the run are logged and returned as `answersUnconsumed: true`. Editing an earlier entry (for example adding a decision on an item escalated at an earlier stop) changes that stop's consumer prompt, so the run replays from cache only up to that stop and re-runs everything after it.

### Ledger lines

```
- Task <N>: Ruling: <what> {EM DASH} <decision>: <why> {EM DASH} <cost if wrong>
- Task <N>: Ruling (controller): <what> {EM DASH} <decision>: <why> {EM DASH} controller decision
- Task <N>: Ruling (checker): <what> {EM DASH} verified: <evidence> {EM DASH} checker verified; ...
- Task <N>: Ruling superseded: <item> (<old decision>) by <item> (<new decision>): <why>
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
  specPath?, requirementsDoc?, date?: "MM-DD-YY", trailer, roles,
  answers?: [{ at, text?, decisions? }] }
```

Required: `pr`, `base`, `head`, `repoDir`, `planPath`, `workDir`, `scratchRoot`, `runLabel`, `trailer`. `artifactPath` must be `docs/reviews/pr-<pr>.md`; anything else throws. `wave-review` takes no `globalConstraints`, and the same rule applies to `questions` and `answers`: product and code constraints only, never process bullets.

### Roles and defaults

| Role | Default |
|---|---|
| reviewer | opus / xhigh |
| ruler | opus / high |
| fixer | opus / medium |
| progressChecker | sonnet / low |
| reReviewer | opus / xhigh |

### Flow

1. **Review.** Whole-branch review of `base..head` against the plan, the spec (binding) and the requirements, with the sensitive-file list, the ledger's `Ruling` and `minor (deferred)` lines, the controller's questions and a "declined to judge" list. It checks a precondition first (`head` resolves, `base` is its ancestor, clean tree); a failure stops the run (`stopped: "precondition"`) before any ruler or fixer. Writes `workDir/<runLabel>-review.md`, and the artifact only on approve with no open critical or important finding. Returns `{ verdict: approve|fixes, reviewedSha, preconditionFailed, findings:[... contests], answers, declined, artifactWritten }`. Its prompt never carries answers, so a re-run with answers replays it from cache.
2. **Controller decisions, then Rule.** Findings with a controller decision are settled by it (final for the run; a controller `stands` on a critical stands). The ruler runs on the other critical or important findings that are plan-mandated or contest a ledger Ruling. The ruler prompt carries the escalation rule above verbatim, always, plus "A Critical finding may be ruled fix or escalate, never stands." The script escalates a critical ruled `stands` or `verified`. Any escalation stops the run.
3. **One fix pass** with the complete list (critical and important must be fixed; minors when small). The fixer runs `pnpm lint`, `pnpm typecheck` and `pnpm coverage` once each and carries the no-push, no-PR, no-merge rule. Rulings in force are passed; the fixer never reverses one. A fixer precondition failure (HEAD moved, dirty tree) stops the run. Then the progress checker. Its problems become findings `progress-<k>`.
4. **One re-review** of the fix diff against the first review file. It verdicts every finding including `progress-*`: ADDRESSED, NOT ADDRESSED (also to reject a ruler ruling), or STANDS. A controller ruling is final. Otherwise a critical is never STANDS. Every important accepted as STANDS must be listed in `acceptedStands` with the id of the stands ruling. No approve while any critical is open. It writes the artifact at the fix head on approve. There is no second fix pass.

Worst case: 5 agents, plus one `reviewer-retry` and one `fixer-retry` on answered precondition stops (7).

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
  declined, rulings, supersededRulings, fixCommits?, strayArtifact?, answersUnconsumed?,
  stopped?: "reviewer" | "precondition" | "ruler" | "fixer" | "re-review", stopPoint?,
  problem?, escalated?, questions? }
```

- `approve` with `artifactWritten`: commit the artifact on top of the reviewed head and push.
- `approve` without `artifactWritten`: re-run the review. Never hand-write the artifact.
- `fixes` without `stopped`: adjudicate `residual`.
- `stopped` set: a decision is needed. Stop points and consumers: `reviewer` (the reviewer returned nothing): the ruler, fixer and re-reviewer; `precondition` (`stopPoint` `precondition:reviewer` or `precondition:fixer`; the problem names each untracked or modified file and calls out a stray artifact): the failing agent re-runs once as `reviewer-retry` or `fixer-retry`; `ruler`: decisions settle the escalated items and text goes to the fixer and re-reviewer; `fixer`: the fixer; `re-review`: the re-reviewer. Another `at` throws. Delivery is first consumer that runs, so `reviewer` or `ruler` text reaches the re-reviewer when no ruler or fixer runs.
- `strayArtifact` set: delete that file.
- `declined` lists behaviours the reviewer set aside; the controller rules on each.

## Controller procedure

Before an `sdd-task` run:
1. The wave branch is checked out in `repoDir` with a clean tree. `base = git rev-parse HEAD` (full sha).
2. `bash scripts/sdd/task-brief.sh PLAN N <workDir>/task-<N>-brief.md`.
3. Fill `specRefs` with real spec line ranges, `globalConstraints` with the plan's product and code constraint bullets only (no process bullets), `carries` with earlier rulings, `carryForward` items and interfaces.
4. State the role plan (model and effort per role) before the run.

After it:
1. Append the ledger lines: save the run's result (the task output file holds it) and run `node scripts/sdd/append-ledger.mjs <workflow-output-file> <ledgerPath>` (PowerShell or Git Bash). It accepts a bare result object or any text that contains the result JSON, appends `ledgerLines` with a trailing newline and prints the count; exit 2 is a usage error or an unreadable file, exit 3 means no `ledgerLines` were found. A re-run on the same result writes nothing when those lines are already the ledger's tail ("already appended"). Input saved as UTF-16 (PowerShell 5.1 `Out-File` or `>`) is decoded by its BOM; a UTF-16 ledger is refused (exit 2).
2. Act on `status` (above). Every run leaves its review files in `workDir`.

Answering a stop, without re-implementing:
1. Keep every arg identical, `carries` and `questions` included. `answers` is a list with one entry per answered stop: append `{ at: <the returned stopped value, or stopPoint for a precondition>, text: "<answers>", decisions: [{ item, decision: "fix" | "stands" | "verified", reason, fixInstruction? }] }`. Use `decisions` to settle an escalated item; the item id is the one in `escalated`. A single object is accepted as a one-entry list.
2. Re-run with the full args every time: `Workflow({ scriptPath: ".claude/workflows/<sdd-task | wave-review>.js", resumeFromRunId: "<runId>", args: <same args + answers> })` (see "Resuming a run" below).
3. Each entry's text goes to exactly one agent, the consumer for its stop point, never into the implementer's or the reviewer's prompt, so every earlier call replays from cache. Never answer by editing `questions` or `carries`: that re-runs the review or the implementation.
4. Decisions from all entries become controller rulings (`source: "controller"`, ledgered as `Ruling (controller)`); a later entry wins for the same item. They are final for the run and never re-escalated; a controller `stands` on a Critical stands, and a controller `fix` goes to the fixer with its `fixInstruction`.
5. After an implementer stop, the cached implementer replays and `implementer-continue` gets the brief, the report, the questions and the answers, and finishes on top of the existing commits.
6. Answers accumulate. On a second stop, keep every earlier entry exactly as it was and append a new entry for the new stop point. Never edit, replace or drop an earlier entry: its consumer's cache key depends on it, and the earlier stop's continue or retry agent then replays from cache. If the same stop point stops again, append another entry with the same `at`; its consumer re-runs with both.

Resume after a pause, kill or script edit: the same call without new answers. Changing `roles` or any prompt input invalidates the cache from that call on.

### Resuming a run

- A resume always re-passes the full args. The call shape is `{ scriptPath, resumeFromRunId, args }`. `Workflow({ scriptPath, resumeFromRunId })` without `args` throws at the first required-arg check, because the script re-validates its args on every run.
- Stopping a run mid-review (a pause or kill while reviewers or the checker are working) loses their partial work: an agent that had not returned is not cached and re-runs from the start on resume. The cheap place to intervene is at a stop, where every finished agent is cached and the answers go to one consumer.

Before a `wave-review` run: every task of the wave is `complete`, the branch is committed and clean, the ledger is current, `head` is the sha to review. After it: see Return.

## Fallbacks: a resumed run replays a null or failed agent

Whether the Workflow runtime caches an agent that returned nothing is runtime behaviour this repo has not verified. If a resumed run (`resumeFromRunId`) replays the same null or failed agent and stops again at the same place, stop resuming and use the fallback below. A fresh run means the same args without `resumeFromRunId`, so every agent runs live.

**sdd-task: a fresh run after the implementer committed fails the `base` precondition** (HEAD is no longer `base`), and stops with `stopped: "precondition"`. That stop is safe but a dead end. Two ways on:
- **Review stages only (default).** Keep `base` (the commit before the task) and add `implemented: { head: "<git rev-parse HEAD>" }`. The implementer is skipped, and the run reviews `base..head`, rules, fixes and gates as usual. Carry any earlier answers except `implementer` and `precondition:implementer` entries (those throw with `implemented`). The implementer's report and TDD evidence stay in `reportPath` from the earlier run.
- **Reset and redo.** `git reset --hard <base>` on the wave branch, then a fresh run. This discards the task's commits, so it needs the developer's OK first. Never reset silently.

| `stopped` (sdd-task) | How to answer (resume) | If the resumed run replays a null or failed agent |
|---|---|---|
| `implementer` | append `{ at: "implementer", text }`; `implementer-continue` finishes the task | No commits since `base`: a fresh run. Commits since `base`: review stages only, or reset with the developer's OK. |
| `precondition` (`precondition:implementer`) | fix the repo (branch, HEAD, the files named), append `{ at: stopPoint, text }`; `implementer-retry` runs | A fresh run (HEAD is still `base`, nothing was committed). |
| `precondition` (`precondition:gate-...`) | fix the branch or HEAD, append `{ at: stopPoint, text }`; the gate re-runs as `gate-...-retry` | Review stages only with `implemented.head` set to the current HEAD. |
| `precondition` (`precondition:checker`, `precondition:ruler-review`) | restore the head gate-0 checked and a clean tree (the problem names the files), append `{ at: stopPoint, text }`; the agent re-runs as `checker-retry` or `ruler-review-retry` | Review stages only with `implemented.head` set to the current HEAD. |
| `ruler-concerns` | append `{ at: "ruler-concerns", text, decisions }` | Review stages only, with the decisions carried in `answers`. |
| `fixer-pre` | append `{ at: "fixer-pre", text }` | Review stages only. |
| `review` | append `{ at: "review", text }` (it reaches `ruler-review`) | Review stages only. |
| `ruler-review` | append `{ at: "ruler-review", text, decisions }` | Review stages only, with the decisions carried in `answers`. |
| `fixer-r<r>` | append `{ at: "fixer-r<r>", text }` | Review stages only; the fixes already committed are reviewed with the rest. |
| `gate-0`, `gate-r<r>` | append `{ at: "gate-...", text }` (it reaches the next fixer round) | Review stages only; the gate runs again at the end. |

| `stopped` (wave-review) | How to answer (resume) | If the resumed run replays a null or failed agent |
|---|---|---|
| `reviewer` | append `{ at: "reviewer", text }` (it reaches the ruler, else the fixer, else the re-reviewer) | A fresh run. Always safe: nothing changes before the fixer. |
| `precondition` (`precondition:reviewer`) | fix the repo (delete a named stray artifact, commit or stash the named files), append `{ at: stopPoint, text }`; `reviewer-retry` runs | A fresh run. |
| `precondition` (`precondition:fixer`) | fix the repo, append `{ at: stopPoint, text }`; `fixer-retry` runs | A fresh run with `head` set to the current HEAD. |
| `ruler` | append `{ at: "ruler", text, decisions }` | A fresh run with the same `answers`: the decisions settle the escalated items again. |
| `fixer` | append `{ at: "fixer", text }` | A fresh run with `head` set to the current HEAD (commit or discard the fixer's partial work with the developer's OK first). |
| `re-review` | append `{ at: "re-review", text }` | A fresh run with `head` set to the fix head: the whole-branch review covers the fix. |

## Harness

`node scripts/sdd/workflow-harness.mjs` (repo root, PowerShell or Git Bash). It imports each script from a data URL with the body wrapped in an async function, stubs `agent()` and `parallel()`, and asserts: every call has a model and an effort (none for Haiku); no prompt contains `undefined`; every schema has an object root with `required` inside `properties`; every mock return validates. A runaway-loop guard fails any scenario past 200 agent calls. Scenarios cover two answered stops in a row for both scripts, the post-pilot items (gate runs coverage, reviewers never list gate checks as cannot-verify, the no-remote rule and the pre-commit self-check in every shell-running prompt, `critic` and `criticFocus`, the checker, `gate-0` in parallel with the reviewers, mechanical rounds without a re-reviewer, no ledger agent, `append-ledger.mjs` parsing, exit codes, idempotence and UTF-16 input, this README's resume shape; and the fix pass: post-gate head and tree checks for the checker and `ruler-review`, a cache-stable checker on a `ruler-review` answer, gate-weakening flags, gate findings in mixed rounds and at the cap, the no-remote rule in every prompt, the `criticFocus` warning), the review-stages-only run, the happy path, the gate, worst-case counts, rulings routing and supersession, the sensitive ruler rule, answers re-runs and controller decisions in both scripts, stop-point consumers, precondition stops, arg validation, `maxRounds` coercion, and the `wave-review` guards. Run it after any change to a workflow; it exits 1 on a failure.
