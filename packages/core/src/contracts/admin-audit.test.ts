import { describe, expect, it } from "vitest";
import {
  AdminAuditExportQuerySchema,
  AdminAuditPageSchema,
  AdminAuditQuerySchema,
  AuditExportLineSchema,
  AuditReadRowSchema,
  MAX_AUDIT_WINDOW_MS,
} from "./admin-audit";

const DAY = 86_400_000;
const CID = "01890000-0000-7000-8000-000000000001";
const FROM = 1_700_000_000_000;
const win = (span: number) => ({ from: String(FROM), to: String(FROM + span) });

describe("SEC-012 admin audit filters (spec 5.1)", () => {
  it("requires a window of at most 31 days", () => {
    expect(MAX_AUDIT_WINDOW_MS).toBe(31 * DAY);
    expect(AdminAuditQuerySchema.safeParse(win(DAY)).success).toBe(true);
    expect(AdminAuditQuerySchema.safeParse(win(31 * DAY)).success).toBe(true);
    expect(AdminAuditQuerySchema.safeParse(win(31 * DAY + 1)).success).toBe(false);
    expect(AdminAuditQuerySchema.safeParse(win(-DAY)).success).toBe(false);
    expect(AdminAuditQuerySchema.safeParse({ from: String(FROM) }).success).toBe(false);
    expect(AdminAuditQuerySchema.safeParse({}).success).toBe(false);
  });
  it("filters by user, correlation id and type; limit at most 200", () => {
    const parsed = AdminAuditQuerySchema.parse({
      ...win(DAY),
      user: "u1",
      correlationId: CID,
      type: "submitted",
      cursor: "42",
      limit: "200",
    });
    expect(parsed).toMatchObject({ user: "u1", correlationId: CID, type: "submitted", limit: 200 });
    expect(AdminAuditQuerySchema.safeParse({ ...win(DAY), limit: "201" }).success).toBe(false);
    expect(AdminAuditQuerySchema.safeParse({ ...win(DAY), correlationId: "x" }).success).toBe(
      false,
    );
    expect(AdminAuditQuerySchema.safeParse({ ...win(DAY), extra: "1" }).success).toBe(false);
  });
  it("export takes the same filters without paging", () => {
    expect(AdminAuditExportQuerySchema.safeParse(win(DAY)).success).toBe(true);
    expect(AdminAuditExportQuerySchema.safeParse({ ...win(DAY), limit: "5" }).success).toBe(false);
    expect(AdminAuditExportQuerySchema.safeParse(win(32 * DAY)).success).toBe(false);
  });
});

describe("SEC-012 tolerant audit read schema", () => {
  const old = {
    id: 7,
    type: "submitted",
    at: 1000,
    correlationId: CID,
    partId: 0,
    actor: { id: "u1", email: "user@example.test", role: "user" },
    identitySource: "local",
    details: { queryType: "VEH", sourceIds: ["stateSource"] },
  };
  it("parses a row written before later fields existed (they stay absent)", () => {
    const row = AuditReadRowSchema.parse(old);
    expect(row).toEqual(old);
    expect("hostSubject" in row).toBe(false);
    expect("credentialUserId" in row).toBe(false);
  });
  it("accepts an event type added later and strips unknown keys", () => {
    const row = AuditReadRowSchema.parse({ ...old, type: "adminViewed", newColumn: 1 });
    expect(row.type).toBe("adminViewed");
    expect("newColumn" in row).toBe(false);
  });
  it("still rejects a row with no actor", () => {
    const { actor: _a, ...noActor } = old;
    expect(AuditReadRowSchema.safeParse(noActor).success).toBe(false);
  });
  it("page and export line carry rows through it", () => {
    expect(AdminAuditPageSchema.parse({ events: [old], nextCursor: null }).events).toEqual([old]);
    expect(AuditExportLineSchema.parse(old)).toEqual(old);
    const tooMany = { events: Array(201).fill(old), nextCursor: null };
    expect(AdminAuditPageSchema.safeParse(tooMany).success).toBe(false);
  });
});
