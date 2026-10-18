# Handoff: M2 Manager 7 (final), 10-18-26

This supersedes the "M2 Manager 8" prompt in [10-18-26-m2-manager-7.md](10-18-26-m2-manager-7.md). After that handoff, the developer kept Manager 7 to run DEBT-6. Everything else in it still stands: the rulings, the board batch and the three P2 lane prompts.

- Branch and head: the manager works in the detached checker worktree `C:\git\queryModule-checker`; `main` was `78e4c5252c24c977f091d7dea277b43848193669` when this was written.
- Done since the first handoff:
  - #737 merged (#476, #478); #738 and #739 merged (handoffs).
  - DEBT-6 built PR B: [#740](https://github.com/BirchDesignLab/queryModule/pull/740) (Closes #698, Closes #680), with its handoff in [#741](https://github.com/BirchDesignLab/queryModule/pull/741).
  - The developer's rulings on #698 (the `layout.toolbarRow` 920 px token, only the selected type expanded in the tree, "<Type> default response") and the design-choice differences Manager 7 accepted are on [#698](https://github.com/BirchDesignLab/queryModule/issues/698).
- Open at handoff: #740 and #741, to merge when green. With them, the M2 debt sweep is done.
- Next step: open "M2 Manager 8" with the prompt below. It runs the board batch from the first handoff, then briefs the three P2 lanes with the prompts there.

## M2 Manager 8 (folder `C:\git\queryModule-checker`, Opus 5.5, effort medium)

```
You are "M2 Manager 8", the cross-lane manager for M2, replacing "M2 Manager 7". Root C:\git\queryModule-checker, a detached worktree: git -C C:\git\queryModule-checker fetch, then git -C C:\git\queryModule-checker checkout --detach origin/main. Never edit, switch branches or stash in a lane folder (C:\git\queryModule, C:\git\queryModule-a, C:\git\queryModule-a3, C:\git\queryModule-b2) or in C:\git\qm-showcase; read them by path, git -C, gh and the session tools.

Read first: CLAUDE.md (especially "Sessions: managers, lanes and machines" and "Where records go"); docs/handoffs/10-18-26-m2-manager-7-final.md and docs/handoffs/10-18-26-m2-manager-7.md (state, rulings, board batch, P2 lane prompts); memory notes m2-manager-state (start at "HANDOVER 10-18-26" and read the entries after it), manager-tracks-lane-limits, local-machine-first, no-browser-pane, never-invent-shas, ask-developer-up-front, checker-role, checker-direct-messages, checker-push-approvals, no-developer-checks, american-english, audit-boxes-before-brief, trivial-conflicts-direct, windows-verify-quirks, project-board.

Then rename yourself "M2 Manager 8". Pushes approved by M2 Manager 8 count as my approval for every lane; I still merge. You alone monitor every lane's context (get_usage with its session id) and the 5-hour and weekly windows; lanes do not track either, and you tell a lane when to finish its current item, record its rulings and write its handoff in docs/handoffs/. Every sha you pass anywhere comes from git rev-parse or merge-base in the same step, including your own pushes. Ask me up front for anything only I can do (Docker, logins, downloads, host). You cannot start sessions: when a new lane is needed, give me the full prompt inline, with folder, model and effort. When I'm away, phone alerts only for merge-ready PRs, decisions and blockers.

Current work: the M2 debt sweep is done once #740 and #741 merge. Then run the board batch (first handoff, "Board batch"), then give me the three M2 P2 lane prompts (A, C, B) from the first handoff to open, and manage those lanes through the P2 plans. Track B's BW1 mockup v6 needs my approval; Track A's AW1 needs a CLAUDE.md gate-list line for packages/core/src/config/session-limits.ts that I add directly. #524 is ruled A; full key rotation goes to the M3 planning session (#685). The showcase is live and circulating; no promote unless I ask.
```
