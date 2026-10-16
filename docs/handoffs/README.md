# Handoffs

One file per handoff, named `<MM-DD-YY>-<lane>.md` (for example `10-16-26-m2-p0-w3.md`). A handoff
is written when a session stops before its work is done, so the next session can start from it.
Each file is written once and never appended to; the next handoff for the same lane is a new file.
[STATUS.md](../superpowers/plans/STATUS.md) links the latest handoff for each track.

Rulings are recorded where they belong before the handoff is written (an issue comment that starts
with "Ruling:", the phase plan's "Rulings" section, or an ADR); the handoff links to them rather
than restating them. The rules are in [CLAUDE.md](../../CLAUDE.md), "Where records go".

## Template

```markdown
# Handoff: <lane>, <MM-DD-YY>

- Plan: <path to the phase plan>, tasks <n to m>
- Branch and head: `<branch>` at `<full sha>` (pushed: yes or no; PR: #<n> or none)
- Done: <tasks or items finished, with PR or commit>
- In progress: <the item that stopped, and exactly where>
- Rulings this depends on: <links to issue comments, plan Rulings entries or ADRs>
- Open questions: <for the developer or the manager, each with options>
- Next step: <the first thing the next session does>
```
