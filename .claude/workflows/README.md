# Workflows: `sdd-task`, `sdd-wave` and `wave-review`

Saved Workflow scripts that run implementation plans in place of hand-dispatched subagents (ADR-0006, developer direction 09-26-26). One PR per wave: each task of a wave runs through `sdd-task` in turn on one wave branch `feat/<phase>-wave-<k>`, and `wave-review` runs once per wave PR that touches sensitive paths.

| File | Purpose |
|---|---|
| `sdd-task.js` | One plan task at its review tier: implement, review with gate-0, check, rule, fix, gate; returns the ledger lines |
| `sdd-wave.js` | A whole wave: each task as a nested `sdd-task` run, in order, with carries flowing forward; stops at the first task that does not complete |
| `smoke/sdd-task-stub.js` | Zero-agent stand-in for `sdd-task` (`sddTaskPath`), to smoke-test `sdd-wave` in the real runtime |
| `wave-review.js` | Whole-branch review of a sensitive wave PR, one fix pass, one re-review, the branch-keyed (or `docs/reviews/pr-<n>.md`) artifact |
| `../../scripts/sdd/task-brief.sh` | Extracts one `### Task N:` section of a plan into a brief file |
| `../../scripts/sdd/workflow-harness.mjs` | Mock harness: runs both scripts against stubbed agents |
| `../../scripts/sdd/append-ledger.mjs` | Appends an `sdd-task` result's `ledgerLines` to the SDD ledger (controller step) |

