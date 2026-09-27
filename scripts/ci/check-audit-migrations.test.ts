import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkAuditMigrations } from "./check-audit-migrations";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = resolve(root, "scripts", "ci", "check-audit-migrations.ts");

const create =
  "CREATE TABLE `audit_event` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `type` text NOT NULL);";
const trig =
  "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'x'); END;";
const triggers = [
  trig,
  "CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN SELECT RAISE(ABORT, 'x'); END;",
  "CREATE TRIGGER audit_event_no_replace BEFORE INSERT ON audit_event WHEN NEW.id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'x'); END;",
].join("\n--> statement-breakpoint\n");

describe("SEC-010 audit_event additive-only migrations", () => {
  it("accepts create, the three triggers, nullable add column and index", () => {
    expect(
      checkAuditMigrations([
        {
          name: "0000_init.sql",
          sql: `${create}\n--> statement-breakpoint\nCREATE INDEX \`audit_event_at_idx\` ON \`audit_event\` (\`at\`);`,
        },
        { name: "0001_audit_triggers.sql", sql: triggers },
        { name: "0002_x.sql", sql: "ALTER TABLE `audit_event` ADD `note_id` text;" },
      ]),
    ).toEqual([]);
  });

  it.each([
    ["rebuild", "CREATE TABLE `__new_audit_event` (`id` integer);"],
    ["drop", "DROP TABLE `audit_event`;"],
    ["rename table", "ALTER TABLE `audit_event` RENAME TO `audit_event_old`;"],
    ["rename column", "ALTER TABLE `audit_event` RENAME COLUMN `type` TO `kind`;"],
    ["drop column", "ALTER TABLE `audit_event` DROP COLUMN `type`;"],
    ["not null column", "ALTER TABLE `audit_event` ADD `x` text NOT NULL;"],
    ["drop trigger", "DROP TRIGGER audit_event_no_update;"],
    ["drop replace trigger", "DROP TRIGGER IF EXISTS `audit_event_no_replace`;"],
    ["replaced trigger", trig],
    [
      "other trigger",
      "CREATE TRIGGER audit_event_x AFTER INSERT ON audit_event BEGIN SELECT 1; END;",
    ],
    ["update rows", "UPDATE audit_event SET type = 'x';"],
    ["delete rows", "DELETE FROM audit_event;"],
    ["second create", create],
    [
      "hidden second statement",
      "ALTER TABLE `audit_event` ADD `y` text;\nDROP TABLE `audit_event`;",
    ],
  ])("rejects %s", (_n, sql) => {
    expect(
      checkAuditMigrations([
        { name: "0000_init.sql", sql: create },
        { name: "0001_audit_triggers.sql", sql: triggers },
        { name: "0005_bad.sql", sql },
      ]).length,
    ).toBeGreaterThan(0);
  });

  it("the CLI passes on the real migrations and exits 1 on a violation", () => {
    const ok = spawnSync(process.execPath, [cli, resolve(root, "packages", "api", "drizzle")], {
      encoding: "utf8",
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^audit_event migrations ok \(\d+ files\)$/m);

    const dir = mkdtempSync(join(tmpdir(), "audit-mig-"));
    try {
      writeFileSync(join(dir, "0000_init.sql"), create);
      writeFileSync(join(dir, "0001_bad.sql"), "DROP TABLE `audit_event`;");
      const bad = spawnSync(process.execPath, [cli, dir], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("0001_bad.sql");
      expect(bad.stdout).toContain("1 violation(s)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
