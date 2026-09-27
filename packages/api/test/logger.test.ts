// packages/api/test/logger.test.ts
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/log/logger";

function capture(o: { redactKeys?: string[]; secretValues?: string[] } = {}) {
  const lines: string[] = [];
  return { lines, log: createLogger({ sink: (l) => lines.push(l), ...o }) };
}

describe("SEC-006 logger redaction", () => {
  it("writes one JSON object per line with level, time and msg", () => {
    const { lines, log } = capture();
    log.info("started", { port: 3000 });
    const o = JSON.parse(lines[0] ?? "");
    expect(o).toMatchObject({ level: "info", msg: "started", port: 3000 });
    expect(typeof o.time).toBe("number");
  });
  it("redacts fixed keys and field keys at any depth", () => {
    const { lines, log } = capture({ redactKeys: ["plate"] });
    log.warn("x", {
      a: { b: [{ plate: "ZZ-0001", password: "pw-1", cookie: "ck-1", ok: 1 }] },
      values: { any: "vv-1" },
      Authorization: "Bearer t-1",
    });
    const out = lines[0] ?? "";
    for (const s of ["ZZ-0001", "pw-1", "ck-1", "t-1", "vv-1"]) expect(out).not.toContain(s);
    expect(out).toContain('"ok":1');
    expect(out).toContain("[redacted]");
  });
  it("scrubs literal secret values anywhere in the line", () => {
    const { lines, log } = capture({ secretValues: ["S3CRETS3CRETS3CRET"] });
    log.error("boom", { reason: "key S3CRETS3CRETS3CRET rejected" });
    expect(lines[0]).not.toContain("S3CRETS3CRETS3CRET");
  });
  it("serialises errors as name and message only", () => {
    const { lines, log } = capture();
    log.error("fail", { err: new TypeError("bad") });
    expect(JSON.parse(lines[0] ?? "").err).toEqual({ name: "TypeError", message: "bad" });
  });
  it("serialises a Date field as an ISO string instead of dropping it", () => {
    const { lines, log } = capture();
    const when = new Date("2026-01-02T03:04:05.000Z");
    log.info("tick", { when });
    expect(JSON.parse(lines[0] ?? "").when).toBe(when.toISOString());
  });
  it("redacts a Map field's redacted keys instead of dropping it", () => {
    const { lines, log } = capture();
    log.warn("x", {
      m: new Map<string, unknown>([
        ["password", "pw-2"],
        ["ok", 1],
      ]),
    });
    const o = JSON.parse(lines[0] ?? "");
    expect(o.m).toEqual({ password: "[redacted]", ok: 1 });
    expect(lines[0]).not.toContain("pw-2");
  });
  it("redacts objects inside a Set field instead of dropping it", () => {
    const { lines, log } = capture();
    log.warn("x", { s: new Set([{ secret: "sec-1" }, { ok: 2 }]) });
    const o = JSON.parse(lines[0] ?? "");
    expect(o.s).toEqual([{ secret: "[redacted]" }, { ok: 2 }]);
    expect(lines[0]).not.toContain("sec-1");
  });
});

