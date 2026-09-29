import { resolve } from "node:path";
import type { Role } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { withTransaction } from "../../src/db/tx";
import { type AccessRoute, authorizeQueryAccess, type QueryAction } from "../../src/queries/policy";
import type { Principal } from "../../src/seams";
import { openTempDatabase } from "../helpers/db";

const CID = "01890a5d-ac96-774b-bcce-b302099a8057";
const UNKNOWN_CID = "01890a5d-ac96-774b-bcce-b302099a8058";
const USER_A = "0199a0b0-0000-7000-8000-00000000000a";
const USER_B = "0199a0b0-0000-7000-8000-00000000000b";
const ADMIN = "0199a0b0-0000-7000-8000-0000000000ad";
const OFFICER = "0199a0b0-0000-7000-8000-0000000000cf";
const RESULT_OWN = "0199a0b0-0000-7000-8000-0000000000e1";
const RESULT_DELEGATED = "0199a0b0-0000-7000-8000-0000000000e2";

function principal(userId: string, role: Role): Principal {
  return {
    userId,
    email: null,
    role,
    sessionId: "0199a0b0-0000-7000-8000-0000000000f1",
    identitySource: "local",
    authenticatedAt: 1,
  };
}

const A = principal(USER_A, "user");
const B = principal(USER_B, "user");
const ADMIN_P = principal(ADMIN, "admin");
const O = principal(OFFICER, "trainingOfficer");

async function seeded(): Promise<Db> {
  const db = await openTempDatabase();
  await runMigrations(db, resolve(import.meta.dirname, "../../drizzle"));
  // Plain INSERTs: 0005 refuses REPLACE on query_request and source_result.
  await db.$client.execute({
    sql: `INSERT INTO query_request (correlation_id, part_id, user_id, origin, query_type, type_values,
      plate_only, selected_source_ids, dropped_source_ids, config_hash, idempotency_key, submitted_at)
      VALUES (?, 0, ?, 'primary', 'vehicle', '{}', 0, '["s1","s2"]', '[]', 'h1', 'idem-1', 1)`,
    args: [CID, USER_A],
  });
  for (const [resultId, sourceId, credentialUserId] of [
    [RESULT_OWN, "s1", null],
    [RESULT_DELEGATED, "s2", OFFICER],
  ] as const) {
    await db.$client.execute({
      sql: `INSERT INTO source_result (result_id, correlation_id, part_id, source_id, user_id, status,
        credential_user_id, adapter_kind, created_at) VALUES (?, ?, 0, ?, ?, 'pending', ?, 'mock', 1)`,
      args: [resultId, CID, sourceId, USER_A, credentialUserId],
    });
  }
  return db;
}

type Case = [string, Principal, string, QueryAction, AccessRoute, unknown];
const NO = { ok: false };
const cases: Case[] = [
  ["owner reads on own", A, CID, "read", "own", { ok: true, basis: "owner", resultIds: "all" }],
  ["owner hides on own", A, CID, "hide", "own", { ok: true, basis: "owner", resultIds: "all" }],
  ["another user reads on own", B, CID, "read", "own", NO],
  ["another user hides on own", B, CID, "hide", "own", NO],
  [
    "admin reads on admin",
    ADMIN_P,
    CID,
    "read",
    "admin",
    { ok: true, basis: "admin", resultIds: "all" },
  ],
  ["admin hides on admin", ADMIN_P, CID, "hide", "admin", NO],
  ["admin reads another's request on own", ADMIN_P, CID, "read", "own", NO],
  ["non-admin owner reads on admin", A, CID, "read", "admin", NO],
  ["officer reads on admin", O, CID, "read", "admin", NO],
  [
    "officer reads on delegated",
    O,
    CID,
    "read",
    "delegated",
    { ok: true, basis: "credentialOwner", resultIds: [RESULT_DELEGATED] },
  ],
  ["officer hides on delegated", O, CID, "hide", "delegated", NO],
  ["officer reads on own", O, CID, "read", "own", NO],
  ["owner without a credential row reads on delegated", A, CID, "read", "delegated", NO],
  ["admin reads on delegated", ADMIN_P, CID, "read", "delegated", NO],
  ["malformed id on own", A, "x", "read", "own", NO],
  ["malformed id on admin", ADMIN_P, "x", "read", "admin", NO],
  ["malformed id on delegated", O, "x", "read", "delegated", NO],
  ["uppercase id is not canonical", A, CID.toUpperCase(), "read", "own", NO],
  ["unknown id on own", A, UNKNOWN_CID, "read", "own", NO],
  ["unknown id on admin", ADMIN_P, UNKNOWN_CID, "read", "admin", NO],
  ["unknown id on delegated", O, UNKNOWN_CID, "read", "delegated", NO],
];

describe("SEC-014 one access policy (spec 5.2)", () => {
  it.each(cases)("%s", async (_name, p, cid, action, route, expected) => {
    const db = await seeded();
    expect(await authorizeQueryAccess(db, p, cid, action, route)).toEqual(expected);
  });

  it("an unrecognized route is refused (FR-062)", async () => {
    const db = await seeded();
    const route = "public" as unknown as AccessRoute;
    expect(await authorizeQueryAccess(db, A, CID, "read", route)).toEqual(NO);
  });

  it("works inside a transaction and writes nothing (FR-063, SEC-011)", async () => {
    const db = await seeded();
    const count = async () =>
      (
        await db.$client.execute(
          `SELECT (SELECT count(*) FROM audit_event) + (SELECT count(*) FROM query_request)
            + (SELECT count(*) FROM source_result) AS n`,
        )
      ).rows[0]?.n;
    const before = await count();
    const access = await withTransaction(db, (tx) =>
      authorizeQueryAccess(tx, O, CID, "read", "delegated"),
    );
    expect(access).toEqual({ ok: true, basis: "credentialOwner", resultIds: [RESULT_DELEGATED] });
    expect(await count()).toBe(before);
  });
});
