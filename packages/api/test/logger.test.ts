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
});
