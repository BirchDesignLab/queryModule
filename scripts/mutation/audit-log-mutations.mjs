// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the patterns are source text, not templates
// TDD repair for BW2 Task 3 (#726): the AuditLog tests were written after the components, so each
// behavior they claim to cover is broken here, one at a time, and the suite must go red. The source
// file is restored from git after every run. Run from the repo root:
//   VITEST_MAX_WORKERS=3 node scripts/mutation/audit-log-mutations.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const LOG = "apps/web/src/admin/AuditLog.tsx";
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
    from: 'aria-disabled={loading || page.nextCursor === null ? "true" : undefined}',
    to: "disabled={loading || page.nextCursor === null}",
  },
  {
    name: "Newer does not step back",
    file: LOG,
    from: "store.set({ cursors: cursors.slice(0, -1) });",
    to: "store.set({ cursors: [...cursors] });",
  },
  {
    name: "Apply sends without validating",
    file: LOG,
    from: "if (result.filters !== null) store.set({",
    to: "if (true) store.set({ applied: result.filters ?? applied,",
  },
  {
    name: "typing a filter fetches at once",
    file: LOG,
    from: "onChange={(patch) => store.set({ form: { ...form, ...patch } })}",
    to: "onChange={(patch) => store.set({ form: { ...form, ...patch }, applied: validateAuditForm({ ...form, ...patch }).filters })}",
  },
  {
    name: "403 shows the generic error",
    file: LOG,
    from: 'failure === "forbidden"\n              ? t("admin.audit.error.forbidden")',
    to: 'failure === "forbidden"\n              ? t("admin.audit.error.load")',
  },
  {
    name: "export is not blocked by a filter error",
    file: LOG,
    from: 'aria-disabled={exportBlocked || applied === null ? "true" : undefined}',
    to: "aria-disabled={undefined}",
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
    from: "isAuditEventType(row.type) ? t(`admin.audit.type.${row.type}`) : row.type",
    to: "isAuditEventType(row.type) ? t(`admin.audit.type.${row.type}`) : ''",
  },
  {
    name: "empty page has no Reset filters",
    file: LOG,
    from: 't("admin.audit.empty")}</p>\n              <button type="button" className="qm-button qm-button--secondary" onClick={reset}>',
    to: 't("admin.audit.empty")}</p>\n              <button hidden type="button" className="qm-button qm-button--secondary" onClick={reset}>',
  },
  {
    name: "Try again does not refetch",
    file: LOG,
    from: "onClick={() => setAttempt((n) => n + 1)}",
    to: "onClick={() => undefined}",
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
      ["--filter", "@querymodule/web", "exec", "vitest", "run", "src/admin/AuditLog.test.tsx"],
      { encoding: "utf8", shell: true, env: { ...process.env, NO_COLOR: "1" } },
    );
    results.push({ name: m.name, outcome: run.status === 0 ? "STAYED GREEN" : "red" });
  } finally {
    execFileSync("git", ["checkout", "--", m.file]);
  }
}
for (const r of results) console.log(`${r.outcome.padEnd(30)} ${r.name}`);
process.exitCode = results.some((r) => r.outcome !== "red") ? 1 : 0;
