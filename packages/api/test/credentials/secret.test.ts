import { Console } from "node:console";
import { Writable } from "node:stream";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { Secret } from "../../src/credentials/secret";

// Spec 5.7, 10.3 (SEC-006): a Secret prints as "[secret]" through every path that turns a value
// into text; only reveal() hands the value over, at the adapter's wire boundary.
const VALUE = "synthetic-pass-123";

function captureConsole(fn: (c: Console) => void): string {
  let out = "";
  const sink = new Writable({
    write(chunk, _enc, done) {
      out += String(chunk);
      done();
    },
  });
  fn(new Console({ stdout: sink, stderr: sink }));
  return out;
}

describe("Secret", () => {
  const secret = new Secret(VALUE);

  it("reveal() returns the wrapped value", () => {
    expect(secret.reveal()).toBe(VALUE);
    const obj = { username: "u1", secret: VALUE };
    expect(new Secret(obj).reveal()).toBe(obj);
  });

  it("redacts under JSON.stringify, alone and nested", () => {
    expect(JSON.stringify(secret)).toBe('"[secret]"');
    expect(JSON.stringify({ creds: secret })).toBe('{"creds":"[secret]"}');
  });

  it("redacts under String(), template strings and concatenation", () => {
    expect(String(secret)).toBe("[secret]");
    expect(`${secret}`).toBe("[secret]");
    expect(`x${secret}`).toBe("x[secret]");
    expect(secret.toString()).toBe("[secret]");
  });

  it("redacts under util.inspect, nested and with hidden fields shown", () => {
    expect(inspect(secret)).toBe("[secret]");
    expect(inspect({ creds: secret }, { showHidden: true, depth: 10 })).not.toContain(VALUE);
  });

  it("redacts under console capture (log, error, dir, %s, %o, %O, %j)", () => {
    const out = captureConsole((c) => {
      c.log(secret);
      c.error({ creds: secret });
      c.dir(secret, { showHidden: true });
      c.log("%s %o %O %j", secret, secret, secret, secret);
    });
    expect(out).not.toContain(VALUE);
    expect(out).toContain("[secret]");
  });

  it("exposes no own property carrying the value", () => {
    expect(Object.keys(secret)).toEqual([]);
    expect(Object.getOwnPropertyNames(secret)).toEqual([]);
    expect({ ...secret }).toEqual({});
  });
});
