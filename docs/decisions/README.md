# Architecture decision records

An ADR here records one decision that the design spec v2 (`docs/superpowers/specs/2026-09-25-query-module-2-design-v2.md`) does not already make: either it changes the spec, or it picks between options the spec left open. The spec plus the ADRs is the current design.

Process context: `docs/superpowers/plans/2026-09-25-implementation-master-plan.md` 5.3.

## When to write one

Write an ADR when a decision:

1. contradicts or changes anything in spec v2 (a schema, route, table, flow, milestone scope, tooling pin such as the Node version);
2. picks between options the spec left open or did not foresee, and more than one task will rely on it;
3. schedules a Later item (spec 12.6) into a milestone;
4. changes the process in the master plan in a way that affects both tracks.

Do not write one for:

- a task-level implementation choice inside one package (it goes in the phase plan or the PR body);
- a restatement of something the spec already says;
- a decision already in `docs/superpowers/specs/2026-09-25-review-decisions.md` (that log is frozen; spec v2 applies it).

## Numbering and files

1. File name `NNNN-kebab-title.md`, four digits, sequential from `0001`. `0000-template.md` is the template.
2. Take the next free number when you branch. If a parallel PR merges the same number first, renumber yours before merge.
3. Numbers are never reused. A replaced decision keeps its file with `status: superseded`; the new ADR names it in `supersedes`.

## Frontmatter

| Field | Values |
|---|---|
| `date` | MM-DD-YY, the day the status last changed |
| `status` | `proposed` \| `accepted` \| `superseded` \| `rejected` |
| `track` | `a` \| `b` \| `d` \| `core` \| `all` |
| `phase` | the phase that raised it, for example `m1-p2`; `none` if outside a phase |
| `supersedes` | ADR numbers (for example `[0003]`), spec v2 sections (for example `["spec 5.2"]`), both, or `[]` |

## Lifecycle

1. Write the ADR as `proposed` in its own PR (or with the `contract` PR it justifies), labelled like the issue that raised it.
2. The developer accepts or rejects it in the PR; merge with the final status.
3. If it overrides the spec, the same PR adds one line under the affected spec section: `Overridden by ADR-NNNN.` The spec is not otherwise edited.
4. Accepted ADRs are not edited except to set `status: superseded`.

## Balloon guard

No new tracking file without retiring one (master plan 5.4). ADRs are decision records, not tracking files, so they are outside the guard, but they must not become one: no running logs, status lists or to-do items in an ADR. Work goes to GitHub Issues; progress goes to `STATUS.md`.
