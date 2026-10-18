// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the patterns are source text, not templates
// TDD repair for BW2 Tasks 3 and 4 (#726, #727): the AuditLog tests were written after the
// components, so each behavior they claim to cover is broken here, one at a time, and the named
// test file must go red. The source file is restored from git after every run. Run from the repo
// root:
//   VITEST_MAX_WORKERS=3 node scripts/mutation/audit-log-mutations.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const LOG = "apps/web/src/admin/AuditLog.tsx";
const VIEW = "apps/web/src/admin/AdminRequestView.tsx";
const LOG_TEST = "src/admin/AuditLog.test.tsx";
const VIEW_TEST = "src/admin/AdminRequestView.test.tsx";
const MUTATIONS = [
  {
    name: "implementer may view the audit log",
    file: "apps/web/src/admin/roles.ts",
    from: 'canViewAudit = (role: string | null | undefined): boolean => role === "admin"',
    to: "canViewAudit = (role: string | null | undefined): boolean => role !== undefined",
  },
  {
    name: "feature flag off does not hide the entry",
    file: "apps/web/src/admin/roles.ts",
    from: "features !== undefined && !features.adminAudit",
    to: "false && features !== undefined",
  },
  {
    name: "the page fetches before the config says the feature is on",
    file: LOG,
    from: "if (features === undefined) return <SectionHeading>",
    to: "if (false as boolean) return <SectionHeading>",
  },
  {
    name: "announcement carries row content",
    file: LOG,
    from: 't("admin.audit.loaded", { count: result.events.length })',
    to: 't("admin.audit.loaded", { count: result.events.length }) + (result.events[0]?.actor.email ?? "")',
  },
  {
    name: "window over 31 days is sent",
    file: "apps/web/src/admin/audit-model.ts",
    from: "else if (toMinute - from > MAX_AUDIT_WINDOW_MS)",
    to: "else if (false as boolean)",
  },
  {
    name: "Older drops the cursor",
    file: LOG,
    from: "store.set({ cursors: [...cursors, page.nextCursor] });",
    to: "store.set({ cursors: [...cursors, undefined] });",
  },
  {
    name: "Older loses focus (disabled instead of aria-disabled)",
    file: LOG,
    from: 'aria-disabled={loading || atOldest ? "true" : undefined}',
    to: "disabled={loading || atOldest}",
  },
  {
    name: "a disabled end has no reason",
    file: LOG,
    from: "aria-describedby={atOldest ? pagesWhy : undefined}",
    to: "aria-describedby={undefined}",
  },
  {
    name: "Newer does not step back",
    file: LOG,
    from: "store.set({ cursors: cursors.slice(0, -1) });",
    to: "store.set({ cursors: [...cursors] });",
  },
  {
    name: "Apply with errors announces nothing",
    file: LOG,
    from: 'announcer.announce(\n        t("admin.audit.needAttention"',
    to: 'void (\n        t("admin.audit.needAttention"',
  },
  {
    name: "typing a filter fetches at once",
    file: LOG,
    from: "onChange={(patch) => store.set({ form: { ...form, ...patch } })}",
    to: "onChange={(patch) => store.set({ form: { ...form, ...patch }, applied: validateAuditForm({ ...form, ...patch }).filters })}",
  },
  {
    name: "a server 403 shows the generic error",
    file: LOG,
    from: 'failure === "forbidden" ? "admin.audit.noAccess.title" : "admin.audit.notOn.title"',
    to: '"admin.audit.failed.title"',
  },
  {
    name: "export is not blocked by a filter error",
    file: LOG,
    from: 'aria-disabled={exportBlocked || exporting ? "true" : undefined}',
    to: "aria-disabled={undefined}",
  },
  {
    name: "export has no in-flight guard",
    file: LOG,
    from: "if (applied === null || exportBlocked || exporting) return;",
    to: "if (applied === null || exportBlocked) return;",
  },
  {
    name: "export ignores the applied filters",
    file: LOG,
    from: "const ok = await downloadAuditExport(api, applied);",
    to: "const ok = await downloadAuditExport(api, { from: 0, to: 1 });",
  },
  {
    name: "sign-out does not empty the store",
    file: "apps/web/src/admin/audit-store.ts",
    from: "services.reset.register(() => store?.reset());",
    to: "void 0;",
  },
  {
    name: "Rows per page keeps the cursor",
    file: LOG,
    from: "store.set({ pageSize: Number(e.currentTarget.value), cursors: [undefined] })",
    to: "store.set({ pageSize: Number(e.currentTarget.value) })",
  },
  {
    name: "unknown event type is hidden",
    file: "apps/web/src/admin/AuditTable.tsx",
    from: "isAuditEventType(row.type)\n              ? t(`admin.audit.type.${row.type}`)\n              : row.type",
    to: "isAuditEventType(row.type)\n              ? t(`admin.audit.type.${row.type}`)\n              : ''",
  },
  {
    name: "request link has no hidden text",
    file: "apps/web/src/admin/AuditTable.tsx",
    from: '<VisuallyHidden>{t("admin.audit.openRequest")}</VisuallyHidden>',
    to: "",
  },
  {
    name: "empty state Reset does not hand focus to the form's Reset",
    file: LOG,
    from: "if (toResetButton) queueMicrotask(() => resetRef.current?.focus());",
    to: "void toResetButton;",
  },
  {
    name: "Try again does not refetch",
    file: LOG,
    from: "setAttempt((n) => n + 1);\n    // The retry button",
    to: "// The retry button",
  },
  {
    name: "Try again does not move focus to the results",
    file: LOG,
    from: "queueMicrotask(() => resultsRef.current?.focus());",
    to: "void resultsRef;",
  },
  {
    name: "a StrictMode pass sends the audit page twice",
    file: LOG,
    from: "    )\n      return;\n    const key: FetchKey",
    to: "    )\n      void 0;\n    const key: FetchKey",
  },
  {
    name: "Back does not return focus to the request link",
    file: LOG,
    from: "    link.focus();\n  }, [page]);",
    to: "  }, [page]);",
    test: VIEW_TEST,
  },
  {
    name: "request view fetches twice under StrictMode",
    file: VIEW,
    from: "if (lastFetch.current === key) return;",
    to: "if (false as boolean) return;",
    test: VIEW_TEST,
  },
  {
    name: "request view asks for hidden results",
    file: VIEW,
    from: "fetchAdminQuery(api, correlationId, false)",
    to: "fetchAdminQuery(api, correlationId, true)",
    test: VIEW_TEST,
  },
  {
    name: "Include hidden results is live",
    file: VIEW,
    from: 'aria-disabled="true"\n            aria-describedby="qm-request-hidden-why"',
    to: 'aria-describedby="qm-request-hidden-why"',
    test: VIEW_TEST,
  },
  {
    name: "not found is an alert",
    file: VIEW,
    from: '<StateBox\n            title={t("admin.request.notFound.title")}',
    to: '<StateBox\n            alert\n            title={t("admin.request.notFound.title")}',
    test: VIEW_TEST,
  },
  {
    name: "request view has no recorded banner",
    file: VIEW,
    from: '<b>{t("admin.request.recorded")}</b>',
    to: "<b />",
    test: VIEW_TEST,
  },
  {
    name: "severity badge is dropped from the entry head",
    file: VIEW,
    from: "...(highest === null",
    to: "...(true",
    test: VIEW_TEST,
  },
];

const results = [];
for (const m of MUTATIONS) {
  const before = readFileSync(m.file, "utf8");
  if (!before.includes(m.from)) {
    results.push({ name: m.name, outcome: "SKIPPED (pattern not found)" });
    continue;
  }
  writeFileSync(m.file, before.replace(m.from, m.to));
  try {
    const run = spawnSync(
      "pnpm",
      ["--filter", "@querymodule/web", "exec", "vitest", "run", m.test ?? LOG_TEST],
      { encoding: "utf8", shell: true, env: { ...process.env, NO_COLOR: "1" } },
    );
    results.push({ name: m.name, outcome: run.status === 0 ? "STAYED GREEN" : "red" });
  } finally {
    execFileSync("git", ["checkout", "--", m.file]);
  }
}
for (const r of results) console.log(`${r.outcome.padEnd(30)} ${r.name}`);
process.exitCode = results.some((r) => r.outcome !== "red") ? 1 : 0;
