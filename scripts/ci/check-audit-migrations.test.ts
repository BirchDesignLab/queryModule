import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIT_TRIGGER_STATEMENTS, checkAuditMigrations } from "./check-audit-migrations";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = resolve(root, "scripts", "ci", "check-audit-migrations.ts");

const create =
  "CREATE TABLE `audit_event` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `type` text NOT NULL);";
// The three statements exactly as migration 0001 creates them (A2 review C-M1 pins them).
const trig =
  "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event\nBEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;";
const triggers = [
  trig,
  "CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event\nBEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
  "CREATE TRIGGER audit_event_no_replace BEFORE INSERT ON audit_event WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM audit_event WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
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
        {
          name: "0003_y.sql",
          sql: [
            "-- a nullable column with a literal default\nALTER TABLE `audit_event` ADD COLUMN `n` integer DEFAULT 0;",
            "ALTER TABLE audit_event ADD `w` text DEFAULT 'a--b /* c */';",
            'ALTER TABLE "audit_event" ADD [v] real DEFAULT NULL;',
            "ALTER TABLE audit_event ADD q text DEFAULT 'it''s; DROP'; -- trailing note",
          ].join("\n--> statement-breakpoint\n"),
        },
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
    // A2 review G-I2 / C-I1 (spec 9.2, 5.5): only a non-unique index. With a unique one,
    // INSERT OR REPLACE deletes the colliding audit row and no trigger fires.
    ["unique index", "CREATE UNIQUE INDEX `u` ON `audit_event` (`correlation_id`);"],
    [
      "partial unique index",
      "CREATE UNIQUE INDEX u ON audit_event (correlation_id) WHERE correlation_id IS NOT NULL;",
    ],
    ["lowercase unique index", "create unique index u on audit_event (correlation_id);"],
    ["update rows", "UPDATE audit_event SET type = 'x';"],
    ["delete rows", "DELETE FROM audit_event;"],
    ["second create", create],
    [
      "hidden second statement",
      "ALTER TABLE `audit_event` ADD `y` text;\nDROP TABLE `audit_event`;",
    ],
    ["lowercase drop", "drop table audit_event;"],
    ["double-quoted drop", 'DROP TABLE "audit_event";'],
    ["bracketed drop", "DROP TABLE [audit_event];"],
    ["multi-line drop", "DROP\n  TABLE\n\taudit_event;"],
    ["alter column", "ALTER TABLE audit_event ALTER COLUMN type TO integer;"],
    [
      "trigger if not exists",
      "CREATE TRIGGER IF NOT EXISTS audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
    ],
    [
      "not null through a block comment",
      "ALTER TABLE audit_event ADD x text NOT/**/NULL DEFAULT '';",
    ],
    [
      "not null through a line comment",
      "ALTER TABLE audit_event ADD x text NOT -- c\nNULL DEFAULT '';",
    ],
    ["check constraint", "ALTER TABLE audit_event ADD x text CHECK (0);"],
    ["references constraint", "ALTER TABLE audit_event ADD x text REFERENCES user(id);"],
    ["generated column", "ALTER TABLE audit_event ADD x text GENERATED ALWAYS AS ('a');"],
    ["collate constraint", "ALTER TABLE audit_event ADD x text COLLATE NOCASE;"],
    ["unique column", "ALTER TABLE audit_event ADD x text UNIQUE;"],
    [
      "comment opener inside a string",
      "ALTER TABLE audit_event ADD x text DEFAULT '/*'; DROP TABLE audit_event; -- */';",
    ],
    ["statement before an unclosed comment", "DROP TABLE audit_event; /* never closed"],
    ["writable_schema", "PRAGMA writable_schema = ON;"],
    ["sqlite_master delete", "DELETE FROM sqlite_master WHERE type = 'trigger';"],
    [
      "sqlite_schema rewrite",
      "UPDATE SQLITE_SCHEMA SET sql = 'CREATE TRIGGER t BEFORE UPDATE ON t BEGIN SELECT 1; END' WHERE name = 't';",
    ],
    ["sqlite_temp_master write", "DELETE FROM sqlite_temp_master;"],
    ["single-quoted drop", "DROP TABLE 'audit_event';"],
    ["single-quoted rename", "ALTER TABLE 'audit_event' RENAME TO x;"],
    ["single-quoted schema table", "DELETE FROM 'sqlite_master';"],
    [
      "drop hidden by a comment opener in a double-quoted identifier",
      'CREATE INDEX "i/*" ON other (x); DROP TABLE audit_event; -- */',
    ],
    [
      "drop hidden by a comment opener in a backtick identifier",
      "CREATE INDEX `i/*` ON other (x); DROP TABLE audit_event; -- */",
    ],
    [
      "drop hidden by a comment opener in a bracketed identifier",
      "CREATE INDEX [i--] ON other (x); DROP TABLE audit_event;",
    ],
    [
      "drop hidden by a quote in a double-quoted identifier",
      "CREATE INDEX \"i'\" ON other (x); DROP TABLE audit_event; -- '",
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

  it.each([
    ["hidden statement after a trigger body", `${trig}\nDROP TABLE audit_event;`],
    [
      "hidden statement after a trigger body, no semicolon",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END; DROP TABLE audit_event",
    ],
    [
      "no-op trigger body",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT 1; END;",
    ],
    [
      "trigger on the wrong event",
      "CREATE TRIGGER audit_event_no_update BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
    ],
    [
      "trigger on another table",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON other BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
    ],
    // A2 review C-M1: the statement is pinned to the text migration 0001 creates.
    [
      "WHEN clause that never fires",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event WHEN 0 BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
    ],
    [
      "different RAISE message",
      "CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN SELECT RAISE(ABORT, 'x'); END;",
    ],
    [
      "weakened replace condition",
      "CREATE TRIGGER audit_event_no_replace BEFORE INSERT ON audit_event WHEN NEW.id IS NULL BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
    ],
  ])("rejects an initial trigger migration with a %s", (_n, sql) => {
    expect(
      checkAuditMigrations([
        { name: "0000_init.sql", sql: create },
        { name: "0001_audit_triggers.sql", sql },
      ]).length,
    ).toBeGreaterThan(0);
  });

  // #195 (A2 review rr:N-M2): the pin keeps quotes, as checkAuditTriggers does at startup.
  // `WHERE 'id' = NEW.id` compares a string literal, so audit_event_no_replace never fires.
  const replaceTrigger = triggers.split("\n--> statement-breakpoint\n")[2] as string;
  const updateTrigger = triggers.split("\n--> statement-breakpoint\n")[0] as string;
  it.each([
    ["string-literal id", replaceTrigger.replace("WHERE id =", "WHERE 'id' =")],
    ["double-quoted id", replaceTrigger.replace("WHERE id =", 'WHERE "id" =')],
    ["bracketed id", replaceTrigger.replace("WHERE id =", "WHERE [id] =")],
    ["backticked id", replaceTrigger.replace("WHERE id =", "WHERE `id` =")],
    ["double-quoted NEW.id", replaceTrigger.replace("= NEW.id)", '= NEW."id")')],
    ["double-quoted table", updateTrigger.replace("ON audit_event", 'ON "audit_event"')],
    ["bracketed table", updateTrigger.replace("ON audit_event", "ON [audit_event]")],
    [
      "double-quoted RAISE message",
      updateTrigger.replace("'audit_event is append-only'", '"audit_event is append-only"'),
    ],
  ])("rejects a quote-kind edit to a pinned trigger: %s", (_n, sql) => {
    const errors = checkAuditMigrations([
      { name: "0000_init.sql", sql: create },
      { name: "0001_audit_triggers.sql", sql },
    ]);
    expect(errors.some((e) => /differs from migration 0001|not allowed/.test(e))).toBe(true);
  });

  it("accepts the committed migration 0001 unchanged (#195)", () => {
    const sql = readFileSync(resolve(root, "packages/api/drizzle/0001_audit_triggers.sql"), "utf8");
    expect(
      checkAuditMigrations([
        { name: "0000_init.sql", sql: create },
        { name: "0001_audit_triggers.sql", sql },
      ]),
    ).toEqual([]);
  });

  it("pins the same trigger statements as the startup check in migrate.ts (C-M1)", () => {
    const migrate = readFileSync(resolve(root, "packages/api/src/db/migrate.ts"), "utf8");
    expect(Object.keys(AUDIT_TRIGGER_STATEMENTS).sort()).toEqual([
      "audit_event_no_delete",
      "audit_event_no_replace",
      "audit_event_no_update",
    ]);
    for (const [name, sql] of Object.entries(AUDIT_TRIGGER_STATEMENTS))
      expect(migrate, name).toContain(`${name}:\n    ${JSON.stringify(sql)},`);
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
