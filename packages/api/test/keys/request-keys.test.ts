import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AeadError, open, seal } from "../../src/keys/aead";
import { CURRENT_KEY_VERSION } from "../../src/keys/canary";
import {
  createRequestKeys,
  openPartValues,
  PartValuesError,
  payloadAad,
  REQUEST_KEY_SCOPES,
  REQUEST_KEY_VERSION,
  RequestKeyError,
  type RequestKeyRow,
  requestKeyAad,
  sealPartValues,
  unwrapRequestKey,
  valuesAad,
} from "../../src/keys/request-keys";

const dataKey = randomBytes(32);
const cid = "01890a5d-ac96-774b-bcce-b302099a8057";
const other = "01890a5d-ac96-774b-bcce-b302099a8058";

function twoRows(rows: RequestKeyRow[]): [RequestKeyRow, RequestKeyRow] {
  const [v, p] = rows;
  if (!v || !p) throw new Error("expected two request_key rows");
  return [v, p];
}

describe("SEC-006 per-request DEKs wrapped under DATA_KEY (spec 5.5)", () => {
  it("creates one wrapped DEK per scope, distinct and unwrappable", () => {
    const { rows, deks } = createRequestKeys(dataKey, cid, 1_790_000_000_000);
    expect(rows.map((r) => r.scope)).toEqual([...REQUEST_KEY_SCOPES]);
    expect(deks.values.equals(deks.payload)).toBe(false);
    const [valuesRow, payloadRow] = twoRows(rows);
    expect(unwrapRequestKey(dataKey, valuesRow).equals(deks.values)).toBe(true);
    expect(unwrapRequestKey(dataKey, payloadRow).equals(deks.payload)).toBe(true);
    expect(
      rows.every(
        (r) => r.wrappedDek.length === 32 && r.iv.length === 12 && r.authTag.length === 16,
      ),
    ).toBe(true);
    expect(rows.some((r) => r.wrappedDek.equals(deks.values))).toBe(false);
    expect(
      rows.every(
        (r) => r.correlationId === cid && r.keyVersion === 1 && r.createdAt === 1_790_000_000_000,
      ),
    ).toBe(true);
  });
  it("a wrong DATA_KEY or a row moved to another request fails closed", () => {
    const [row] = twoRows(createRequestKeys(dataKey, cid, 0).rows);
    expect(() => unwrapRequestKey(randomBytes(32), row)).toThrow(AeadError);
    expect(() => unwrapRequestKey(dataKey, { ...row, correlationId: other })).toThrow(AeadError);
    expect(() => unwrapRequestKey(dataKey, { ...row, scope: "payload" })).toThrow(AeadError);
    expect(() => unwrapRequestKey(dataKey, { ...row, keyVersion: 2 })).toThrow(AeadError);
  });
  it("part values round-trip and are bound to their correlation id and part", () => {
    const { deks } = createRequestKeys(dataKey, cid, 0);
    const v = { plate: "ZZ-0001", state: "TX", year: 2026 };
    const s = sealPartValues(deks.values, cid, 0, v);
    expect(openPartValues(deks.values, cid, 0, s)).toEqual(v);
    expect(s.ciphertext.includes(Buffer.from("ZZ-0001"))).toBe(false);
    expect(() => openPartValues(deks.values, cid, 1, s)).toThrow(AeadError);
    expect(() => openPartValues(deks.payload, cid, 0, s)).toThrow(AeadError);
  });
  it("serialises values with sorted keys, so key order does not change the bytes", () => {
    const { deks } = createRequestKeys(dataKey, cid, 0);
    const a = sealPartValues(deks.values, cid, 0, { b: "ZZ-0002", a: true });
    const b = sealPartValues(deks.values, cid, 0, { a: true, b: "ZZ-0002" });
    const expected = '{"a":true,"b":"ZZ-0002"}';
    for (const s of [a, b]) {
      expect(open(deks.values, s, valuesAad(cid, 0)).toString("utf8")).toBe(expected);
    }
    const c = sealPartValues(deks.values, cid, 0, { zeta: 1, alpha: "ZZ-0003", mid: false });
    expect(open(deks.values, c, valuesAad(cid, 0)).toString("utf8")).toBe(
      '{"alpha":"ZZ-0003","mid":false,"zeta":1}',
    );
  });
  it("an AeadError message carries no key, value or AAD", () => {
    const { deks } = createRequestKeys(dataKey, cid, 0);
    const s = sealPartValues(deks.values, cid, 0, { plate: "ZZ-0001" });
    let caught: unknown;
    try {
      openPartValues(deks.values, other, 0, s);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AeadError);
    expect(String((caught as Error).message)).not.toMatch(/ZZ-0001|query_request|[0-9a-f]{32}/);
  });
  it("a malformed plaintext fails with a fixed message that quotes none of it (spec 5.9)", () => {
    const { deks } = createRequestKeys(dataKey, cid, 0);
    const s = seal(deks.values, Buffer.from('{"plate":"ZZ-0003"', "utf8"), valuesAad(cid, 0));
    let caught: unknown;
    try {
      openPartValues(deks.values, cid, 0, s);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PartValuesError);
    expect(String((caught as Error).message)).not.toMatch(/ZZ-0003|plate/);
    expect((caught as Error).cause).toBeUndefined();
  });
  it("AAD strings follow the spec 5.5 table|id|column formats", () => {
    expect(requestKeyAad(cid, "values", 1)).toBe(`request_key|${cid}|values|1`);
    expect(valuesAad(cid, 2)).toBe(`query_request|${cid}|2|values`);
    expect(payloadAad(other)).toBe(`source_result|${other}|payload`);
  });
});

