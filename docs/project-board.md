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

`.github/workflows/project-sync.yml` keeps Status, Start and Finish in step. Its board job reconciles every item of this repository from current truth on every run, whatever the event (issue state, this repository's open PRs that close it, the wave branch and its PR). GitHub keeps only one pending run per concurrency group and drops the rest in a burst, so any run that survives heals the whole board. PRs from forks never count.

Triggering events: a push to `feat/p0-wave-<k>`; a PR opened, reopened, edited, marked ready, drafted or closed; an issue closed or reopened; a manual run (`workflow_dispatch`). Every run reconciles all items of this repository:

| Item | Status from truth |
|---|---|
| Closed issue | closed as completed: Done, Finish set; not planned or duplicate: unchanged |
| Open issue with an open PR (this repository) that closes it | In Review (draft PR: In Progress) |
| Open task of wave k, no closing PR | open PR on `feat/p0-wave-<k>`: In Review (draft: In Progress); branch only: In Progress |
| Open issue with none of the above | Done or In Review moves back to Todo (a reopen, or a PR closed unmerged); other values stay |
| Open leaf (Task, Follow-up) | no Finish; an open parent keeps its rolled-up Finish (below) |
| Wave parent | closed as completed once all of its tasks are closed |

Start and Finish roll up on every run, bottom up (developer decision, #80 requirements 4-6), from the `Level` field, never a title regex: a Task or Follow-up (a leaf) gets Start from its issue's created date and Finish from its closed date only when it closed as completed, both clamped to the project's 2026-09-25 floor. A Wave, Phase or Milestone parent gets Start from the earliest of its children's Start, and Finish from the latest of its children's Finish once every child is closed (else the latest child date so far). A parent with no dated child keeps no dates. `scripts/ops/board-model.mjs` (`leafDates`, `rollUp`) and the board job's inline copy (it cannot import the script; see below) apply the same rules, checked by `scripts/ci/project-sync.test.ts`'s table-driven parity tests (open and all-closed children, not-planned leaves, multi-level parents, leaf dates). The two differ in child sets only: the board job uses each issue's live `parent` link (so follow-ups count under their parent), while the setup script derives children from its data (tasks by number range, the Contracts phase over its waves only). While the `Level` field is missing (before the first `gh-setup-project.mjs --apply`), the job skips the roll-up and the wave-parent close with a notice; run the workflow once by hand after `--apply` (`gh workflow run project-sync.yml`), since the script's writes trigger no event. Blocked is yours: automation only moves a Blocked item to In Review or Done. The `sensitive-label` job labels a PR `sensitive` when it touches a gate or critical path (ADR-0007).

Security: the board job uses the secret `PROJECT_TOKEN` (BirchDesignLab classic token, `project` scope only, with an expiry) and never checks out or runs repository code; without the secret, or on a fork PR, it skips with a notice. Anyone with push access can read the token by editing the workflow on a branch; that is accepted because repository writers are trusted. The label job uses only `GITHUB_TOKEN`.

The setup script (`scripts/ops/gh-setup-project.mjs`) only seeds Status and Priority when they are empty (an issue closed as completed is forced to Done; closed not planned or duplicate gets no Status write; Done comes from issue state only); Start and Finish are only seeded when empty, from its data-derived roll-up; after that, project-sync (which recomputes Start and Finish on every run) and the developer own Status, Priority, Start and Finish.

## SVG dashboard

`scripts/ops/progress-svg.mjs` (`renderDashboard(model, theme)`) is a pure renderer for the README progress image: milestone progress (closed over total issues), phase sub-issue bars, the P0 wave timeline (from the Start/Finish roll-up above), open decisions (label `decision`) and task/follow-up counts by Status. It emits static, accessible SVG only: no `<script>`, no event attributes, no `<foreignObject>`, no external `href` or font URL, every text node escaped, `role="img"` with a `<title>` and `<desc>`, and 4.5:1 text / 3:1 bar contrast in both themes (checked with `@querymodule/tokens`'s `contrastRatio`).

`node scripts/ops/gh-setup-project.mjs --dashboard` reads GitHub live (no writes at all, GitHub or otherwise gated behind `--apply`) and regenerates `docs/assets/progress-light.svg`, `docs/assets/progress-dark.svg` and the README `<picture>` block between the `progress:start`/`progress:end` markers. The controller runs it after a wave merges; the two SVGs in the repo right now are rendered from a fixture model (`scripts/mock-data/render-fixture-dashboard.mjs`) so the README image resolves before the first live regen.

## Manual steps

Views, built-in project workflows and repo settings have no API. BirchDesignLab does these in the web UI. This list is the one checklist: tick it here, and close issue #75 when it is done.

Automation token (for `project-sync`):
- [ ] As BirchDesignLab, create a classic personal access token with only the `project` scope (Settings, Developer settings, Personal access tokens, Tokens (classic)); set an expiry and a calendar reminder.
- [ ] Repo Settings, Secrets and variables, Actions: new repository secret `PROJECT_TOKEN` with that token.

Built-in workflows (Project, menu, Workflows); project-sync owns Status moves, so keep the built-ins to adding items:
- [ ] "Item added to project": set Status to Todo.
- [ ] "Auto-add sub-issues to project": on.
- [ ] "Auto-add to project" (if offered): repository `queryModule`, filter `is:issue`.
- [ ] "Item closed", "Pull request merged", "Pull request linked to issue", "Auto-close issue": off (project-sync handles them; the built-ins would mark not-planned closes Done).

Views:
- [ ] "Plan": group by Level, showing Milestone and Phase rows only (filter `level:Milestone,Phase` or equivalent), for the release-level view.
- [ ] "P0 detail": group by parent, showing Level Wave and Task rows only (filter `level:Wave,Task`), for the current-wave view.
- [ ] Rename "M - aybe Later" to "Later"; give it the filter `no:milestone` (or the later label once used).
- [ ] M1 to M4 boards: add filters `milestone:"M1 Forms and terminal"` and so on (they currently show everything).
- [ ] New board "Current wave": filter `wave:W5`, columns Status (update the wave number each wave).
- [ ] New board "By track": columns Status, swimlanes (group by) Track.
- [ ] New table "Follow-ups and decisions": filter `label:follow-up,decision is:open`, sort by Priority.
- [ ] New table "Sensitive": filter `label:sensitive`, show Track, Wave, Status, Linked pull requests.
- [ ] Roadmap: date fields Start and Finish, group by Phase, markers for milestones.
- [ ] Every view: show Track, Phase, Size, Priority and Sub-issues progress where useful; hide Repository.

Repo settings (Settings, General):
- [ ] "Automatically delete head branches": on.
- [ ] Merge button: keep the options you use (wave PRs merge with a merge commit so far); consider turning off the rest.

Public repository (public since 09-26-26):
- [ ] Settings, Code security: secret scanning and push protection on (free for public repos).
- [ ] Settings, Code security: Dependency graph on (the ci job's dependency review needs it, ADR-0007).
- [ ] Settings, Actions, General: "Require approval for all external contributors" for fork pull request workflows; workflow permissions read-only by default.
- [ ] Settings, General, Features: turn off Wiki if unused; keep Issues; Discussions optional.
- [ ] Private vulnerability reporting on (Settings, Code security), since the module handles CJIS-adjacent design.
