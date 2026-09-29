import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AeadError, open, seal } from "../../src/keys/aead";

const key = randomBytes(32);
const pt = Buffer.from("sample plaintext", "utf8");
const flip = (b: Buffer, i = 0) => {
  const c = Buffer.from(b);
  c[i] = (c[i] ?? 0) ^ 0x01;
  return c;
};

describe("SEC-006 shared AES-256-GCM helper", () => {
  it("seal then open round-trips with a 12-byte IV and 16-byte tag", () => {
    const s = seal(key, pt, "ctx|1");
    expect(s.iv.length).toBe(12);
    expect(s.tag.length).toBe(16);
    expect(s.ciphertext.equals(pt)).toBe(false);
    expect(open(key, s, "ctx|1").equals(pt)).toBe(true);
  });
  it("a flipped ciphertext byte fails closed", () => {
    const s = seal(key, pt, "ctx|1");
    expect(() => open(key, { ...s, ciphertext: flip(s.ciphertext) }, "ctx|1")).toThrow(AeadError);
  });
  it("a flipped tag byte fails closed", () => {
    const s = seal(key, pt, "ctx|1");
    expect(() => open(key, { ...s, tag: flip(s.tag) }, "ctx|1")).toThrow(AeadError);
  });
  it("a different AAD fails closed", () => {
    const s = seal(key, pt, "ctx|1");
    expect(() => open(key, s, "ctx|2")).toThrow(AeadError);
  });
  it("a 31-byte key throws AeadError on seal and open", () => {
    const short = randomBytes(31);
    expect(() => seal(short, pt, "ctx|1")).toThrow(AeadError);
    expect(() => open(short, seal(key, pt, "ctx|1"), "ctx|1")).toThrow(AeadError);
  });
  it("two seals of the same plaintext differ (fresh IV)", () => {
    const a = seal(key, pt, "ctx|1");
    const b = seal(key, pt, "ctx|1");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });
  it("the error message carries no AAD or plaintext", () => {
    const s = seal(key, pt, "secret-aad");
    let caught: unknown;
    try {
      open(key, s, "other-aad");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AeadError);
    expect((caught as Error).name).toBe("AeadError");
    expect((caught as Error).message).not.toMatch(/aad|sample plaintext/);
  });
});