/** Catches the RequestKeyError and checks its message quotes no id, value or key bytes. */
function requestKeyErrorOf(fn: () => unknown): RequestKeyError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RequestKeyError);
  const err = caught as RequestKeyError;
  expect(err.message).not.toMatch(/ZZ-|\||[0-9a-f]{8}-|NaN|Infinity/);
  expect(err.cause).toBeUndefined();
  return err;
}

describe("SEC-006 request-keys hardening (#311 Task 11)", () => {
  it("an unwrapped DEK that is not 32 bytes fails with a fixed message", () => {
    const short = seal(dataKey, randomBytes(16), requestKeyAad(cid, "values", REQUEST_KEY_VERSION));
    const row: RequestKeyRow = {
      correlationId: cid,
      scope: "values",
      wrappedDek: short.ciphertext,
      iv: short.iv,
      authTag: short.tag,
      keyVersion: REQUEST_KEY_VERSION,
      createdAt: 0,
    };
    expect(requestKeyErrorOf(() => unwrapRequestKey(dataKey, row)).reason).toBe("dekLength");
  });
  it("AAD ids must be UUIDv7, so the | separator cannot appear in them", () => {
    for (const bad of ["not-a-uuid", `${cid}|values`, cid.toUpperCase(), "", `x|${cid}`]) {
      expect(requestKeyErrorOf(() => requestKeyAad(bad, "values", 1)).reason).toBe("id");
      expect(requestKeyErrorOf(() => valuesAad(bad, 0)).reason).toBe("id");
      expect(requestKeyErrorOf(() => payloadAad(bad)).reason).toBe("id");
      expect(requestKeyErrorOf(() => createRequestKeys(dataKey, bad, 0)).reason).toBe("id");
    }
  });
  it("scope and key version are checked at run time", () => {
    const scope = "values|x" as unknown as "values";
    expect(requestKeyErrorOf(() => requestKeyAad(cid, scope, 1)).reason).toBe("scope");
    for (const v of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(requestKeyErrorOf(() => requestKeyAad(cid, "values", v)).reason).toBe("keyVersion");
    }
  });
  it("partId must be a non-negative integer, and a bad one fails at seal time", () => {
    const { deks } = createRequestKeys(dataKey, cid, 0);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(requestKeyErrorOf(() => valuesAad(cid, bad)).reason).toBe("partId");
      expect(
        requestKeyErrorOf(() => sealPartValues(deks.values, cid, bad, { plate: "ZZ-0001" })).reason,
      ).toBe("partId");
    }
    expect(valuesAad(cid, 0)).toBe(`query_request|${cid}|0|values`);
  });
  it("refuses NaN and Infinity instead of sealing them as null", () => {
    const { deks } = createRequestKeys(dataKey, cid, 0);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        requestKeyErrorOf(() =>
          sealPartValues(deks.values, cid, 0, { plate: "ZZ-0001", year: bad }),
        ).reason,
      ).toBe("nonFinite");
    }
    const ok = sealPartValues(deks.values, cid, 0, { year: 0, n: -1.5 });
    expect(openPartValues(deks.values, cid, 0, ok)).toEqual({ year: 0, n: -1.5 });
  });
  it("REQUEST_KEY_VERSION is the DATA_KEY canary version, so rotation can tell rows apart", () => {
    expect(REQUEST_KEY_VERSION).toBe(CURRENT_KEY_VERSION);
    const { rows } = createRequestKeys(dataKey, cid, 0);
    expect(rows.every((r) => r.keyVersion === CURRENT_KEY_VERSION)).toBe(true);
  });
  it("rows and part values sealed by the pre-#311 code still open (fixed vector)", () => {
    const key = Buffer.alloc(32, 0x11);
    const dek = Buffer.alloc(32, 0x22);
    const iv = Buffer.alloc(12, 0x33);
    const legacy = (k: Buffer, pt: Buffer, aad: string) => {
      const c = createCipheriv("aes-256-gcm", k, iv).setAAD(Buffer.from(aad, "utf8"));
      const ciphertext = Buffer.concat([c.update(pt), c.final()]);
      return { ciphertext, iv, tag: c.getAuthTag() };
    };
    const w = legacy(key, dek, `request_key|${cid}|values|1`);
    const row: RequestKeyRow = {
      correlationId: cid,
      scope: "values",
      wrappedDek: w.ciphertext,
      iv: w.iv,
      authTag: w.tag,
      keyVersion: 1,
      createdAt: 0,
    };
    expect(unwrapRequestKey(key, row).equals(dek)).toBe(true);
    const pv = legacy(
      dek,
      Buffer.from('{"plate":"ZZ-0001","state":"TX","year":2026}', "utf8"),
      `query_request|${cid}|3|values`,
    );
    expect(openPartValues(dek, cid, 3, pv)).toEqual({ plate: "ZZ-0001", state: "TX", year: 2026 });
  });
});
