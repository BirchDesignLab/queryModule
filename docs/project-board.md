# Project board: Query Module 2.0

The backlog is GitHub Issues on `BirchDesignLab/queryModule`, shown on the user-owned Project "Query Module 2.0" (BirchDesignLab, project 1). `scripts/ops/gh-setup-project.mjs` keeps the labels, milestones, parent issues, sub-issue links, fields and field values in the shape below; run it after changing its data. The part above "Manual steps" is also the project readme.

## Accounts

- THobbs23 pushes code, opens PRs and runs the sessions.
- BirchDesignLab owns the repo and the board: board and issue management (the setup script runs as BirchDesignLab), repo settings, rulesets, merges.
- No session approves or merges a PR.

## Hierarchy

- **Milestone parent** issue, label `epic`, milestone set: one per milestone (for example "M0 Skeleton"). Its phase parents are its sub-issues; "No Parent issue" on the board holds only the five milestone parents.
- **Milestone** (M0 to M4): a release-sized goal with exit criteria (spec 12.7).
- **Phase parent** issue, label `epic`: one per row of the STATUS grid (for example "Contracts (M0 P0)"). Its progress bar comes from its sub-issues. Codes (the milestone and phase) live in the `Phase` field and the title's `(M... P...)` suffix, not the title's leading words (developer decision, #80).
- **Wave parent** (P0 only), label `epic`: "Wave 4: Verify gate (Tasks 17 to 22)". One PR per wave (ADR-0006).
- **Task** issue: one plan task, created from the phase plan at phase start. Title ends with its requirement IDs.
- **Follow-up** issue, label `follow-up`: an obligation found in review or a ruling and carried to a later task, phase or track. `decision` marks one that waits on the developer.

Every level above is matched by issue number, never by title (`scripts/ops/board-model.mjs` `matchParent`): the setup script's data records each parent's live number, and a title in the data that differs from GitHub is a planned rename, not a new issue.

## Fields

| Field | Values | Meaning |
|---|---|---|
| Status | Todo, Ready, In Progress, In Review, Blocked, Done | Todo: not started. Ready: briefed and unblocked. In Progress: a session is on it. In Review: PR open. Blocked: waits on a decision, issue or admin step. Done: merged or closed. |
| Level | Milestone, Phase, Wave, Task, Follow-up | What kind of item this is (developer decision, #80); the setup script sets it on every item it owns. Used instead of a title regex to identify parents and drive Start/Finish roll-up. |
| Track | Platform (A), Web (B), Core, Mobile (D) | Owning track (master plan 3). Same as the track label. |
| Phase | P0 to P3 | Phase within the milestone. |
| Wave | W1 to W6 | P0 wave (plan "Waves"). |
| Size | S, M, L, XL | Tasks: plan section length (up to 150, 300, 450 lines, more). Follow-ups: judged. |
| Priority | Urgent, High, Medium, Low | Urgent blocks a gate or a freeze; High is the current or next wave. |
| Req IDs | text | Requirement IDs (BR-, FR-, UX-, SEC-, NFR-) or story IDs. |
| Start, Finish | dates | Work dates, for the Roadmap view. |

## Labels

Track (`platform`, `web`, `core`, `mobile`), phase (`p0` to `p3`), `contract`, `sensitive`, `api-breaking` (master plan 5.2), plus `epic`, `follow-up`, `decision`, and GitHub's `bug`, `documentation`, `enhancement`, `question`, `accessibility`.

## Flow

1. A phase starts: its plan is written, its task issues are created and linked under the phase parent (and wave parents in P0), Status Todo.
2. A wave starts: its tasks move to Ready, then In Progress.
3. The wave PR opens with `Closes #n` for each task: tasks move to In Review.
4. The developer merges: GitHub closes the tasks, Status becomes Done.
5. Carries and findings from review become `follow-up` issues under the phase that will do them.

## Automation

`.github/workflows/project-sync.yml` keeps Status, Start and Finish in step. Its board job reconciles every item of this repository from current truth on every run, whatever the event (issue state, and this repository's open PRs that close it). GitHub keeps only one pending run per concurrency group and drops the rest in a burst, so any run that survives heals the whole board. PRs from forks never count.

Triggering events: a PR opened, reopened, edited, marked ready, drafted or closed; an issue closed or reopened; a manual run (`workflow_dispatch`). There is no push trigger: branch detection was dropped (developer ruling, checker 09-27-26, issue #193) since waves push only after wave-review, so a wave-branch push fires at the end anyway and added no signal a closing PR did not already give; this also means the job needs no wave-branch naming convention, so it works the same for every track's wave branches (`feat/p0-wave-<k>`, `feat/a-p1-wave-<k>`, and so on), not only P0's. Every run reconciles all items of this repository:

| Item | Status from truth |
|---|---|
| Closed issue | closed as completed: Done, Finish set; not planned or duplicate: unchanged |
| Open issue with an open PR (this repository) that closes it | In Review (draft PR: In Progress) |
| Open issue with none of the above | Done or In Review moves back to Todo (a reopen, or a PR closed unmerged); other values stay |
| Open leaf (Task, Follow-up) | no Finish; an open parent keeps its rolled-up Finish (below) |
| Wave parent | closed as completed once all of its tasks are closed |
| Wave, Phase or Milestone parent with children and no closing PR of its own | rolled up from its children's own Status (below) |

A Wave, Phase or Milestone parent's Status rolls up from its children (issue #193, beyond the P0-only wave-parent close above): Done once every child's own Status is Done (a closed-not-planned child never reaches Done on its own, so it never counts); otherwise Todo when no child has started, else In Progress, except In Review when every started-but-not-Done child is In Review. A Milestone rolls up the same way over its Phase parents' own already-computed Status (the roll-up runs bottom up: waves, then phases, then milestones). A parent with no children gets no Status write. Blocked is still the developer's: automation only moves a Blocked parent to Done or In Review, same as any other item. `scripts/ops/board-model.mjs`'s `parentStatus` and the board job's inline copy (it cannot import the script; see below) apply the same rule, checked by `scripts/ci/project-sync.test.ts`'s parity tests. Like the Start/Finish roll-up below, this needs the `Level` field, so it also waits (with the same notice) while the field is missing.

Start and Finish roll up on every run, bottom up (developer decision, #80 requirements 4-6), from the `Level` field, never a title regex: a Task or Follow-up (a leaf) gets Start from its issue's created date and Finish from its closed date only when it closed as completed, both clamped to the project's 2026-09-25 floor. A Wave, Phase or Milestone parent gets Start from the earliest of its children's Start, and Finish from the latest of its children's Finish once every child is closed (else the latest child date so far). A parent with no dated child keeps no dates. `scripts/ops/board-model.mjs` (`leafDates`, `rollUp`) and the board job's inline copy (it cannot import the script; see below) apply the same rules, checked by `scripts/ci/project-sync.test.ts`'s table-driven parity tests (open and all-closed children, not-planned leaves, multi-level parents, leaf dates). The two differ in child sets only: the board job uses each issue's live `parent` link (so follow-ups count under their parent), while the setup script derives children from its data (tasks by number range, the Contracts phase over its waves only). While the `Level` field is missing (before the first `gh-setup-project.mjs --apply`), the job skips the roll-up and the wave-parent close with a notice; run the workflow once by hand after `--apply` (`gh workflow run project-sync.yml`), since the script's writes trigger no event. Blocked is yours: automation only moves a Blocked item to In Review or Done. The `sensitive-label` job labels a PR `sensitive` when it touches a gate or critical path (ADR-0007).

Security: the board job uses the secret `PROJECT_TOKEN` (BirchDesignLab classic token, `project` scope only, with an expiry) and never checks out or runs repository code; without the secret, or on a fork PR, it skips with a notice. Anyone with push access can read the token by editing the workflow on a branch; that is accepted because repository writers are trusted. The label job uses only `GITHUB_TOKEN`.

The setup script (`scripts/ops/gh-setup-project.mjs`) only seeds Status and Priority when they are empty (an issue closed as completed is forced to Done; closed not planned or duplicate gets no Status write; Done comes from issue state only); a Wave, Phase or Milestone parent's seed also comes from `parentStatus`, over the same data-derived child sets as its Start/Finish seed, so the two scripts never disagree; a phase or milestone with no dated children in the data gets no Status seed either, same as project-sync's "no children, no write" (the script no longer hard-codes a phase's or milestone's Status, issue #193). Start and Finish are only seeded when empty, from its data-derived roll-up; after that, project-sync (which recomputes Status, Start and Finish on every run) and the developer own Status, Priority, Start and Finish.

## Board data

The issue content the setup script writes to GitHub (`PHASES`, `CONTRACTS_M0P0`, `MILESTONE_PARENT_NUMBERS`, `WAVES`, `FOLLOW_UPS`: titles, bodies, labels, milestone, parent, track, phase, number and state) lives in `docs/board/board-data.json`, outside `[gate]` (ADR-0007 amendment, issue #92). Editing it, for example to record a milestone parent's issue number or add a follow-up, is an ordinary change with no sensitive-review artifact. `scripts/ops/board-data-schema.mjs` validates the file at every run, before the first gh call or GitHub read, fail closed with a JSON pointer per error; `scripts/ops/board-data.test.ts` checks the shipped file and one failing case per rule. The script itself, `scripts/ops/gh-setup-project.mjs` (and its structural config in `scripts/ops/board-config.mjs`: which repo and project, labels, milestones, fields), stays `[gate]`: a data file edit can add or reword an issue, never delete a label, add a field, or change which repo or project is written.

## SVG dashboard

`scripts/ops/progress-svg.mjs` (`renderDashboard(model, theme)`) is a pure renderer for the README progress image: milestone progress (closed over total issues), phase sub-issue bars, the P0 wave timeline (from the Start/Finish roll-up above, or a merged wave's own span, below), open decisions (label `decision`) and task/follow-up counts by Status. It emits static, accessible SVG only: no `<script>`, no event attributes, no `<foreignObject>`, no external `href` or font URL, every text node escaped, `role="img"` with a `<title>` and `<desc>`, and 4.5:1 text / 3:1 bar contrast in both themes (checked with `@querymodule/tokens`'s `contrastRatio`).

`node scripts/ops/gh-setup-project.mjs --dashboard` reads GitHub live (no writes at all, GitHub or otherwise gated behind `--apply`) and regenerates `docs/assets/progress-light.svg`, `docs/assets/progress-dark.svg` and the README `<picture>` block between the `progress:start`/`progress:end` markers. The controller runs it after a wave merges; the two SVGs in the repo right now are rendered from a fixture model (`scripts/mock-data/render-fixture-dashboard.mjs`) so the README image resolves before the first live regen.

For a wave whose `pr` is recorded and whose PR has merged, the wave timeline uses that PR's own span (start: the first commit's author date; finish: `merged_at`) instead of the Start/Finish roll-up, which would otherwise show every P0 wave on the same day (issue #85). `scripts/ops/board-model.mjs`'s `waveSpan` makes the choice; the two live reads it needs (`repos/{repo}/pulls/{n}` and its `commits`) happen only under `--dashboard`, never during a plain dry run or `--apply` alone. `--apply` alone re-renders the SVGs and README block with roll-up wave dates; run `--dashboard` after any `--apply` and commit that output, not the `--apply` render.

## Manual steps

Views, built-in project workflows and repo settings have no API. BirchDesignLab does these in the web UI. This list is the one checklist; verified read-only through the API on 09-27-26 and issue #75 closed.

Automation token (for `project-sync`):
- [x] As BirchDesignLab, create a classic personal access token with only the `project` scope (Settings, Developer settings, Personal access tokens, Tokens (classic)); set an expiry and a calendar reminder. (Scope and expiry are not readable through the API; the token works: project-sync runs green.)
- [x] Repo Settings, Secrets and variables, Actions: new repository secret `PROJECT_TOKEN` with that token.

Built-in workflows (Project, menu, Workflows); project-sync owns Status moves, so keep the built-ins to adding items:
- [x] "Item added to project": set Status to Todo.
- [x] "Auto-add sub-issues to project": on.
- [x] "Auto-add to project": not offered on this project; nothing to set.
- [x] "Item closed", "Pull request merged", "Pull request linked to issue", "Auto-close issue": off (project-sync handles them; the built-ins would mark not-planned closes Done).

Views (convenience only; no script, check or workflow depends on them):
- [x] M0 to M4 boards filtered by milestone; "Later" (renamed from "M - aybe Later") filtered `no:milestone`.
- [x] Table "Follow-ups and decisions": filter `label:follow-up,decision is:open`, sort by Priority, columns Track, Phase, Size, Priority, Status.
- Optional, add when wanted (the recipe: + New view, rename from the tab menu, filter box, Sort by, + for columns, Save):
  - "Plan": group by Level, filter `level:Milestone,Phase`.
  - "By track": board, columns Status, swimlanes Track.
  - "Sensitive": table, filter `label:sensitive`, show Track, Wave, Status, Linked pull requests.
  - Roadmap grouped by Phase instead of Milestone.
  - Track, Phase, Size and Priority columns on the milestone boards.

Repo settings (Settings, General):
- [x] "Automatically delete head branches": on.
- [x] Merge button: squash only (merge commits and rebase off), matching the ruleset on `main` (ADR-0008).

Public repository (public since 09-26-26):
- [x] Settings, Code security: secret scanning and push protection on (free for public repos).
- [x] Settings, Code security: Dependency graph on (the ci job's dependency review needs it, ADR-0007).
- [x] Settings, Actions, General: "Require approval for all external contributors" for fork pull request workflows; workflow permissions read-only by default.
- [ ] Settings, General, Features: Wiki is on; turn it off if unused. Issues on; Discussions off.
- [x] Private vulnerability reporting on (Settings, Code security), since the module handles CJIS-adjacent design.
