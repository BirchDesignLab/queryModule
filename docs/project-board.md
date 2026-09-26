# Project board: Query Module 2.0

The backlog is GitHub Issues on `BirchDesignLab/queryModule`, shown on the user-owned Project "Query Module 2.0" (BirchDesignLab, project 1). `scripts/ops/gh-setup-project.mjs` keeps the labels, milestones, parent issues, sub-issue links, fields and field values in the shape below; run it after changing its data. The part above "Manual steps" is also the project readme.

## Accounts

- THobbs23 pushes code, opens PRs and runs the sessions.
- BirchDesignLab owns the repo and the board: board and issue management (the setup script runs as BirchDesignLab), repo settings, rulesets, merges.
- No session approves or merges a PR.

## Hierarchy

- **Milestone** (M0 to M4): a release-sized goal with exit criteria (spec 12.7).
- **Phase parent** issue, label `epic`: one per row of the STATUS grid (for example "M0 P0: Contracts"). Its progress bar comes from its sub-issues.
- **Wave parent** (P0 only), label `epic`: "M0 P0 W4: Tasks 17 to 22". One PR per wave (ADR-0006).
- **Task** issue: one plan task, created from the phase plan at phase start. Title ends with its requirement IDs.
- **Follow-up** issue, label `follow-up`: an obligation found in review or a ruling and carried to a later task, phase or track. `decision` marks one that waits on the developer.

## Fields

| Field | Values | Meaning |
|---|---|---|
| Status | Todo, Ready, In Progress, In Review, Blocked, Done | Todo: not started. Ready: briefed and unblocked. In Progress: a session is on it. In Review: PR open. Blocked: waits on a decision, issue or admin step. Done: merged or closed. |
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

`.github/workflows/project-sync.yml` keeps Status, Start and Finish in step. Its board job reconciles each affected item from current truth on every run (issue state, open PRs that close it, the wave branch and its PR), so a dropped or racing run is healed by the next event on the same items.

| Event | Items reconciled | Status from truth |
|---|---|---|
| Push to `feat/p0-wave-<k>` | wave k's tasks and wave parent | open PR on the branch: In Review (draft: In Progress); branch only: In Progress |
| PR opened, reopened, ready, drafted or closed | issues it closes, plus wave k's items for a wave branch | an open PR closing the issue: In Review (draft: In Progress) |
| Issue closed or reopened | the issue and its parent | closed as completed: Done, Finish set; not planned or duplicate: unchanged; reopened: Finish cleared, Status from its PRs |
| Every wave parent | | closed as completed once all of its tasks are closed |

Start is set when an item first reaches In Progress or In Review. Blocked is yours: automation only moves a Blocked item to In Review or Done. The `sensitive-label` job labels a PR `sensitive` when it touches a gate or critical path (ADR-0007).

Security: the board job uses the secret `PROJECT_TOKEN` (BirchDesignLab classic token, `project` scope only, with an expiry) and never checks out or runs repository code; without the secret, or on a fork PR, it skips with a notice. Anyone with push access can read the token by editing the workflow on a branch; that is accepted because repository writers are trusted. The label job uses only `GITHUB_TOKEN`.

The setup script (`scripts/ops/gh-setup-project.mjs`) only seeds Status and Priority when they are empty (a closed issue is forced to Done); after that, project-sync and the developer own them.

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
