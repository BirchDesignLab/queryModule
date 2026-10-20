import { diffConfig, renderChange } from "@querymodule/core/config";
import type { ConfigDocument } from "@querymodule/core/contracts";
import { and, eq } from "drizzle-orm";
import {
  documentOf,
  liveRow,
  saveDraft,
  sharedDraft,
  siteIdOf,
  validateDocument,
} from "../admin/config/draft";
import { publishDraft } from "../admin/config/publish";
import { parseStored } from "../admin/config/store";
import { auditEmail } from "../auth/identity";
import { bootstrapDocument, ConfigLoadError, canonicalJson } from "../config/load";
import { siteConfigVersion, user } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import type { Principal } from "../seams";

/** The publish note on the imported version's row (D-M2P0-4); never in audit details (D-M2P2-B7). */
export const IMPORT_NOTE = "Imported from the image";
/** The command as the operator runs it in the app container (docs/deploy.md). */
export const CONFIG_IMPORT_COMMAND =
  "docker compose run --rm app node scripts/ops/config-import.js";
/** The running app keeps its in-memory snapshot (activate.ts) until it restarts. */
export const RESTART_COMMAND = "docker compose restart app";
/** The image carries no label overlay (bootstrapDocument), so the published one is kept. */
export const IMPORT_LABELS_LINE =
  "Labels: the published label overlay is kept; the image carries none.";
/** The demo admin (seed/users.ts), named in the next step when the dry run was given none. */
const DEFAULT_ADMIN = "admin@example.test";

const USAGE =
  "usage: config-import (--admin <email> | --dry-run) [--replace-draft] [--file <site config file>]";

export class ConfigImportUsageError extends Error {
  constructor() {
    super(USAGE);
    this.name = "ConfigImportUsageError";
  }
}

export interface ConfigImportArgs {
  adminEmail?: string;
  file?: string;
  dryRun: boolean;
  replaceDraft: boolean;
}

/**
 * CLI arguments of scripts/ops/config-import.ts. `--admin` is required unless `--dry-run`; each
 * flag at most once; a flag value never starts with "-"; anything else is a usage error.
 */
export function parseConfigImportArgs(argv: readonly string[]): ConfigImportArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--dry-run" || a === "--replace-draft") {
      if (flags.has(a)) throw new ConfigImportUsageError();
      flags.add(a);
      continue;
    }
    if (a !== "--admin" && a !== "--file") throw new ConfigImportUsageError();
    const v = argv[i + 1];
    if (values.has(a) || v === undefined || v === "" || v.startsWith("-"))
      throw new ConfigImportUsageError();
    values.set(a, v);
    i++;
  }
  const dryRun = flags.has("--dry-run");
  const adminEmail = values.get("--admin");
  const file = values.get("--file");
  if (!dryRun && adminEmail === undefined) throw new ConfigImportUsageError();
  return {
    ...(file === undefined ? {} : { file }),
    ...(adminEmail === undefined ? {} : { adminEmail }),
    dryRun,
    replaceDraft: flags.has("--replace-draft"),
  };
}

export interface ImportKey {
  key: string;
  path: string;
}

/**
 * The import refused: message keys and pointers only, never document content, an email or a
 * password (spec 5.9). A refusal after this run replaced the shared draft says so in the message;
 * that draft is not restored.
 */
export class ConfigImportRefusedError extends Error {
  constructor(
    message: string,
    readonly keys: ImportKey[],
  ) {
    super(message);
    this.name = "ConfigImportRefusedError";
  }
}

/** A shared draft: its version and the id of the user who last saved it. */
export interface DraftInfo {
  version: number;
  createdBy: string;
}

export type ConfigImportResult =
  | { kind: "unchanged"; versionId: string }
  | {
      kind: "published";
      versionId: string;
      version: number;
      changes: string[];
      replacedDraft?: DraftInfo;
    }
  | { kind: "dryRun"; changes: string[]; draft?: DraftInfo };

const refuse = (reason: string, key: string): ConfigImportRefusedError =>
  new ConfigImportRefusedError(`config:import refused: ${reason}`, [{ key, path: "" }]);

