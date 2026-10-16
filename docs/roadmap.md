# Roadmap: what is planned

Last refreshed 10-16-26. Everything on this page is **planned and not built**, unless a line says
otherwise. What exists today is in the [overview](overview.md).

The plan follows the [design spec v2](superpowers/specs/2026-09-25-query-module-2-design-v2.md),
section 12, as changed by the [decision records](decisions/README.md). Phase plans are written when
a phase starts; the live grid is [STATUS.md](superpowers/plans/STATUS.md). Scope and order can
change at each phase gate.

**No milestone connects the module to a real state or national system.** Real source adapters are
outside this design (spec 2, non-goals). Every milestone below runs on the mock sources.

## Progress

| Milestone | Done | Open | Phase parents |
|---|---|---|---|
| [M0 Skeleton](https://github.com/BirchDesignLab/queryModule/milestone/1) | [![M0 progress](https://img.shields.io/github/milestones/progress-percent/BirchDesignLab/queryModule/1?label=done)](https://github.com/BirchDesignLab/queryModule/milestone/1) | [![M0 open](https://img.shields.io/github/milestones/issues-open/BirchDesignLab/queryModule/1?label=open)](https://github.com/BirchDesignLab/queryModule/milestone/1) | [P0](https://github.com/BirchDesignLab/queryModule/issues/39), [P1](https://github.com/BirchDesignLab/queryModule/issues/40) |
| [M1 Forms and terminal](https://github.com/BirchDesignLab/queryModule/milestone/2) | [![M1 progress](https://img.shields.io/github/milestones/progress-percent/BirchDesignLab/queryModule/2?label=done)](https://github.com/BirchDesignLab/queryModule/milestone/2) | [![M1 open](https://img.shields.io/github/milestones/issues-open/BirchDesignLab/queryModule/2?label=open)](https://github.com/BirchDesignLab/queryModule/milestone/2) | [P2](https://github.com/BirchDesignLab/queryModule/issues/41), [P3](https://github.com/BirchDesignLab/queryModule/issues/42) |
| [M2 Results and audit](https://github.com/BirchDesignLab/queryModule/milestone/3) | [![M2 progress](https://img.shields.io/github/milestones/progress-percent/BirchDesignLab/queryModule/3?label=done)](https://github.com/BirchDesignLab/queryModule/milestone/3) | [![M2 open](https://img.shields.io/github/milestones/issues-open/BirchDesignLab/queryModule/3?label=open)](https://github.com/BirchDesignLab/queryModule/milestone/3) | [P0](https://github.com/BirchDesignLab/queryModule/issues/43), [P1](https://github.com/BirchDesignLab/queryModule/issues/44), [P2](https://github.com/BirchDesignLab/queryModule/issues/45), [P3](https://github.com/BirchDesignLab/queryModule/issues/46) |
| [M3 Workflow and compliance](https://github.com/BirchDesignLab/queryModule/milestone/4) | [![M3 progress](https://img.shields.io/github/milestones/progress-percent/BirchDesignLab/queryModule/4?label=done)](https://github.com/BirchDesignLab/queryModule/milestone/4) | [![M3 open](https://img.shields.io/github/milestones/issues-open/BirchDesignLab/queryModule/4?label=open)](https://github.com/BirchDesignLab/queryModule/milestone/4) | [P0](https://github.com/BirchDesignLab/queryModule/issues/47), [P1](https://github.com/BirchDesignLab/queryModule/issues/48), [P2](https://github.com/BirchDesignLab/queryModule/issues/49), [P3](https://github.com/BirchDesignLab/queryModule/issues/50) |
| [M4 Mobile and host integration](https://github.com/BirchDesignLab/queryModule/milestone/5) | [![M4 progress](https://img.shields.io/github/milestones/progress-percent/BirchDesignLab/queryModule/5?label=done)](https://github.com/BirchDesignLab/queryModule/milestone/5) | [![M4 open](https://img.shields.io/github/milestones/issues-open/BirchDesignLab/queryModule/5?label=open)](https://github.com/BirchDesignLab/queryModule/milestone/5) | [P0](https://github.com/BirchDesignLab/queryModule/issues/51), [P1](https://github.com/BirchDesignLab/queryModule/issues/52), [P2](https://github.com/BirchDesignLab/queryModule/issues/53), [P3](https://github.com/BirchDesignLab/queryModule/issues/54) |

The badges read GitHub each time the page loads: done is closed issues over all issues in the
milestone. [Follow-ups](https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+is%3Aopen+label%3Afollow-up)
are review carries; [decisions](https://github.com/BirchDesignLab/queryModule/issues?q=is%3Aissue+is%3Aopen+label%3Adecision)
wait on the developer. The [project board](https://github.com/users/BirchDesignLab/projects/1) holds
every issue ([board guide](project-board.md)).

## M2 Results and audit: remaining phases

- **P0 contracts, last wave.** P0-W3 and the full contract gate (P0-W1 and P0-W2 are merged).
- **P2 audit.** An admin audit viewer with paging and NDJSON export; viewing the audit is itself
  audited. `config:validate` resolves result-card paths against the mock answers and gains
  `--diff <tag>`. A session sweeper, a retention setting, and an admin-only view that includes hidden results;
  the acknowledgment-receipt metric and the 202 `Server-Timing` header
  (moved here from P1). A summary and detail toggle and the terminal pane layout.
- **P3 hardening.** A security test matrix for the M2 routes, a backup restore test, and browser
  tests at 1024x768 for a critical result shown only in detail, typing while a result arrives, and
  going offline. M2 exits with a screen-reader pass (NVDA with Chrome).

## M3 Workflow and compliance

- **Credentials and MFA (P1).** Users enter and change their own credentials for each source, stored
  encrypted with a key version; step-up authentication to change them; TOTP sign-in. Credential
  status on result cards with "retry this source". Tests that scan the raw database bytes and every
  log line for credential values.
- **Multi-source, nested queries, hide (P2).** A query that runs follow-on queries from an answer,
  grouped under one correlation ID, with per-source and global caps. Delete from view: the user hides
  results from their own view, the rows stay in the database, and the hide is audited. Purge by
  crypto-shredding the per-request key. The property form.
- **Delegation (P3).** A training officer approves a trainee to query on the officer's behalf, with a
  code or QR, a fresh sign-in or TOTP on approval, a session binding, revocation, and an audit filter
  by actor or owner.
- M3 exits with a screen-reader pass and these features turned on in the shipped site.

## M4 Mobile and host integration

- **Mobile-unit layouts (P1).** The Toughbook-class layout at 1024x768, 1366x768 and 800x600, the
  7:1 contrast day theme, an orientation preference, and 200% zoom with 320 px reflow.
- **Host integration (P1).** Embedding the module in a CAD host page in an iframe, with a versioned
  postMessage protocol and the host's signed-in user passed as a signed token, tested against a host
  simulator (`apps/host-simulator`). This is embedding in a host page; it does not connect to any
  external system.
- **Native (P0 to P2).** An Expo app (`apps/mobile`, a bare shell today) on a React Native
  component library (`packages/rn-ui`, not created yet):
  sign-in, the query panel and condensed results, home-screen quick queries, font scaling to 2x,
  reduced motion and delete from view.
- M4 exits with VoiceOver and TalkBack at the largest text size and a manual daylight check.

## Later, not scheduled

Add to supplemental (writing a result into a CAD or records record), background push, barcode and
OCR scans, a voice spike, response aggregation, an offline submit queue, and an audit hash chain
(spec 12.6). None has a milestone.

## Outside this design

Real source adapters, Shared Platform integration (PLT-001 to PLT-005 stay stubbed behind seam
interfaces), horizontal scale-out, a credential key rotation procedure, and formal CJIS, GDPR or EU
Cyber Resilience Act certification (spec 2, non-goals). The design follows those control areas;
certification is not in scope.
