import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AeadError, seal } from "../../src/keys/aead";
import {
  createRequestKeys,
  openPartValues,
  PartValuesError,
  payloadAad,
  REQUEST_KEY_SCOPES,
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
    expect(a.ciphertext.length).toBe(b.ciphertext.length);
    expect(Object.keys(openPartValues(deks.values, cid, 0, a))).toEqual(["a", "b"]);
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