/**
 * The admin the import publishes as: the user row by email (trimmed, lowercased, as grant-role
 * matches; never Unicode-normalized), active (disabledAt unset) and holding `admin`. The flag
 * must_change_password does not matter here: no session signs in. The principal is built as
 * identity.ts builds one from the user row; no session exists, so sessionId names this command.
 */
async function importAdmin(d: AppDeps, adminEmail: string): Promise<Principal> {
  const email = adminEmail.trim().toLowerCase();
  const [u] =
    email === ""
      ? []
      : await d.db
          .select({ id: user.id, email: user.email, role: user.role, disabledAt: user.disabledAt })
          .from(user)
          .where(eq(user.email, email));
  if (!u) throw refuse("no user with that email", "configImport.adminUnknown");
  if (u.disabledAt !== null) throw refuse("that user is disabled", "configImport.adminDisabled");
  if (u.role !== "admin")
    throw refuse("that user does not hold admin", "configImport.adminNotAdmin");
  return {
    userId: u.id,
    email: auditEmail(u.email),
    role: "admin",
    sessionId: "ops:config-import",
    identitySource: "local",
    authenticatedAt: d.clock.now(),
  };
}

const draftText = (draft: DraftInfo) =>
  `draft version ${draft.version} (last saved by user ${draft.createdBy})`;

/** Removes the draft this run saved, only while it still holds this run's document. */
async function removeOwnDraft(d: AppDeps, id: string, document: string): Promise<void> {
  await withTransaction(d.db, async (tx) => {
    await tx
      .delete(siteConfigVersion)
      .where(
        and(
          eq(siteConfigVersion.id, id),
          eq(siteConfigVersion.status, "draft"),
          eq(siteConfigVersion.document, document),
        ),
      );
  });
}

/**
 * #792 CFG-4, D-M2P3-4: publishes the image's site config on a seeded store. The file is resolved
 * and validated as boot does (bootstrapDocument: the mock gate applies), with the published label
 * overlay kept (the image carries none), then checked as a publish is (validateDocument: site,
 * MFA guard, adminConfig, fixture policy). Equal to the published document (canonical JSON):
 * unchanged, nothing written. Else the changes are diffConfig lines; a dry run stops there. An
 * import saves the document as the shared draft (refused while another draft exists unless
 * `replaceDraft`) and publishes it through publishDraft, so activate() writes configLoaded and
 * configPublished (actor: the named admin) in one transaction, with IMPORT_NOTE on the row only.
 * A refused publish removes this run's draft. The admin is checked before anything else.
 */
