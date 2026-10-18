# Web e2e (Playwright)

Specs run against a local production build served by the API: `pnpm e2e [spec] --project=chromium`
(`scripts/dev/e2e.ts` builds, seeds the demo users and starts the server). Set `E2E_PORT` when
another run or a dev server already uses 3000. Synthetic data only: plates like `ZZ-0001`, names like
`WANTED`; nothing real, nothing published unless a spec is about publishing (and then it puts the
shipped config back, see `admin-draft.ts`).

## Conventions

- **Repeating a spec can hit the submit rate limit.** The API allows 30 submits per user per minute
  (`429 rateLimited`, [docs/api.md](../../../docs/api.md)). A flake hunt such as `--repeat-each 20`
  on a spec that submits twice per run reaches it, and the failing run shows a failed row, not a
  flake. Keep a hunt under about 12 submits a minute, or read the failing run's row text before you
  call it a flake.
- **Accessible names include CSS `::before` text.** Playwright reads "+ More details" for the toggle,
  because the plus sign is generated content. Never anchor a role name with `^More details`; match
  the stable part (`/More details/`).
- **Keyboard first.** Reach controls the way a user does (`Tab`, `press("Enter")`); `focus()` and
  `label.fill()` skip the tab order. `tabTo()` in `admin-result-cards.spec.ts` is the model.
- **Measure, do not eyeball.** Layout specs read bounding boxes and computed styles at the two demo
  sizes (1366x768 and 1024x768) so a clipped or wrapped control fails the run.
- **Shot specs are not tests.** `visual-shots`, `gap-shots`, `polish-shots` and `brief-shots` skip
  unless their `*_SHOTS_DIR` variable is set (see each file's header); they only look.
- **Builder helpers are shared** from `builder-helpers.ts` (`openBuilder`, `selectRow`, `tree`,
  `editor`, `preview`): add to it instead of copying a helper into a spec.