describe("SEC-006 logger redaction: wave review fixes", () => {
  it("never emits the bytes of a Buffer under a non-redacted key (G-I1)", () => {
    const { lines, log } = capture();
    const key = Buffer.alloc(32, 7);
    log.info("x", { material: key });
    const o = JSON.parse(lines[0] ?? "");
    expect(o.material).toBe("[redacted]");
    expect(lines[0]).not.toMatch(/"0":7/);
  });
  it("never emits typed arrays, DataViews or ArrayBuffers (G-I1)", () => {
    const { lines, log } = capture();
    const ab = new Uint8Array([9, 8, 7, 6]).buffer;
    log.info("x", { a: new Uint8Array([9, 8]), b: new DataView(ab), c: ab });
    const o = JSON.parse(lines[0] ?? "");
    expect(o).toMatchObject({ a: "[redacted]", b: "[redacted]", c: "[redacted]" });
  });
  it("emits no key bytes when a Secrets-shaped object is logged (C-I1)", () => {
    const { lines, log } = capture();
    const credentialKey = Buffer.alloc(32, 11);
    const dataKey = Buffer.alloc(32, 13);
    log.error("loaded", {
      cfg: {
        dbEncryptionKey: "db-key-db-key-db-key-db-key-db-key",
        credentialKey,
        dataKey,
        betterAuthSecret: "auth-secret-auth-secret-auth-secret",
        seedPasswordSecret: null,
      },
    });
    const out = lines[0] ?? "";
    expect(out).not.toMatch(/"\d+":1[13]/);
    for (const b of [credentialKey, dataKey]) {
      expect(out).not.toContain(b.toString("base64"));
      expect(out).not.toContain(b.toString("hex"));
    }
    expect(out).not.toContain("db-key-db-key");
    expect(out).not.toContain("auth-secret-auth");
  });
  it("scrubs a secret value that JSON escapes (G-I2, C-M1)", () => {
    const secret = 'ab"cdefgh\\ij\tkl';
    const { lines, log } = capture({ secretValues: [secret] });
    log.error(`boom ${secret}`, { reason: `key ${secret} rejected`, list: [secret] });
    const out = lines[0] ?? "";
    expect(out).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(out).not.toContain("cdefgh");
    expect(JSON.parse(out).reason).toBe("key [redacted] rejected");
  });
  it("keeps redacting one-shot iterator keys in child loggers (G-I3)", () => {
    const lines: string[] = [];
    const keys = new Map([["plate", 1]]).keys();
    const log = createLogger({ sink: (l) => lines.push(l), redactKeys: keys });
    log.info("parent", { plate: "ZZ-1" });
    log.child({ req: 1 }).info("child", { plate: "ZZ-2" });
    log.child({ req: 2 }).child({ n: 3 }).info("grandchild", { plate: "ZZ-3" });
    expect(lines.join("\n")).not.toMatch(/ZZ-\d/);
  });
  it("does not let a field overwrite level, time or msg (G-M1)", () => {
    const { lines, log } = capture();
    log.error("real", { level: "debug", time: 0, msg: "forged" });
    const o = JSON.parse(lines[0] ?? "");
    expect(o.level).toBe("error");
    expect(o.msg).toBe("real");
    expect(o.time).not.toBe(0);
  });
  it("prints an object referenced twice without a cycle both times (G-M2)", () => {
    const { lines, log } = capture();
    const shared = { n: 1 };
    const cyclic: Record<string, unknown> = { n: 2 };
    cyclic.self = cyclic;
    log.info("x", { a: shared, b: shared, list: [shared, shared], cyclic });
    const o = JSON.parse(lines[0] ?? "");
    expect(o.a).toEqual({ n: 1 });
    expect(o.b).toEqual({ n: 1 });
    expect(o.list).toEqual([{ n: 1 }, { n: 1 }]);
    expect(o.cyclic).toEqual({ n: 2, self: "[circular]" });
  });
  it("logs a BigInt as a string and survives a throwing getter (G-M3)", () => {
    const { lines, log } = capture({ secretValues: ["S3CRETS3CRET"] });
    log.info("big", { n: 12345678901234567890n });
    expect(JSON.parse(lines[0] ?? "").n).toBe("12345678901234567890");
    const bad = {
      get boom(): string {
        throw new Error("getter failed");
      },
    };
    expect(() => log.warn("msg S3CRETS3CRET", { bad })).not.toThrow();
    const o = JSON.parse(lines[1] ?? "");
    expect(o).toMatchObject({ level: "warn", msg: "msg [redacted]" });
    expect(o.logError).toBeDefined();
    expect(lines[1]).not.toContain("S3CRETS3CRET");
  });
  it("redacts header and token-style key variants (G-M4, C-M1)", () => {
    const { lines, log } = capture();
    const f: Record<string, string> = {
      "Set-Cookie": "v-01",
      "Proxy-Authorization": "v-02",
      "X-Api-Key": "v-03",
      token: "v-04",
      sessionToken: "v-05",
      apiKey: "v-06",
      betterAuthSecret: "v-07",
      encryptionKey: "v-08",
      dbEncryptionKey: "v-09",
      access_token: "v-10",
      clientSecret: "v-11",
      newPassword: "v-12",
    };
    log.info("x", { ...f, ok: "v-ok" });
    const out = lines[0] ?? "";
    for (const v of Object.values(f)) expect(out).not.toContain(v);
    expect(out).toContain("v-ok");
  });
});