export async function importSiteConfig(
  d: AppDeps,
  o: { file: string; adminEmail: string; dryRun: boolean; replaceDraft: boolean },
): Promise<ConfigImportResult> {
  const principal = o.dryRun ? undefined : await importAdmin(d, o.adminEmail);
  let image: ConfigDocument;
  try {
    image = (
      await bootstrapDocument(o.file, {
        allowMockSources: d.env.allowMockSources,
        now: d.clock.now(),
      })
    ).document;
  } catch (e) {
    if (!(e instanceof ConfigLoadError)) throw e;
    throw new ConfigImportRefusedError("config:import refused: the site config file is invalid", [
      { key: e.reason, path: e.path },
    ]);
  }
  const siteId = siteIdOf(d);
  const live = await liveRow(d.db, siteId);
  const liveDocument = parseStored(live.document, `store site ${siteId} version ${live.version}`);
  const document: ConfigDocument = {
    siteConfig: image.siteConfig,
    locales: documentOf(live).locales,
    ...(image.mock === undefined ? {} : { mock: image.mock }),
  };
  const checked = await validateDocument(d, document);
  if (!checked.ok)
    throw new ConfigImportRefusedError(
      "config:import refused: the site config does not validate for publish",
      checked.errors.map((e) => ({ key: e.key, path: e.path })),
    );
  if (canonicalJson(document) === canonicalJson(liveDocument))
    return { kind: "unchanged", versionId: live.id };
  const changes = diffConfig(liveDocument, document).map(renderChange);
  const existing = await sharedDraft(d.db, siteId);
  const draft = existing && { version: existing.version, createdBy: existing.createdBy };
  if (o.dryRun) return { kind: "dryRun", changes, ...(draft ? { draft } : {}) };
  if (!principal) throw new Error("config:import: no admin");
  if (draft && !o.replaceDraft)
    throw new ConfigImportRefusedError(
      `config:import refused: ${draftText(draft)} exists; add --replace-draft to replace it`,
      [{ key: "configImport.draftExists", path: "" }],
    );
  const saved = await saveDraft(d, principal, { baseVersion: live.version, document });
  if (!saved.ok)
    throw saved.code === "draftConflict"
      ? refuse("the live version changed; run it again", "configImport.draftConflict")
      : new ConfigImportRefusedError(
          "config:import refused: the draft was not saved",
          saved.errors.map((e) => ({ key: e.key, path: String(e.params?.path ?? "") })),
        );
  const replacedDraft = draft && o.replaceDraft ? draft : undefined;
  const lost = replacedDraft ? `; the replaced ${draftText(replacedDraft)} is not restored` : "";
  let r: Awaited<ReturnType<typeof publishDraft>>;
  try {
    r = await publishDraft(d, principal, saved.row.version, IMPORT_NOTE);
  } catch (e) {
    await removeOwnDraft(d, saved.row.id, saved.row.document);
    throw e;
  }
  if (!r.ok) {
    await removeOwnDraft(d, saved.row.id, saved.row.document);
    if (r.code === "validationFailed")
      throw new ConfigImportRefusedError(
        `config:import refused: the publish did not validate${lost}`,
        r.errors.map((e) => ({ key: e.key, path: String(e.params?.path ?? "") })),
      );
    throw new ConfigImportRefusedError(
      `config:import refused: the live version or the draft changed; run it again${lost}`,
      [{ key: `configImport.${r.code}`, path: "" }],
    );
  }
  return {
    kind: "published",
    versionId: r.version.id,
    version: r.version.version,
    changes,
    ...(replacedDraft ? { replacedDraft } : {}),
  };
}

const plural = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

/**
 * The command's stdout lines for a result. Each ends with the next step: nothing after
 * unchanged, the import command after a dry run (with the dry run's --file and --admin, else the
 * demo admin), the restart after a publish.
 */
export function importReport(
  r: ConfigImportResult,
  o: { adminEmail?: string; file?: string },
): string[] {
  switch (r.kind) {
    case "unchanged":
      return [
        `config:import: unchanged; the published version ${r.versionId} already holds the image's site config. Nothing written.`,
        IMPORT_LABELS_LINE,
        "Nothing to do.",
      ];
    case "dryRun":
      return [
        `config:import dry run: ${plural(r.changes.length)} against the published version. Nothing written.`,
        ...r.changes,
        IMPORT_LABELS_LINE,
        ...(r.draft
          ? [
              `A shared ${draftText(r.draft)} exists: the import refuses unless you add --replace-draft, which replaces it.`,
            ]
          : []),
        "Next step, to publish these changes:",
        [
          CONFIG_IMPORT_COMMAND,
          ...(o.file === undefined ? [] : ["--file", o.file]),
          "--admin",
          o.adminEmail ?? DEFAULT_ADMIN,
        ].join(" "),
      ];
    case "published":
      return [
        `config:import: published version ${r.version} (${r.versionId}), note "${IMPORT_NOTE}", with ${plural(r.changes.length)}:`,
        ...r.changes,
        IMPORT_LABELS_LINE,
        ...(r.replacedDraft ? [`Replaced the shared ${draftText(r.replacedDraft)}.`] : []),
        "The running app serves the old version until it restarts. Next step:",
        RESTART_COMMAND,
      ];
  }
}

/** The command's stderr lines for a failure: a refusal's message and keys, else the error class. */
export function refusalLines(e: unknown): string[] {
  if (e instanceof ConfigImportRefusedError)
    return [e.message, ...e.keys.map((k) => `  ${k.key} ${k.path || "/"}`)];
  return [`config:import failed: ${e instanceof Error ? e.name : "error"}`];
}
