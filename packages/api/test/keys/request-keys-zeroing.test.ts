import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Sealed, seal } from "../../src/keys/aead";
import * as rk from "../../src/keys/request-keys";

// A pass-through spy on the AEAD: it keeps a reference to each plaintext handed to seal and
// each buffer open returns, so the tests can check request-keys zeroes the ones it owns.
const seen = vi.hoisted(() => ({
  sealed: [] as Buffer[],
  opened: [] as Buffer[],
  made: [] as Buffer[],
}));
// And on randomBytes: keeps each 32-byte buffer made (the DEKs), so a failed create can be checked.
vi.mock("node:crypto", async (importOriginal) => {
  const m = await importOriginal<typeof import("node:crypto")>();
  return {
    ...m,
    randomBytes: (n: number): Buffer => {
      const out = m.randomBytes(n);
      if (n === 32) seen.made.push(out);
      return out;
    },
  };
});
vi.mock("../../src/keys/aead", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/keys/aead")>();
  return {
    ...m,
    seal: (key: Buffer, plaintext: Buffer, aad: string): Sealed => {
      seen.sealed.push(plaintext);
      return m.seal(key, plaintext, aad);
    },
    open: (key: Buffer, s: Sealed, aad: string): Buffer => {
      const out = m.open(key, s, aad);
      seen.opened.push(out);
      return out;
    },
  };
});

const dataKey = randomBytes(32);
const cid = "01890a5d-ac96-774b-bcce-b302099a8057";
const zeroed = (b: Buffer | undefined) =>
  b !== undefined && b.length > 0 && b.every((x) => x === 0);

beforeEach(() => {
  seen.sealed.length = 0;
  seen.opened.length = 0;
  seen.made.length = 0;
});

describe("SEC-006 request-keys zeroes the buffers it owns (#311 Task 11)", () => {
  it("sealPartValues zeroes its plaintext JSON buffer", () => {
    const { deks } = rk.createRequestKeys(dataKey, cid, 0);
    seen.sealed.length = 0;
    rk.sealPartValues(deks.values, cid, 0, { plate: "ZZ-0001" });
    expect(seen.sealed).toHaveLength(1);
    expect(zeroed(seen.sealed[0])).toBe(true);
  });
  it("openPartValues zeroes the decrypted plaintext, on success and on a parse failure", () => {
    const { deks } = rk.createRequestKeys(dataKey, cid, 0);
    const s = rk.sealPartValues(deks.values, cid, 0, { plate: "ZZ-0001" });
    expect(rk.openPartValues(deks.values, cid, 0, s)).toEqual({ plate: "ZZ-0001" });
    expect(zeroed(seen.opened[0])).toBe(true);
    const bad = seal(deks.values, Buffer.from('{"plate":"ZZ-0003"', "utf8"), rk.valuesAad(cid, 0));
    expect(() => rk.openPartValues(deks.values, cid, 0, bad)).toThrow(rk.PartValuesError);
    expect(zeroed(seen.opened[1])).toBe(true);
  });
  it("unwrapRequestKey zeroes a wrong-length DEK before it throws and returns a good one intact", () => {
    const short = seal(dataKey, randomBytes(16), rk.requestKeyAad(cid, "values", 1));
    const row: rk.RequestKeyRow = {
      correlationId: cid,
      scope: "values",
      wrappedDek: short.ciphertext,
      iv: short.iv,
      authTag: short.tag,
      keyVersion: 1,
      createdAt: 0,
    };
    seen.opened.length = 0;
    expect(() => rk.unwrapRequestKey(dataKey, row)).toThrow(rk.RequestKeyError);
    expect(zeroed(seen.opened[0])).toBe(true);
    const [good] = rk.createRequestKeys(dataKey, cid, 0).rows;
    if (!good) throw new Error("expected a request_key row");
    expect(zeroed(rk.unwrapRequestKey(dataKey, good))).toBe(false);
  });
  it("createRequestKeys zeroes both DEKs when wrapping fails", () => {
    expect(() => rk.createRequestKeys(randomBytes(16), cid, 0)).toThrow();
    expect(seen.made).toHaveLength(2);
    expect(seen.made.every(zeroed)).toBe(true);
  });
});
