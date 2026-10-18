import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_DEFAULT_LIMIT,
  AuditRowReadError,
  decodeAuditCursor,
  encodeAuditCursor,
  readAuditPage,
} from "../../src/audit/read";
import type { Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { auditEvent } from "../../src/db/schema";
import { openTempDatabase } from "../helpers/db";

/*
 * Spec 5.1, SEC-012 (#711): the admin audit page read. Rows are inserted straight into
 * audit_event so `at` is exact (ties included); ids and metadata only, mock values (spec 5.4).
 */

async function fresh(): Promise<Db> {
  const db = await openTempDatabase();
  await runMigrations(db, resolve(import.meta.dirname, "../../drizzle"));
  return db;
}

const T0 = 1_790_000_000_000;
const CID_A = "0199a0b0-0000-7000-8000-0000000000a1";
const CID_B = "0199a0b0-0000-7000-8000-0000000000b2";

interface Seed {
  type: string;
  at: number;
  actor: string;
  credential?: string;
  correlationId?: string;
  partId?: number;
  hostSubject?: string;
}

async function seed(db: Db, rows: readonly Seed[]): Promise<number[]> {
  const ids: number[] = [];
  for (const r of rows) {
    const [row] = await db
      .insert(auditEvent)
      .values({
        type: r.type,
        at: r.at,
        correlationId: r.correlationId ?? null,
        partId: r.partId ?? null,
        actorUserId: r.actor,
        actorEmail: null,
        actorRole: "user",
        credentialUserId: r.credential ?? null,
        identitySource: r.hostSubject === undefined ? "local" : "host",
        hostSubject: r.hostSubject ?? null,
        details: { sessionId: "0199a0b0-0000-7000-8000-0000000000e1" },
      })
      .returning({ id: auditEvent.id });
    if (!row) throw new Error("seed insert returned no id");
    ids.push(row.id);
  }
  return ids;
}

const WINDOW = { from: T0, to: T0 + 10_000 };

describe("spec 5.1 audit cursor", () => {
  it("round-trips in the audited base64url alphabet", () => {
    const s = encodeAuditCursor({ at: T0, id: 42 });
    expect(s).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(decodeAuditCursor(s)).toEqual({ at: T0, id: 42 });
  });

  it("answers null for any malformed cursor", () => {
    const b64 = (v: string) => Buffer.from(v, "utf8").toString("base64url");
    for (const bad of [
      "",
      "!!",
      "a+b/",
      b64("not json"),
      b64("[]"),
      b64(JSON.stringify({ at: T0 })),
      b64(JSON.stringify({ at: T0, id: 0 })),
      b64(JSON.stringify({ at: -1, id: 1 })),
      b64(JSON.stringify({ at: T0, id: 1.5 })),
      b64(JSON.stringify({ at: T0, id: 1, extra: true })),
      b64(JSON.stringify({ at: "1", id: 1 })),
    ])
      expect(decodeAuditCursor(bad), bad).toBeNull();
  });
});

describe("spec 5.1 readAuditPage", () => {
  it("defaults to 50 rows", () => {
    expect(AUDIT_PAGE_DEFAULT_LIMIT).toBe(50);
  });

  it("is newest first by (at, id), the window inclusive at both ends", async () => {
    const db = await fresh();
    const [before, atFrom, tieLow, tieHigh, atTo, after] = await seed(db, [
      { type: "logout", at: T0 - 1, actor: "zz-u1" },
      { type: "logout", at: T0, actor: "zz-u1" },
      { type: "logout", at: T0 + 5, actor: "zz-u1" },
      { type: "logout", at: T0 + 5, actor: "zz-u1" },
      { type: "logout", at: T0 + 10_000, actor: "zz-u1" },
      { type: "logout", at: T0 + 10_001, actor: "zz-u1" },
    ]);
    const page = await readAuditPage(db, WINDOW, null, 50);
    expect(page.events.map((e) => e.id)).toEqual([atTo, tieHigh, tieLow, atFrom]);
    expect(page.events.map((e) => e.id)).not.toContain(before);
    expect(page.events.map((e) => e.id)).not.toContain(after);
    expect(page.nextCursor).toBeNull();
  });

  it("user matches the actor or the credential owner; type and correlationId are exact", async () => {
    const db = await fresh();
    const [asActor, asOwner, other, otherType, cidB] = await seed(db, [
      { type: "logout", at: T0 + 1, actor: "zz-officer" },
      {
        type: "sourceDispatched",
        at: T0 + 2,
        actor: "zz-trainee",
        credential: "zz-officer",
        correlationId: CID_A,
        partId: 0,
      },
      { type: "logout", at: T0 + 3, actor: "zz-trainee" },
      { type: "loginSucceeded", at: T0 + 4, actor: "zz-trainee" },
      {
        type: "sourceDispatched",
        at: T0 + 5,
        actor: "zz-trainee",
        correlationId: CID_B,
        partId: 0,
      },
    ]);
    const ids = async (f: Partial<Parameters<typeof readAuditPage>[1]>) =>
      (await readAuditPage(db, { ...WINDOW, ...f }, null, 50)).events.map((e) => e.id);
    expect(await ids({ user: "zz-officer" })).toEqual([asOwner, asActor]);
    expect(await ids({ user: "zz-trainee" })).toEqual([cidB, otherType, other, asOwner]);
    expect(await ids({ type: "loginSucceeded" })).toEqual([otherType]);
    expect(await ids({ type: "logout", user: "zz-trainee" })).toEqual([other]);
    expect(await ids({ correlationId: CID_A })).toEqual([asOwner]);
    expect(await ids({ correlationId: CID_B, user: "zz-officer" })).toEqual([]);
  });

  it("maps a row to the API shape, omitting null columns", async () => {
    const db = await fresh();
    const [plain, query] = await seed(db, [
      { type: "logout", at: T0 + 1, actor: "zz-u1" },
      {
        type: "sourceDispatched",
        at: T0 + 2,
        actor: "zz-u1",
        credential: "zz-owner",
        correlationId: CID_A,
        partId: 0,
      },
    ]);
    const page = await readAuditPage(db, WINDOW, null, 50);
    expect(page.events).toEqual([
      {
        id: query,
        type: "sourceDispatched",
        at: T0 + 2,
        correlationId: CID_A,
        partId: 0,
        actor: { id: "zz-u1", email: null, role: "user" },
        credentialUserId: "zz-owner",
        identitySource: "local",
        details: { sessionId: "0199a0b0-0000-7000-8000-0000000000e1" },
      },
      {
        id: plain,
        type: "logout",
        at: T0 + 1,
        actor: { id: "zz-u1", email: null, role: "user" },
        identitySource: "local",
        details: { sessionId: "0199a0b0-0000-7000-8000-0000000000e1" },
      },
    ]);
  });

  it("a host row carries its hostSubject and identitySource host", async () => {
    const db = await fresh();
    await seed(db, [{ type: "logout", at: T0 + 1, actor: "zz-u1", hostSubject: "zz-host-01" }]);
    const [row] = (await readAuditPage(db, WINDOW, null, 50)).events;
    expect(row).toMatchObject({ identitySource: "host", hostSubject: "zz-host-01" });
  });

  it("limit 2 pages through every row exactly once by nextCursor, null at the end", async () => {
    const db = await fresh();
    const seeded = await seed(
      db,
      [1, 2, 2, 2, 3, 4, 5].map((d) => ({ type: "logout", at: T0 + d, actor: "zz-u1" })),
    );
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const decoded = cursor === null ? null : decodeAuditCursor(cursor);
      if (cursor !== null) expect(decoded).not.toBeNull();
      const page = await readAuditPage(db, WINDOW, decoded, 2);
      expect(page.events.length).toBeLessThanOrEqual(2);
      seen.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(cursor).toBeNull();
    expect(pages).toBe(4);
    expect(seen).toEqual([...seeded].reverse());
  });

  it("a full last page answers a null nextCursor", async () => {
    const db = await fresh();
    await seed(
      db,
      [1, 2].map((d) => ({ type: "logout", at: T0 + d, actor: "zz-u1" })),
    );
    const page = await readAuditPage(db, WINDOW, null, 2);
    expect(page.events).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("a stored row the read schema refuses throws AuditRowReadError naming its id only", async () => {
    const db = await fresh();
    const [bad] = await seed(db, [{ type: "logout", at: T0 + 1, actor: "zz bad actor id" }]);
    const err = await readAuditPage(db, WINDOW, null, 50).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuditRowReadError);
    expect((err as AuditRowReadError).rowId).toBe(bad);
    expect(String((err as Error).message)).not.toContain("zz bad actor id");
  });
});