Vocabulary: **role** (implementer, reviewer (the combined spec and quality reviewer), spec reviewer, quality reviewer, critic, checker, ruler, fixer, escalated fixer, progress checker, re-reviewer, gate; in `wave-review`, reviewer and the rest). Not "seat".

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
  tier: "ordinary",                        // optional: "ordinary" (default) | "gate" | "critical" (see Review tiers)
  sensitive: false, ui: false,             // sensitive: true is an alias for tier "critical"
  critic: false,                           // optional boolean: critic on for an ordinary task
  criticFocus: "<focus sentence>",         // optional non-empty string (see Roles)
  ids: "BR-001, FR-032",
  specRefs: "spec 4.1 lines 140-260; ...", // what the spec reviewer and the ruler read
  requirementsDoc,                         // optional; default the repo-root Requirements Definition
  globalConstraints: "<product and code constraints>", // required, non-empty (see below)
  carries: "<controller rulings and interfaces the brief cannot know>",
  trailer: "Co-Authored-By: ...",          // fallback commit trailer
  roles: { ... optional overrides ... },
  maxAgents: 18,                           // agent budget per run; default by tier (ordinary 18, gate 20,
                                           // critical 24); coerced like maxRounds (logged); at least 1
  maxRounds: 2,                            // default 2; numeric strings and floats are coerced (logged); clamped to 1..8
  answers: [{ at, text?, decisions?, noCode? }], // only on a re-run after a stop: one entry per answered stop
  implemented: { head: "<full sha>" }      // optional: review stages only (see Fallbacks)
}
```

Required: `task`, `title`, `repoDir`, `branch`, `base`, `briefPath`, `reportPath`, `workDir`, `scratchRoot`, `runLabel`, `specRefs`, `globalConstraints`, `trailer`. A missing or empty one throws before any agent runs.

`globalConstraints` carries product and code constraints only: runtime, TDD, purity, fixtures, logging, docs style. It never carries process bullets (the model and effort plan, PR and push steps, commit trailers, branch naming), because every agent treats `globalConstraints` as binding. Leave out plan bullets addressed to the controller, such as the P0 plan's role plan bullet.

### Review tiers

`tier` follows ADR-0007 and the P0 review-roles retro (`docs/retros/2026-09-26-p0-review-roles.md`): **ordinary** for work outside `.github/sensitive-paths`, **gate** for work on `[gate]` paths (CI, check scripts, ops scripts, lint, test and TypeScript config, `package.json`), **critical** for `[critical]` paths (credentials, audit, dispatch, adapters, delegation, the terminal parser, write-back, delete-from-view, migrations, contracts, the sensitive-review gate). `sensitive: true` is still accepted as an alias for `tier: "critical"` (the log says so); `sensitive` and `tier` given together must agree (`sensitive: true` with a tier other than critical, or `sensitive: false` with critical, throws). An unknown tier throws. Default: ordinary.

- **ordinary and gate** run one **combined reviewer** (role `reviewer`) in place of the spec and quality reviewers. It does both reviews in one pass: the spec-compliance checks (requirement IDs cited verbatim, FR-, UX-, SEC-, BR-, NFR- and the rest; the fixture policy; RED evidence) and the quality checks. It writes `workDir/task-<n>-review.md` and tags every finding and cannot-verify item with `kind: spec | quality`, so ids read `spec:S1`, `quality:Q1`, `spec:CV1` as with the split reviewers, and the ledger and rulings stay readable.
- **critical** keeps the split spec reviewer and quality reviewer (`task-<n>-review-spec.md`, `task-<n>-review-quality.md`) exactly as before.
- The **critic** runs on gate and critical tasks, on UI tasks and with `critic: true`. Its focus follows the tier: sensitive-code risk (critical), gate-tier risk (gate: fail-open checks, git or tool failures read as pass, shallow clones, empty inputs, rename or path bypasses, a weakened threshold), UI risk (`ui`).
- The **sensitive ruler rule** (below) and the script's rule (c) apply to gate and critical tasks.

### Roles and defaults

A `roles` override still wins per role.

| Role | ordinary | gate | critical |
|---|---|---|---|
| implementer (also `implementer-continue`, `implementer-retry`) | sonnet / medium | sonnet / medium | opus / medium |
| reviewer (combined spec and quality) | sonnet / high | sonnet / high | not used |
| specReviewer | not used | not used | sonnet / medium |
| qualityReviewer | not used | not used | sonnet / high |
| critic | only with `critic: true` or `ui`: opus / medium | opus / medium | opus / medium |
| checker (only when cannot-verify items remain after controller decisions) | sonnet / low | sonnet / low | sonnet / low |
| ruler | opus / low | opus / low | opus / medium |
| fixer (rounds 1 to 3) | same as implementer | same as implementer | same as implementer |
| escalatedFixer (round 4 on, or a finding NOT ADDRESSED twice) | one step up from fixer (sonnet / high) | opus / medium | opus / high |
| progressChecker | sonnet / low | sonnet / low | sonnet / low |
| reReviewer | sonnet / medium | sonnet / high | opus / medium |
| gate | sonnet / low | sonnet / low | sonnet / low |
| verifyHead (Haiku 4.5, model only: the API rejects effort on Haiku) | haiku | haiku | haiku |

There is no ledger role: the script returns `ledgerLines` and the controller appends them. An old `roles.ledger` override is logged as ignored, not an error.

`critic: true` turns the critic on for an ordinary task without changing any tier or ruler rule (the sensitive ruler rule still follows the tier only). Its focus, when the tier is ordinary and `ui` is not set: "correctness and security risk: fail-open paths, data that crosses a trust boundary (server to client, config to audit), contract drift from the spec, tests that cannot fail". `criticFocus` replaces that sentence; on a gate, critical or UI task the usual focus stays and `criticFocus` is appended. A non-boolean `critic` or an empty `criticFocus` throws at start.

Step-up ladder: haiku to sonnet/medium; sonnet/low to sonnet/medium; sonnet/medium to sonnet/high; sonnet/high or xhigh to opus/medium; opus/low to opus/medium; opus/medium to opus/high; opus/high stays opus/high (no step to xhigh, developer decision 09-26-26, #92). No default role in this table is xhigh or max; a `roles` override may still ask for one, and the script logs one warning line per role overridden that way.

### Flow

Every `sdd-task` agent can run shell commands, so every `sdd-task` prompt carries this line through the shared rules (implementer and its continue and retry, reviewers, critic, checker, rulers, fixers, progress checker, re-reviewer, gate); in `wave-review`, the fixer carries it: "Never run git push, gh pr (any subcommand), gh api writes, or git merge into another branch; the controller and the developer own the remote." (W2 incident: an implementer pushed and opened a PR after reading project memory.)

1. **Implement.** The implementer reads the brief, checks the precondition (branch is `branch`, HEAD is `base`, clean tree), works TDD, commits only its files with the brief's message and the trailer, and writes `reportPath`. Before each commit it runs `pnpm lint` (fixing formatting with `pnpm exec biome format --write <files>` or `pnpm exec biome check --write <files>` on the changed files only), `pnpm typecheck` (vitest does not typecheck test files; W3 Task 14's gate-0 was red on tsc errors in a test) and `pnpm coverage`, never commits on red, and reports all three. Returns `{ status, commits, head, testSummary, concerns:[{kind: planVsSpec|correctness|observation, text}], questions }`. The `head` it reports is never used: `verifyHead` (below) reads the head from git right after the implementer.
   - **Heads come from git (#222).** Every head the script uses (`expectedHead`, `reviewHead`, the gate heads, the carried `base`, the returned `head`) comes from `verifyHead`, never from an implementer, fixer, progress checker or gate field. `verifyHead` is a Haiku 4.5 agent (role `verifyHead`, model only) that runs `git rev-parse HEAD` and `git cat-file -e <sha>^{commit}` in `repoDir` and returns the raw stdout of each (`revParse`, `catFile`); its prompt never carries the sha an earlier agent reported. The script accepts only a value that matches `^[0-9a-f]{40}$` and that `cat-file` confirmed for that same sha: the second command prints `EXISTS <sha>` and the script requires the printed sha to equal `revParse`, so a mis-copied or invented `revParse` cannot pass. It runs after the implementer (`verify-head-impl`, also on the `implemented.head` path), after the pre-review fixer's progress check (`verify-head-pre`) and after each fix round's progress check (`verify-head-r<r>`). A head an agent reported that differs from git (a prefix of at least 7 hex is not a difference) is logged as `agent-reported head <first 16 hex>... differs from git; using git` and the git value is used. A gate's `head` is no longer read at all: its precondition already required HEAD to equal the verified expected head. An invalid answer (not 40 hex, or the commit is missing) stops the run (`stopped: "precondition"`, `stopPoint: "precondition:verifyHead"`, `problem` naming `verifyHead`); answer there and it re-runs once as `verify-head-...-retry`. `verifyHead` counts against `maxAgents`.
   - A failed precondition stops the run (`stopped: "precondition"`, `stopPoint: "precondition:implementer"`, `problem`, which names each untracked or modified file for a dirty tree); it never becomes a finding.
   - With `implemented: { head }` the implementer is skipped and the run reviews `base..head` (review stages only).
   - BLOCKED or NEEDS_CONTEXT: stop (`stopped: "implementer"`), unless `answers` is given (below).
   - A planVsSpec or correctness concern goes to the ruler (`ruler-concerns`). A `fix` ruling gets one pre-review fixer and progress check; progress problems there are passed to the reviewers.
   - Observations become deferred minors.
2. **Review and gate-0** (parallel, on the same head `reviewHead`): the combined reviewer (ordinary and gate) or the spec and quality reviewers (critical), the critic on gate, critical, UI or `critic: true` tasks, and `gate-0`. Each reviewer builds its own diff file in its scratch path, reads it once, writes its review file (`workDir/task-<n>-review.md` for the combined reviewer, `task-<n>-review-<spec|quality|critic>.md` otherwise) and returns `{ verdict: pass|fail, findings:[{id, severity, file, line, summary, fix, planMandated, contestsRuling, kind?}], cannotVerify:[{item, check, kind?}] }` (`kind` from the combined reviewer only).
   - **Diff scope.** Reviewer and critic prompts say: after the diff, read outside the diff only files that call or are called by the changed code, and only for a concrete risk you can name, one focused check per risk; the spec lines in `specRefs` and the rulings in force still apply; do not read unrelated files. The re-reviewer has its own scope: the fix diff, and a caller or callee of the changed code only for a named risk, under the same limits. Each names every file it read outside the diff and the risk that sent it there.
   - Rulers and fixers find the review files as `task-<n>-review*.md`, which matches the combined `task-<n>-review.md` and the split `task-<n>-review-<spec|quality|critic>.md`.
   - Reviewers see the rulings in force. A finding that contradicts one sets `contestsRuling` to its id.
   - The spec reviewer (or the combined reviewer) cites requirement IDs verbatim, checks fixtures against the fixture policy, and treats missing or implausible RED evidence as important.
   - Reviewers are told the gate runs `pnpm lint`, `pnpm typecheck` and `pnpm coverage` on the same head, so they never list lint, typecheck, tests, coverage or the report's test counts as cannot-verify.
   - A null reviewer stops the run (`stopped: "review"`).
   - `gate-0` problems become open findings (`gate-0:<k>`) next to the reviewer findings. A `gate-0` precondition failure (branch or HEAD mismatch) stops the run after the reviewers return (`stopped: "precondition"`, `stopPoint: "precondition:gate-0"`); a null `gate-0` stops it (`stopped: "gate-0"`).
   - A finding with a controller decision (`answers.decisions`) is settled by it and skips the ruler.
3. **Check** (`checker`, read-only, one agent). Controller decisions given at or before the `review` stop (entries at `implementer`, `ruler-concerns`, `fixer-pre`, `review`, or the implementer and gate-0 precondition stops) settle their cannot-verify items first, and those items never reach the checker. A decision given later (for example at `ruler-review`) applies after the checker and overrides its result, so the checker prompt stays identical and replays from cache on resume. The checker runs each remaining item's suggested check (it may run tests, grep and git reads; it never edits or commits) and returns per item `{ id, result: verified | failed | needsJudgment, evidence }`. `verified` becomes a ruling with source `checker`; `failed` becomes an open important finding; `needsJudgment`, or no result, goes to the ruler. Re-reviews return no cannot-verify items, so the checker runs at most once.
   - **A null checker** (it died or was skipped) reported no head or tree. Its items go to `ruler-review`, which checks HEAD and tree when it runs. If no ruler call runs after it (every item was decided by a later controller entry) and nothing is open, the run stops with `stopPoint: "precondition:checker"` instead of completing on an unchecked tree; answer there and the checker re-runs once as `checker-retry` (a null retry stops there again; each further answer re-runs it once more). A null checker takes only `precondition:checker` answers, never a plain `precondition` one, and a checker that returns a clean result consumes a pending `precondition:checker` answer. With open findings, the fixers and the gate check the tree anyway.
   - A failed check is always an important finding, even on a sensitive task. If a failed check touches a sensitive invariant, the controller can escalate it: answer at the next stop with a `decisions` entry, or adjudicate it when the run parks.
   - **Repository state after gate-0.** The checker and `ruler-review` run after the only gate that saw the tree, so each reports `head`, `treeClean` and `dirtyFiles` (from `git rev-parse HEAD` and `git status --porcelain`). A head other than the gate-0 head, or a dirty tree, stops the run (`stopped: "precondition"`, `stopPoint: "precondition:checker"` or `"precondition:ruler-review"`, `problem` naming the files), and nothing from that call is applied. Fix the repo and answer at that stop point; the agent re-runs once as `checker-retry` or `ruler-review-retry`. `ruler-concerns` runs before gate-0 and has no such check.
4. **Rule** (`ruler-review`) on plan-mandated critical or important findings, findings that contest a ruling, and cannot-verify items the checker marked `needsJudgment`. It runs only if one of those remains. Decisions: `fix` (with fixInstruction), `stands`, `verified` (the check passed; a failed check is `fix`), `escalate`. Optional `carryForward` lists obligations for later tasks. The spec is binding.
   - On gate and critical tasks the ruler prompt carries this rule verbatim: "On sensitive tasks the ruler must escalate any ruling that would: (a) weaken a security, audit, credential, delegation or dispatch invariant; (b) change a shape frozen at a phase gate or listed as a contract file (master plan 8.2); (c) keep a Critical finding with stands. Everything else it rules." The script also escalates a critical ruled `stands` or `verified` on a gate or critical task.
   - Any escalation stops the run (`stopped: "ruler-review"`, or `"ruler-concerns"` before review). An item with no ruling is parked.
   - Controller decisions settle their items before the ruler is called; if every item is decided, the ruler does not run. Rule (c) and the other escalation rules never re-escalate a controller decision.
   - One ruling per item is in force. A later ruling supersedes an earlier one on the same item, and a `fix` ruling on a finding that contests a ruling supersedes the contested ruling. Precedence: controller over ruler or checker, later over earlier. Prompts show only rulings in force; superseded ones come back as `supersededRulings`.
5. **Fix loop**, round r = 1..maxRounds, while critical or important findings are open: fixer (escalated fixer from round 4 or on a repeat), progress checker (new commits, clean tree, no `.skip`/`.only`, no test file deleted or emptied, test count not lower, and check 6 below), re-reviewer (ADDRESSED or NOT ADDRESSED per finding over the fix diff only; new breakage; out-of-scope minors). Fixers run the same `pnpm lint`, `pnpm typecheck` and `pnpm coverage` self-check before each commit. Fixers see the rulings in force and never reverse one. Progress problems become open findings (`progress-r<r>-<k>`). A round with no new commits is a progress problem, even when the re-reviewer marks every finding ADDRESSED on the empty diff, so a fixer that fails to commit is caught; the one exception is a `fixer-r<r>` stop answered with `noCode: true` (table below), where `progress-r<r>` waives the new-commits check and keeps every other check. A new finding that contests a ruling is parked for the controller.
   - **Mechanical round:** when every open finding going into the round came from a gate (`gate-*`) or the progress checker (`progress-*`), the re-reviewer is skipped; the progress checker and `gate-r<r>` decide. Findings from reviewers, the critic, the checker or the ruler still get the re-reviewer. The log names the path taken.
   - **Gate weakening (check 6).** Fixers are told never to change vitest config files, `biome.json`, `tsconfig*.json`, `package.json` scripts or coverage thresholds or excludes, never to add suppression comments (`biome-ignore`, `@ts-ignore`, `@ts-expect-error`, istanbul, v8 or c8 ignore, `eslint-disable`), and never to delete the code a gate complains about, unless the brief or a ruling in force asks for it. The progress checker flags each such change in `guardHits`; each hit is an open important finding `progress-r<r>-guard-<k>`, which makes the next round non-mechanical, so the re-reviewer judges it.
   - **Gate findings in a mixed round.** The re-reviewer sees the open `gate-*` findings but does not verdict them (it does not re-run the suite); they are marked "verified by gate-r<r>". They stay open while any other finding is open, so they reach every later fixer and are parked, never dropped, at the round cap. When only gate findings would remain, the round closes them and `gate-r<r>` decides.
6. **Gate.** `gate-0` ran in step 2; a clean review plus a green `gate-0` completes the task with no further gate. After a fix loop that ends clean, `gate-r<r>` runs. Each gate runs `pnpm lint`, `pnpm typecheck` and `pnpm coverage` (the full suite with the coverage thresholds) once each in `repoDir`, confirms the branch and that HEAD equals the expected head, and that the tree is clean. Returns `{ ok, head, problems, preconditionFailed? }` (`head` is informational; the script keeps the `verifyHead` value). A branch or HEAD mismatch is a precondition failure and stops the run. A red gate with no problem listed counts as one problem. Problems become open findings and go back through the fix loop within `maxRounds`. `complete` needs a green gate.
7. **Return** (below). The script computes the ledger lines and returns them as `ledgerLines`; no agent writes the ledger. With `ledgerPath` it logs "ledger: controller appends N lines to <ledgerPath>".

`maxRounds` defaults to 2 (developer rule 09-27-26): a task still open after fix round 2 parks, the controller rules on each parked finding (fix inline, "stands" with a follow-up issue, or a no-code ruling answered with `noCode: true`), and a follow-on run continues. An explicit `maxRounds` (1..8) still wins.

Agent counts at the default maxRounds 2 (no budget stop):

| | ordinary | gate | critical |
|---|---|---|---|
| Clean task | 4 (implementer, verifyHead, combined reviewer, gate-0) | 5 (plus the critic) | 6 (implementer, verifyHead, spec, quality, critic, gate-0) |
| One fix round on reviewer findings | 9 | 10 | 11 |
| Worst case | 19 (20 with `ui` or `critic: true`) | 20 | 21 |
| Worst case at an explicit maxRounds 5 | 31 (32 with `ui` or `critic: true`) | 32 | 33 |

- A cannot-verify item adds the checker; a `needsJudgment` item or a plan-mandated finding adds the ruler. One mechanical round after a red `gate-0` adds 4 (fixer, progress, verifyHead, gate-r1). `verifyHead` adds one call after the implementer, one after the pre-review fixer and one per fix round (up to 4 at maxRounds 2, 7 at maxRounds 5).
- Worst case: implementer, concern ruler, pre-review fixer and progress check, the reviewers, critic and `gate-0`, checker, review ruler, round 1 on a reviewer finding with fixer, progress, re-review and a red gate-r1, then one mechanical round (four at maxRounds 5) of fixer, progress, verifyHead and a red gate, with a verifyHead after the implementer and after the pre-review fixer. A run whose findings are never addressed parks after round 2 at 17, 18, 19 (29, 30, 31 at maxRounds 5; one more with a checker). An answered implementer or precondition stop adds one `implementer-continue` or retry agent (`implementer-retry`, `checker-retry`, `ruler-review-retry`, `gate-...-retry`). Controller decisions can remove the checker or a ruler call.

### Agent budget

`maxAgents` caps the agent calls in one run. Its default follows the tier: ordinary 18, gate 20, critical 24 (the pre-#222 14, 16 and 20 plus 4: `verifyHead` adds up to 4 calls to the worst case at the default maxRounds 2, so raising every default by 4 keeps the gate and critical worst cases inside their caps and the ordinary one over its cap, as before); an explicit `maxAgents` wins (numeric strings and floats coerced and logged like `maxRounds`; at least 1). Every `agent()` call counts, a cached replay on resume included. When the next call would exceed the cap, it is not made and the run stops with `stopped: "budget"`, `stopPoint: "budget"` and a `problem` naming the count, the cap and the stage (for example `agent 21 would exceed maxAgents 20 at fixer-r3 (Fix)`). The parallel review block reserves all its calls first, so a budget stop never splits it. Findings still open at the stop are returned as `parked` too (for visibility; a resume recomputes them from cache). At the default maxRounds 2 the gate and critical worst cases fit their caps and the ordinary worst case (19) stops at budget; at maxRounds 5 the caps stop every worst case before it ends. A typical task stays well under them.

Answer at `budget` (`{ at: "budget", text, decisions? }`) and re-run with `resumeFromRunId` and the full args. Each budget entry raises the cap by the tier default (18, 20 or 24), once. The text goes to no agent (it is logged), so every earlier call replays from cache and the run resumes at the stage it stopped. Decisions apply like decisions at a later stop (after the checker). So a decision given at `budget` on a cannot-verify item still sends that item to the checker (one agent against the cap) before the decision overrides its result. If it stops at `budget` again, append another entry.

The result carries `agents` (the calls in this run), and the ledger `complete` line ends with `; <n> agents`.

### Return

```
{ task, status: "complete" | "parked" | "stopped", base, head, commits, rounds,
  rulings, supersededRulings, carryForward, deferredMinors, parked, questions, concerns,
  agents, answersUnconsumed?, ledgerLines, stopPoint?,
  stopped?: "implementer" | "precondition" | "ruler-concerns" | "fixer-pre" | "review" |
            "ruler-review" | "fixer-r<r>" | "gate-0" | "gate-r<r>" | "budget",  // precondition includes stopPoint "precondition:verifyHead"
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
| `fixer-r<r>` | `fixer-r<r>`; with `noCode: true` the text is a ruling that closes every finding open in round r with no code change, and `progress-r<r>` waives its new-commits check (only then) |
| `gate-0`, `gate-r<r>` | `fixer-r1`, `fixer-r<r+1>` |
| `budget` | none: the cap rises by the tier default per entry and the run resumes where it stopped |

Each entry's text is delivered to exactly one agent: the first consumer at or after its stop point that runs (normally the consumer in this table). So an agent's prompt holds only the entries for its own stop point, and a later entry never changes an earlier agent's prompt. For a precondition entry, use the returned `stopPoint` as `at`; a plain `precondition` goes to the first precondition failure and may carry text only (decisions there throw). An `at` that is not in this table throws at start, and so does `noCode` on any entry other than a `fixer-r<r>` entry with text (run wf_cfeda18c-be1: a no-code ruling at `fixer-r3` without it looped on "no new commits" to the budget). Answers that no agent consumed in the run are logged and returned as `answersUnconsumed: true`. Editing an earlier entry (for example adding a decision on an item escalated at an earlier stop) changes that stop's consumer prompt, so the run replays from cache only up to that stop and re-runs everything after it.

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
- Task <N>: complete (commits <base7>..<head7>, review clean, gate green; <n> agents) | (..., <K> parked; <n> agents)
- Task <N>: stopped at <stage> (head <h7>); controller action needed
```

`{EM DASH}` stands for the U+2014 separator the SDD ledger (git-ignored scratch) already uses; committed docs do not contain the character itself.

## `sdd-wave`

Runs every task of one wave in order, each as a nested `sdd-task` run (`workflow({ scriptPath })`, one level of nesting). Its only agents are the between-task `verifyHead` reads (`verify-head-t<n>`, Haiku) and it writes nothing to GitHub. The controller's work moves to the two ends of the wave: at the start it extracts every brief and writes every task's carries; at the end it does inline fixes, the checks, bookkeeping, push and PR, then `wave-review` for a sensitive wave (it needs the PR number, so it stays a separate run).

### Arguments

```
{
  wave: "w4", repoDir, branch: "feat/p0-wave-4", base: "<full sha, HEAD before the first task>",
  workDir, scratchRoot, ledgerPath?, globalConstraints, trailer, requirementsDoc?, maxRounds?,
  tier?: "ordinary" | "gate" | "critical",  // wave default; a task's tier or sensitive: true wins
  maxAgents?: 20,                   // wave default agent budget per task; a task's maxAgents wins; unset: the tier default
  roles?: { ... },                  // wave defaults; a task's roles override them per role
  sddTaskPath?: ".claude/workflows/sdd-task.js",
  tasks: [{ task: 17, title, issue?, ids?, specRefs, briefPath, carries?, reportPath?, runLabel?,
            tier?, sensitive?, ui?, critic?, criticFocus?, maxAgents?, roles?, implemented? }, ...],
  answers?: { "18": [{ at, text?, decisions? }] },  // per task, only on a re-run after a stop
  carried?: ["- Task 17 carry forward: ..."]         // a follow-on run: the carried of the run before
}
```

Required: `wave`, `repoDir`, `branch`, `base`, `workDir`, `scratchRoot`, `globalConstraints`, `trailer`, and a non-empty `tasks` list whose entries each have `task`, `title`, `specRefs` and `briefPath`. Task numbers are unique. A task entry never carries `base` or `answers` (the wave sets them), and `answers` keys must be task numbers in `tasks`. Defaults: `reportPath` is `<workDir>/task-<n>-report.md`, `runLabel` is `<wave>-t<n>`. Options a task does not set are not passed, so each nested run sees exactly what `sdd-task` would get by hand. `tier` and `maxAgents` are the exceptions: a wave-level value is passed to every task that does not set its own (a task that sets `sensitive`, true or false, gets no wave `tier`: `sensitive: true` makes it critical, `sensitive: false` ordinary, and a wave tier could conflict with either; so under a wave `tier: "critical"`, a task with `sensitive: false` runs as ordinary). `globalConstraints` follows the `sdd-task` rule: product and code constraints only.

### Flow

For each task: build its `sdd-task` args (shared fields, the task's own fields, `base`, `carries`, merged `roles`, its `answers` entry), run it, and record the result without its `ledgerLines`. On `complete`, the next task's `base` is this task's `head` read from git (#222): between two tasks the wave runs one `verifyHead` agent (`verify-head-t<n>`, Haiku, `git rev-parse HEAD` plus `git cat-file -e <sha>^{commit}`), so the carried `base` is never a head an agent reported; a child head that differs is logged and git's value wins, and an invalid answer stops the wave (`stop.stopPoint: "precondition:verifyHead"`; fix the repository, then start a fresh `sdd-wave` with `base` set to the current HEAD and `carried` set to the returned `carried`, which already holds the stopped task's carry-forward lines and stands rulings). There is no verify after the last task. These agents count in `totals.agents`. Its carries gain an "Earlier in this wave" block. It holds every earlier task's `carryForward` items (obligations; never capped) and its `stands` and `verified` ruler and controller rulings as precedents, with ids prefixed `T<n>/` so they never collide with the later task's own item ids; the most recent 30 ruling lines are kept and an omitted count is noted. A `fix` ruling was settled inside its own task and is not forwarded; checker rulings (verified checks) and deferred minors are not forwarded either. Any other status stops the wave; later tasks never start, because each builds on the one before.

### Return

```
{ wave, status: "complete" | "stopped" | "parked", stoppedTask?, stop?: { task, status, stopped,
  stopPoint, problem, questions, escalated, parked }, base, head, tasks: [sdd-task results
  without ledgerLines], totals: { tasks, run, completed, rounds, escalations, parked,
  deferredMinors, agents }, carried, ledgerLines }
```

`totals.agents` sums the tasks' `agents` (each nested run's agent calls). A task that stops at `budget` stops the wave; answer it with `answers["<task>"]: [{ at: "budget", text }]` like any other stop.

`carried` is the flow built so far (the "Earlier in this wave" lines). A task entry is the `sdd-task` result without `ledgerLines`, except for a child that threw (for example on an invalid arg): then it is `{ task, status: "stopped", base, head, problem }` and the ledger gets `- Task <n>: stopped at sdd-task (<problem>)`. An error that looks like a cancel, abort or budget stop is rethrown, not reported as a task stop.

`ledgerLines` is every task's lines in order plus one `- Wave <w>: complete (...)` or `- Wave <w>: stopped at Task <n> (...)` line, all at the top level, so `append-ledger.mjs` appends the whole wave in one call; a resumed wave repeats the earlier tasks' lines and `append-ledger.mjs` skips them. Wall clock and token use are not visible to a script: take them from the run's usage notice and `git log`.

### Answering a stop

Keep every arg identical and add `answers["<stoppedTask>"]`: the same list of `{ at, text?, decisions? }` entries `sdd-task` takes, built from `stop` exactly as for a single task (stop points and consumers in the `sdd-task` section). Re-run with `resumeFromRunId` and the full args. Earlier tasks' nested args are unchanged, so they replay from cache; the stopped task resumes at its stop point. The fallbacks for a replayed null agent (below) apply per task: for "review stages only", add `implemented: { head }` to that task's entry.

A `parked` task, or a child that threw, has no stop point to answer. Adjudicate it (inline fixes, or a fresh `sdd-task` run for that task), then run the remaining tasks as a new `sdd-wave` with `base` set to the current HEAD and `carried` set to the returned `carried`, so the flow from the finished tasks is kept.

## `wave-review`

### Arguments

```
{ pr?, branch?,                       // at least one required (both allowed); branch keys the artifact
  base, head, repoDir, planPath,      // planPath required unless contextPath is given
  ledgerPath, workDir, scratchRoot, runLabel,
  sensitiveFiles: [], questions: [],
  criticalFiles?: [], gateFiles?: [], // optional tier slices (#92); tier is derived when given
  reviewedLines?: 12,                 // optional small-diff fast path (#92)
  contextPath?,                       // optional context excerpt (#92), in place of the whole plan and ledger
  artifactPath?: "docs/reviews/<branch>.md" | "docs/reviews/pr-<pr>.md",  // must equal the computed path
  specPath?, requirementsDoc?, date?: "MM-DD-YY", trailer, roles,
  tier?: "critical" | "gate",        // default "critical" (or derived from criticalFiles/gateFiles);
                                      // "ordinary" throws (no wave-review needed)
  answers?: [{ at, text?, decisions? }] }
```

Required: `base`, `head`, `repoDir`, `workDir`, `scratchRoot`, `runLabel`, `trailer`, at least one of `pr` or `branch`, and `planPath` unless `contextPath` is given. `artifactPath`, when given, must equal the computed path (below); anything else throws. `wave-review` takes no `globalConstraints`, and the same rule applies to `questions` and `answers`: product and code constraints only, never process bullets.

**Branch-keyed artifact (R2, #92).** With `branch`, the artifact is `docs/reviews/<branch, "/" turned to "-">.md`; without it, `docs/reviews/pr-<pr>.md`. `branch` is validated exactly like `branchArtifactPath` in `scripts/ci/sensitive-review.ts` (every `"/"`-separated segment matches `^[A-Za-z0-9_][A-Za-z0-9._-]*$` and contains no `".."`); an invalid `branch` throws before any agent runs. Prompts name the PR number only when `pr` is given, so the review can land before the PR (and its number) exists.

### Roles and defaults

| Role | `tier: "critical"` (default) | `tier: "gate"` |
|---|---|---|
| reviewer | opus / high | opus / medium |
| ruler | opus / medium | opus / low |
| fixer | opus / medium | opus / medium |
| progressChecker | sonnet / low | sonnet / low |
| reReviewer | opus / high | opus / medium |

No default in this table is xhigh or max (developer decision 09-26-26, #92). A `roles` override may still ask for one; the script logs one warning line per role overridden that way. The artifact front matter still follows the role that writes it, so an override that lowers effort makes the check fail closed.

Review tier (ADR-0007): pass the PR's highest tier in `.github/sensitive-paths`, or give `criticalFiles`/`gateFiles` and let the tier derive (below). `tier: "ordinary"` throws: a PR with only `[deps]` or `[exempt]` changes, or no sensitive path, needs no `wave-review`. An unknown tier throws. A `roles` override still wins over the tier. The reviewer prompt is diff-scoped: the branch diff and the listed sensitive files, then callers or callees of the changed code only for a concrete risk it can name, one focused check per risk; the plan, spec and requirement lines the tasks cite and the ledger Rulings still apply, and the controller questions and the sensitive-file list still steer it. Never touch the repository tree while a run is active: the fixer's clean-tree precondition stops the run (PR #76, 09-26-26).

**Tier slices (R3, #92).** Give `criticalFiles` and/or `gateFiles` (the controller computes them from `.github/sensitive-paths`) to run one reviewer per non-empty slice instead of one reviewer over the whole `tier`: `sensitiveFiles` and `tier` are then derived (union of both lists; `tier` is critical when `criticalFiles` is non-empty, else gate); a passed `tier` that disagrees throws, and both lists empty throws (no wave-review needed). The slices run sequential, gate first, critical last, each reviewing only its own files (role `reviewer-gate` opus/medium, role `reviewer-critical` opus/high; a plain `roles.reviewer` override applies to both, a slice-named override wins over it). Finding ids are prefixed `G-` or `C-` and merge into the one Rule, Fix, Re-review flow. Only the last slice (the highest tier present) may write the artifact on the first pass, and only when every slice, including itself, approved with no open critical or important finding; its prompt carries the earlier slice's verdict and open-finding count. A slice reviewer that returns nothing stops the run at `reviewer` (the slice is named in `problem`). When neither list is given, one reviewer runs over `sensitiveFiles` at `tier`, as before.

**Small-diff fast path (R4, #92).** Give `reviewedLines` (added plus deleted lines over critical and gate files, from `git diff --numstat`; the controller computes it) at or below `FAST_PATH_MAX_LINES` (50, defined once in `wave-review.js` with a comment that it must equal the constant of the same name in `scripts/ci/sensitive-review.ts`) to run exactly one reviewer, no slices, covering every critical and gate file, at the highest tier's reviewer role. A clean approve writes the artifact with the extra front-matter line `mode: "fast"` and the run ends there: no ruler, fixer, progress checker or re-reviewer. A critical or important finding runs the normal flow instead, and the re-reviewer's artifact then carries no `mode` line (the fix may take the diff over the limit; the check counts again). Without `reviewedLines`, or above the limit, there is no fast path.

**Context diet (R5, #92).** Give `contextPath` (a controller-written excerpt holding only the ledger rulings and the plan and spec lines that touch the changed files) to have the reviewer, ruler and re-reviewer prompts point to it in place of the whole plan and ledger; `planPath` becomes optional when `contextPath` is given (still required otherwise). The spec and the requirements stay binding; reviewers read only the sections the excerpt cites unless a named risk needs more.

**Cross-cutting budget (R6, #92).** Every reviewer prompt (slices, fast path and the re-reviewer) allows at most 3 cross-cutting checks outside the diff, each for a named risk, listed in the review file under "Cross-cutting checks".

### Flow

1. **Review.** A single whole-tier reviewer, a fast-path reviewer, or one reviewer per tier slice (above), of `base..head` against the plan, the spec (binding) and the requirements, with the sensitive-file list, the ledger's `Ruling` and `minor (deferred)` lines, the controller's questions and a "declined to judge" list. It checks a precondition first (`head` resolves, `base` is its ancestor, clean tree); a failure stops the run (`stopped: "precondition"`) before any ruler or fixer. Writes `workDir/<runLabel>-review.md` (or, with tier slices, `workDir/<runLabel>-review-gate.md` and/or `-review-critical.md`), and the artifact only on approve with no open critical or important finding. Returns `{ verdict: approve|fixes, reviewedSha, preconditionFailed, findings:[... contests], answers, declined, artifactWritten }`. Its prompt never carries answers, so a re-run with answers replays it from cache.
2. **Controller decisions, then Rule.** Findings with a controller decision are settled by it (final for the run; a controller `stands` on a critical stands). The ruler runs on the other critical or important findings that are plan-mandated or contest a ledger Ruling. The ruler prompt carries the escalation rule above verbatim, always, plus "A Critical finding may be ruled fix or escalate, never stands." The script escalates a critical ruled `stands` or `verified`. Any escalation stops the run.
3. **One fix pass** with the complete list (critical and important must be fixed; minors when small). The fixer runs `pnpm lint`, `pnpm typecheck` and `pnpm coverage` once each and carries the no-push, no-PR, no-merge rule. Rulings in force are passed; the fixer never reverses one. A fixer precondition failure (HEAD moved, dirty tree) stops the run. Then the progress checker. Its problems become findings `progress-<k>`.
4. **One re-review** of the fix diff against the first review file(s). It verdicts every finding including `progress-*`: ADDRESSED, NOT ADDRESSED (also to reject a ruler ruling), or STANDS. A controller ruling is final. Otherwise a critical is never STANDS. Every important accepted as STANDS must be listed in `acceptedStands` with the id of the stands ruling. No approve while any critical is open. It writes the artifact at the fix head on approve, with no `mode` line. There is no second fix pass.

**Shas come from git (#222).** `reviewedSha` and the fix head are never taken from a reviewer, fixer, progress checker or re-reviewer field. `verifyHead` (Haiku 4.5, model only; the same role and validation as in `sdd-task`: `git rev-parse` and `git cat-file -e <sha>^{commit}` in `repoDir`, accept only 40 hex that the second command confirmed with `EXISTS <sha>`, the same sha) runs once after the reviewer (`verify-head-review`, resolving `head`, which is what the reviewer resolves) and, when a fix pass ran, once after its progress check (`verify-head-fix`, resolving HEAD). The returned `reviewedSha` is the verified fix head (or, with no fix pass, the verified reviewed sha); a reported sha that differs is logged as `agent-reported head <first 16 hex>... differs from git; using git`. An invalid answer stops the run (`stopped: "precondition"`, `stopPoint: "precondition:verifyHead"`; answer there and it re-runs once as `verify-head-...-retry`); a precondition stop from a reviewer now returns `reviewedSha: null` rather than the reviewer's claim. The artifact file itself is still written by the reviewer with the sha it computed. When the reviewer's (or re-reviewer's) reported sha differs from git, the artifact it wrote records a head that git does not confirm, so the run returns `artifactWritten: false` with `strayArtifact` set (delete it and re-run; on the first review that is an approve without an artifact). Otherwise the controller checks that its `reviewedSha` line equals the returned `reviewedSha` before committing it.

The fast path, on a clean approve, is 2 agents (the reviewer and `verifyHead`). Otherwise, worst case: 7 agents (or 8 with two tier slices), plus one `reviewer-retry` (or `reviewer-<tier>-retry`) and one `fixer-retry` on answered precondition stops.

### Artifact

```
---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "<full head sha>"
verdict: "approve"
---
```

On the fast path's first-pass approve, an extra line `mode: "fast"` follows `verdict`; every other write (the normal flow, tier slices, the re-reviewer) omits it. Front matter comes from the role that writes it; an override changes it, so the sensitive-review check fails closed. The body: scope, findings summary (with each ruling id kept as stands), cross-cutting checks, answers, remaining minors. No em dashes; MM-DD-YY dates. The agent writes but never commits it.

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
- `stopped` set: a decision is needed. Stop points and consumers: `reviewer` (the reviewer, or a slice's reviewer named in `problem`, returned nothing): the ruler, fixer and re-reviewer; `precondition` (`stopPoint` `precondition:reviewer` or `precondition:fixer`; the problem names each untracked or modified file and calls out a stray artifact): the failing agent re-runs once as `reviewer-retry` or `fixer-retry`; `ruler`: decisions settle the escalated items and text goes to the fixer and re-reviewer; `fixer`: the fixer; `re-review`: the re-reviewer. Another `at` throws. Delivery is first consumer that runs, so `reviewer` or `ruler` text reaches the re-reviewer when no ruler or fixer runs.
- `strayArtifact` set: delete that file.
- `declined` lists behaviours the reviewer set aside; the controller rules on each.

## Controller procedure

Which path a change takes (#92, CLAUDE.md "Controller rules"):
- **Inline** when the brief or issue already states the exact design, the change is about 150 lines or fewer in a handful of files, and no design question is open. The controller implements it (TDD, `pnpm verify`, `pnpm audit --prod`); no `sdd-task` reviewers run on it.
- **`sdd-task`** for real plan tasks: several interacting files, design judgement, or a brief that does not fully specify the work.
- **Review by tier, not by implementer.** Ordinary: CI only. Gate or critical: one `wave-review` per PR, with `branch`, `criticalFiles`, `gateFiles`, `reviewedLines` (from `git diff --numstat base...head` over those files) and a `contextPath` excerpt.
- **Split fixes by tier.** An ordinary fix goes in its own PR; gate chores ride the next wave PR.

Before an `sdd-task` run:
1. The wave branch is checked out in `repoDir` with a clean tree. `base = git rev-parse HEAD` (full sha).
2. `bash scripts/sdd/task-brief.sh PLAN N <workDir>/task-<N>-brief.md`.
3. Fill `specRefs` with real spec line ranges, `globalConstraints` with the plan's product and code constraint bullets only (no process bullets), `carries` with earlier rulings, `carryForward` items and interfaces.
4. Choose the tier (the task's highest tier in `.github/sensitive-paths`; ordinary when it touches none) and state the role plan (model and effort per role) and `maxAgents` before the run.

After it:
1. Append the ledger lines: save the run's result (the task output file holds it) and run `node scripts/sdd/append-ledger.mjs <workflow-output-file> <ledgerPath>` (PowerShell or Git Bash). It accepts a bare result object or any text that contains the result JSON, appends `ledgerLines` with a trailing newline and prints the count; exit 2 is a usage error or an unreadable file, exit 3 means no `ledgerLines` were found. A line already in the ledger is skipped, so a re-run on the same result writes nothing ("already appended") and a resumed run after a stop appends only its new lines (the rulings the stopped run ledgered are not repeated). Stop lines are events and are deduped only within one result, so a repeated stop at the same head is ledgered each time. Input saved as UTF-16 (PowerShell 5.1 `Out-File` or `>`) is decoded by its BOM; a UTF-16 ledger is refused (exit 2).
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

Before a `wave-review` run: every task of the wave is `complete`, the branch is committed and clean, the ledger is current, `head` is the sha to review. The PR's scope is frozen before the review starts: nothing new joins the PR after it (a late addition cost one more xhigh review on PR #76). Never write to the repository tree while any workflow run is active. After it: see Return.

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
| `precondition` (`precondition:verifyHead`) | check the repository in `repoDir` (`git rev-parse HEAD` must print a commit that exists), append `{ at: stopPoint, text }`; `verifyHead` re-runs once as `verify-head-...-retry` | A fresh run with `implemented.head` set to the current HEAD. |
| `precondition` (`precondition:checker`, `precondition:ruler-review`) | restore the head gate-0 checked and a clean tree (the problem names the files), append `{ at: stopPoint, text }`; the agent re-runs as `checker-retry` or `ruler-review-retry` | Review stages only with `implemented.head` set to the current HEAD. |
| `ruler-concerns` | append `{ at: "ruler-concerns", text, decisions }` | Review stages only, with the decisions carried in `answers`. |
| `fixer-pre` | append `{ at: "fixer-pre", text }` | Review stages only. |
| `review` | append `{ at: "review", text }` (it reaches `ruler-review`) | Review stages only. |
| `ruler-review` | append `{ at: "ruler-review", text, decisions }` | Review stages only, with the decisions carried in `answers`. |
| `fixer-r<r>` | append `{ at: "fixer-r<r>", text }` | Review stages only; the fixes already committed are reviewed with the rest. |
| `gate-0`, `gate-r<r>` | append `{ at: "gate-...", text }` (it reaches the next fixer round) | Review stages only; the gate runs again at the end. |
| `budget` | append `{ at: "budget", text }`; the cap rises by the tier default and every earlier call replays from cache | Review stages only with a higher `maxAgents`, if the work already committed is worth keeping. |

| `stopped` (wave-review) | How to answer (resume) | If the resumed run replays a null or failed agent |
|---|---|---|
| `reviewer` | append `{ at: "reviewer", text }` (it reaches the ruler, else the fixer, else the re-reviewer) | A fresh run. Always safe: nothing changes before the fixer. |
| `precondition` (`precondition:reviewer`) | fix the repo (delete a named stray artifact, commit or stash the named files), append `{ at: stopPoint, text }`; `reviewer-retry` runs | A fresh run. |
| `precondition` (`precondition:fixer`) | fix the repo, append `{ at: stopPoint, text }`; `fixer-retry` runs | A fresh run with `head` set to the current HEAD. |
| `precondition` (`precondition:verifyHead`) | check the repository in `repoDir` (`git rev-parse` must print a commit that exists), append `{ at: stopPoint, text }`; `verify-head-...-retry` runs | A fresh run. |
| `ruler` | append `{ at: "ruler", text, decisions }` | A fresh run with the same `answers`: the decisions settle the escalated items again. |
| `fixer` | append `{ at: "fixer", text }` | A fresh run with `head` set to the current HEAD (commit or discard the fixer's partial work with the developer's OK first). |
| `re-review` | append `{ at: "re-review", text }` | A fresh run with `head` set to the fix head: the whole-branch review covers the fix. |

## Harness

`node scripts/sdd/workflow-harness.mjs` (repo root, PowerShell or Git Bash). It imports each script from a data URL with the body wrapped in an async function, stubs `agent()` and `parallel()`, and asserts: every call has a model and an effort (none for Haiku); no prompt contains `undefined`; every schema has an object root with `required` inside `properties`; every mock return validates. A runaway-loop guard fails any scenario past 200 agent calls. Scenarios cover heads read from git (#222: `fabricated-head` and `bad-sha` scenarios for `sdd-task`, `sdd-wave` and `wave-review`; the harness fixture plays git and answers each `verify-head-*` agent with a 40-hex sha, and `run()` leaves the `verify-head-*` labels out of `labels` while every agent-count assertion counts them through `calls`), the review tiers (issue #78: each tier's roles and prompts, the combined reviewer's file and finding kinds, the `sensitive` alias and conflict throw, diff scope in reviewer, critic and re-reviewer prompts, the budget stop and its cache-stable answer, `sdd-wave` tier and budget pass-through and `totals.agents`, `wave-review` gate effort in the artifact prompt and the `ordinary` throw), `sdd-wave` (tasks in order through the real `sdd-task`, base and carries flow, one ledger block, stop and resume with per-task answers, a parked task, option pass-through and role merge, argument validation), two answered stops in a row for both scripts, the post-pilot items (gate runs coverage, reviewers never list gate checks as cannot-verify, the no-remote rule and the pre-commit self-check in every shell-running prompt, `critic` and `criticFocus`, the checker, `gate-0` in parallel with the reviewers, mechanical rounds without a re-reviewer, no ledger agent, `append-ledger.mjs` parsing, exit codes, idempotence and UTF-16 input, this README's resume shape; and the fix pass: post-gate head and tree checks for the checker and `ruler-review`, a cache-stable checker on a `ruler-review` answer, gate-weakening flags, gate findings in mixed rounds and at the cap, the no-remote rule in every prompt, the `criticFocus` warning; and the post-W3 pass: `pnpm typecheck` in the pre-commit self-check, a null checker with no later tree check stops at `precondition:checker`, `append-ledger.mjs` skips lines already in the ledger), the review-stages-only run, the happy path, the gate, worst-case counts, rulings routing and supersession, the sensitive ruler rule, answers re-runs and controller decisions in both scripts, stop-point consumers, precondition stops, arg validation, `maxRounds` coercion, and the `wave-review` guards. Run it after any change to a workflow; it exits 1 on a failure.
