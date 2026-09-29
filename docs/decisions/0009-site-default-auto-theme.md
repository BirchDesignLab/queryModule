---
date: 09-28-26
status: accepted
track: b
phase: m1-p2
supersedes: ["spec 6.5 (Selection: unset falls back to SiteConfig.theme.defaultMode)"]
---

# 0009 A site may default to the auto theme

## Context

Spec 6.5 lets a user pick `auto` (follow the OS scheme or the clock), but a site can only default to a fixed mode: `SiteConfig.theme.defaultMode` is `day`, `night` or `redShift`, and a user with no preference gets that mode. A mobile-unit site that runs day and night shifts wants every new user to follow the clock until they pick a mode. Issue #175 asked whether a site may default to `auto`; the Track B P2 plan listed it as decision D-B1.

## Options

1. Yes: `ThemeConfig.defaultMode` gains `"auto"`; a user with no preference follows `SiteConfig.theme.auto`.
2. No: keep spec 6.5 as implemented; sites that want clock-driven themes tell users to pick `auto`.

## Decision

Option 1 (developer via checker, 09-28-26).

- `SiteConfig.theme.defaultMode` accepts `"auto"`. With no user preference, the mode follows `SiteConfig.theme.auto` exactly as a user preference of `auto` would: `os` maps a dark OS scheme to `night`, `time` uses `night` from 19:00 to 07:00 local.
- `defaultMode: "auto"` with `auto: "off"` has nothing to follow, so `config:validate` rejects it (`config.autoDefaultNeedsAuto` at `/theme/defaultMode`). `resolveThemeMode` still returns the OS scheme for that combination, so a client never shows an undefined mode.
- An explicit user preference still wins, and before sign-in (no config loaded) the OS scheme decides, as before.
- No `CONFIG_SCHEMA_VERSION` bump: the change is additive (a new enum value). Every v1 site file stays valid, and `config:validate` passes on the shipped sites unchanged.
- A client older than this change rejects `defaultMode: "auto"` in `GET /api/v1/config`. That is safe because the web client and the API ship in one image behind the client update gate, so no older client reads a config that uses it.

## Consequences

- Spec 6.5 "Selection" now reads: unset falls back to `SiteConfig.theme.defaultMode`, which may itself be `auto`.
- `packages/core/src/config/schema.ts`, `validate-rules.ts`, `packages/tokens/src/theme-mode.ts`, and the generated `packages/config/schema/site-config.schema.json` and `packages/api/openapi.json` (the `GET /api/v1/config` response enum) change in the contract PR. Wiring `AppChrome` to pass `SiteConfig.theme` to `useThemeMode` is Track B P2 Task 13.

Covers UX-002, UX-011, BR-001. Issue #175.
