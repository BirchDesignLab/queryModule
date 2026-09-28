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

// #212 C-M2 and wave 4b review C-M1: every rejects case names the check that must catch it, so
// one check firing on a chunk cannot hide a regression in another.
const PIN = /trigger differs from migration 0001/;
const SHAPE = /statement not allowed on audit_event/;
const REBUILD = /table rebuild/;
const SCHEMA = /statement touches the schema table/;
const COLUMN = /added column must be nullable with no constraint but a literal DEFAULT/;
const SECOND = /second CREATE TABLE/;
const TWICE = /trigger created twice/;

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
    ["rebuild", "CREATE TABLE `__new_audit_event` (`id` integer);", REBUILD],
    ["drop", "DROP TABLE `audit_event`;", SHAPE],
    ["rename table", "ALTER TABLE `audit_event` RENAME TO `audit_event_old`;", SHAPE],
    ["rename column", "ALTER TABLE `audit_event` RENAME COLUMN `type` TO `kind`;", SHAPE],
    ["drop column", "ALTER TABLE `audit_event` DROP COLUMN `type`;", SHAPE],
    ["not null column", "ALTER TABLE `audit_event` ADD `x` text NOT NULL;", COLUMN],
    ["drop trigger", "DROP TRIGGER audit_event_no_update;", SHAPE],
    ["drop replace trigger", "DROP TRIGGER IF EXISTS `audit_event_no_replace`;", SHAPE],
    ["replaced trigger", trig, TWICE],
    [
      "other trigger",
      "CREATE TRIGGER audit_event_x AFTER INSERT ON audit_event BEGIN SELECT 1; END;",
      SHAPE,
    ],
    // A2 review G-I2 / C-I1 (spec 9.2, 5.5): only a non-unique index. With a unique one,
    // INSERT OR REPLACE deletes the colliding audit row and no trigger fires.
    ["unique index", "CREATE UNIQUE INDEX `u` ON `audit_event` (`correlation_id`);", SHAPE],
    [
      "partial unique index",
      "CREATE UNIQUE INDEX u ON audit_event (correlation_id) WHERE correlation_id IS NOT NULL;",
      SHAPE,
    ],
    ["lowercase unique index", "create unique index u on audit_event (correlation_id);", SHAPE],
    ["update rows", "UPDATE audit_event SET type = 'x';", SHAPE],
    ["delete rows", "DELETE FROM audit_event;", SHAPE],
    ["second create", create, SECOND],
    [
      "hidden second statement",
      "ALTER TABLE `audit_event` ADD `y` text;\nDROP TABLE `audit_event`;",
      COLUMN,
    ],
    ["lowercase drop", "drop table audit_event;", SHAPE],
    ["double-quoted drop", 'DROP TABLE "audit_event";', SHAPE],
    ["bracketed drop", "DROP TABLE [audit_event];", SHAPE],
    ["multi-line drop", "DROP\n  TABLE\n\taudit_event;", SHAPE],
    ["alter column", "ALTER TABLE audit_event ALTER COLUMN type TO integer;", SHAPE],
    [
      "trigger if not exists",
      "CREATE TRIGGER IF NOT EXISTS audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
      SHAPE,
    ],
    [
      "not null through a block comment",
      "ALTER TABLE audit_event ADD x text NOT/**/NULL DEFAULT '';",
      COLUMN,
    ],
    [
      "not null through a line comment",
      "ALTER TABLE audit_event ADD x text NOT -- c\nNULL DEFAULT '';",
      COLUMN,
    ],
    ["check constraint", "ALTER TABLE audit_event ADD x text CHECK (0);", COLUMN],
    ["references constraint", "ALTER TABLE audit_event ADD x text REFERENCES user(id);", COLUMN],
    ["generated column", "ALTER TABLE audit_event ADD x text GENERATED ALWAYS AS ('a');", COLUMN],
    ["collate constraint", "ALTER TABLE audit_event ADD x text COLLATE NOCASE;", COLUMN],
    ["unique column", "ALTER TABLE audit_event ADD x text UNIQUE;", COLUMN],
    [
      "comment opener inside a string",
      "ALTER TABLE audit_event ADD x text DEFAULT '/*'; DROP TABLE audit_event; -- */';",
      COLUMN,
    ],
    ["statement before an unclosed comment", "DROP TABLE audit_event; /* never closed", SHAPE],
    ["writable_schema", "PRAGMA writable_schema = ON;", SCHEMA],
    ["sqlite_master delete", "DELETE FROM sqlite_master WHERE type = 'trigger';", SCHEMA],
    [
      "sqlite_schema rewrite",
      "UPDATE SQLITE_SCHEMA SET sql = 'CREATE TRIGGER t BEFORE UPDATE ON t BEGIN SELECT 1; END' WHERE name = 't';",
      SCHEMA,
    ],
    ["sqlite_temp_master write", "DELETE FROM sqlite_temp_master;", SCHEMA],
    ["single-quoted drop", "DROP TABLE 'audit_event';", SHAPE],
    ["single-quoted rename", "ALTER TABLE 'audit_event' RENAME TO x;", SHAPE],
    ["single-quoted schema table", "DELETE FROM 'sqlite_master';", SCHEMA],
    [
      "drop hidden by a comment opener in a double-quoted identifier",
      'CREATE INDEX "i/*" ON other (x); DROP TABLE audit_event; -- */',
      SHAPE,
    ],
    [
      "drop hidden by a comment opener in a backtick identifier",
      "CREATE INDEX `i/*` ON other (x); DROP TABLE audit_event; -- */",
      SHAPE,
    ],
    [
      "drop hidden by a comment opener in a bracketed identifier",
      "CREATE INDEX [i--] ON other (x); DROP TABLE audit_event;",
      SHAPE,
    ],
    [
      "drop hidden by a quote in a double-quoted identifier",
      "CREATE INDEX \"i'\" ON other (x); DROP TABLE audit_event; -- '",
      SHAPE,
    ],
  ])("rejects %s", (_n, sql, check) => {
    const errors = checkAuditMigrations([
      { name: "0000_init.sql", sql: create },
      { name: "0001_audit_triggers.sql", sql: triggers },
      { name: "0005_bad.sql", sql },
    ]);
    expect(
      errors.some((e) => check.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it.each([
    ["hidden statement after a trigger body", `${trig}\nDROP TABLE audit_event;`, SHAPE],
    [
      "hidden statement after a trigger body, no semicolon",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END; DROP TABLE audit_event",
      SHAPE,
    ],
    [
      "no-op trigger body",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT 1; END;",
      SHAPE,
    ],
    [
      "trigger on the wrong event",
      "CREATE TRIGGER audit_event_no_update BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
      SHAPE,
    ],
    [
      "trigger on another table",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON other BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
      SHAPE,
    ],
    // A2 review C-M1: the statement is pinned to the text migration 0001 creates.
    [
      "WHEN clause that never fires",
      "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event WHEN 0 BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
      PIN,
    ],
    [
      "different RAISE message",
      "CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN SELECT RAISE(ABORT, 'x'); END;",
      PIN,
    ],
    [
      "weakened replace condition",
      "CREATE TRIGGER audit_event_no_replace BEFORE INSERT ON audit_event WHEN NEW.id IS NULL BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;",
      PIN,
    ],
  ])("rejects an initial trigger migration with a %s", (_n, sql, check) => {
    const errors = checkAuditMigrations([
      { name: "0000_init.sql", sql: create },
      { name: "0001_audit_triggers.sql", sql },
    ]);
    expect(
      errors.some((e) => check.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  // #195 (A2 review rr:N-M2): the pin keeps quotes, as checkAuditTriggers does at startup.
  // `WHERE 'id' = NEW.id` compares a string literal, so audit_event_no_replace never fires.
  const replaceTrigger = triggers.split("\n--> statement-breakpoint\n")[2] as string;
  const updateTrigger = triggers.split("\n--> statement-breakpoint\n")[0] as string;
  it.each([
    ["string-literal id", replaceTrigger.replace("WHERE id =", "WHERE 'id' ="), PIN],
    ["double-quoted id", replaceTrigger.replace("WHERE id =", 'WHERE "id" ='), PIN],
    ["bracketed id", replaceTrigger.replace("WHERE id =", "WHERE [id] ="), PIN],
    ["backticked id", replaceTrigger.replace("WHERE id =", "WHERE `id` ="), PIN],
    ["double-quoted NEW.id", replaceTrigger.replace("= NEW.id)", '= NEW."id")'), PIN],
    ["double-quoted table", updateTrigger.replace("ON audit_event", 'ON "audit_event"'), PIN],
    ["bracketed table", updateTrigger.replace("ON audit_event", "ON [audit_event]"), PIN],
    // A double-quoted RAISE message is an identifier, not the '' literal the shape expects.
    [
      "double-quoted RAISE message",
      updateTrigger.replace("'audit_event is append-only'", '"audit_event is append-only"'),
      SHAPE,
    ],
    // #212 C-M1: checkAuditTriggers compares sqlite_master text, which keeps comments.
    ["block comment inside", updateTrigger.replace("BEGIN", "/* note */ BEGIN"), PIN],
    ["line comment inside", updateTrigger.replace("\nBEGIN", " -- note\nBEGIN"), PIN],
  ])("rejects an edit to a pinned trigger: %s", (_n, sql, check) => {
    const errors = checkAuditMigrations([
      { name: "0000_init.sql", sql: create },
      { name: "0001_audit_triggers.sql", sql },
    ]);
    expect(
      errors.some((e) => check.test(e)),
      errors.join("\n"),
    ).toBe(true);
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
