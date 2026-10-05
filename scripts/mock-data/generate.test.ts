import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFixturePolicy, vinCheckDigitValid } from "@querymodule/core/config";
import { type MockFile, MockFileSchema } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { address, dob, person, plate, vehicleRecord, vin, warrantRecord } from "./builders";
import { checkMockFiles, generate, main } from "./generate";

// Frozen from the hand-written default.json and example-ok.json as shipped at M1 (be75721):
// [source, queryType, when (JSON), behavior or respond status].
type Row = [string, string, string, string];
const DEFAULT_ROWS: Row[] = [
  ["stateSource", "VEH", '{"plate":"ZZ-0001"}', "STOLEN"],
  ["stateSource", "VEH", '{"plate":"ABC123"}', "NO RECORD"],
  ["stateSource", "VEH", '{"plate":"FAIL1"}', "error"],
  ["stateSource", "PRO", '{"serial":"ZZSTOLEN1"}', "STOLEN"],
  ["nationalSource", "VEH", '{"plate":"ZZ-0001"}', "STOLEN"],
  ["nationalSource", "VEH", '{"plate":"TIMEOUT"}', "timeout"],
  ["nationalSource", "PRO", '{"serial":"ZZSTOLEN1"}', "STOLEN"],
  ["nationalSource", "WNT", '{"last":"WANTED"}', "WANTED"],
  ["nationalSource", "WNT", '{"last":"MISSING"}', "MISSING PERSON"],
];
const EXAMPLE_OK_ROWS: Row[] = DEFAULT_ROWS.filter(
  ([, q, when]) => q !== "PRO" && !when.includes("MISSING"),
);
const STATE_TYPES = ["VEH", "PER", "PRO", "DL"];
const NATIONAL_TYPES = ["VEH", "PER", "PRO", "WNT", "DL"];

function rowsOf(file: MockFile): Row[] {
  const rows: Row[] = [];
  for (const [id, src] of Object.entries(file.sources))
    for (const r of src.responses)
      for (const s of r.scenarios)
        rows.push([
          id,
          r.queryType,
          JSON.stringify(s.when),
          s.behavior ?? String(s.respond?.status),
        ]);
  return rows;
}
const sortRows = (rows: Row[]) => [...rows].sort((a, b) => a.join("|").localeCompare(b.join("|")));

describe("generate (FR-043, FR-044; spec 5.4)", () => {
  it("default parses, passes the fixture policy, and is byte-stable", () => {
    const text = generate("default");
    const file = MockFileSchema.parse(JSON.parse(text));
    expect(checkFixturePolicy(file)).toEqual([]);
    expect(generate("default")).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("default keeps every scenario, source, query type and latency of M1", () => {
    const file = MockFileSchema.parse(JSON.parse(generate("default")));
    expect(file.siteId).toBe("default");
    expect(sortRows(rowsOf(file))).toEqual(sortRows(DEFAULT_ROWS));
    expect(file.sources.stateSource?.latencyMs).toEqual([50, 400]);
    expect(file.sources.nationalSource?.latencyMs).toEqual([100, 800]);
    expect(file.sources.stateSource?.responses.map((r) => r.queryType)).toEqual(STATE_TYPES);
    expect(file.sources.nationalSource?.responses.map((r) => r.queryType)).toEqual(NATIONAL_TYPES);
    expect(file.sources.nationalSource?.responses[3]?.default).toEqual({
      status: "NO WANTS OR WARRANTS",
    });
  });

  it("example-ok covers every mock source of the resolved site and keeps its M1 scenarios", () => {
    const site: { sources: { id: string; kind: string }[] } = JSON.parse(
      readFileSync(new URL("../../packages/config/sites/default.json", import.meta.url), "utf8"),
    );
    const mockIds = site.sources.filter((s) => s.kind === "mock").map((s) => s.id);
    const text = generate("example-ok");
    const file = MockFileSchema.parse(JSON.parse(text));
    expect(file.siteId).toBe("example-ok");
    expect(Object.keys(file.sources).sort()).toEqual([...mockIds].sort());
    expect(checkFixturePolicy(file)).toEqual([]);
    expect(sortRows(rowsOf(file))).toEqual(sortRows(EXAMPLE_OK_ROWS));
  });

  it("an unknown site id is a fixed-text error", () => {
    expect(() => generate("nope")).toThrow("mock-data: unknown site id");
  });
});

describe("builders", () => {
  it("vin(n) fails the ISO 3779 check digit and is 17 charset-valid chars, n 0..999", () => {
    for (let n = 0; n <= 999; n++) {
      const v = vin(n);
      expect(v).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/);
      expect(vinCheckDigitValid(v)).toBe(false);
    }
  });

  it("plate, dob, address and person are fixture-policy shaped", () => {
    for (let n = 0; n <= 9999; n += 37) expect(plate(n)).toMatch(/^ZZ-\d{4}$/);
    expect(plate(1)).toBe("ZZ-0001");
    expect(dob(1)).toBe("1901-01-01");
    expect(dob(32)).toBe("1901-02-01");
    expect(dob(365)).toBe("1901-12-31");
    expect(() => dob(0)).toThrow();
    expect(() => dob(366)).toThrow();
    expect(address(7)).toBe("7 Example Ave");
    const p = person(1);
    expect(p).toEqual({ last: "TESTERSON", first: "SAMPLE", dob: "1901-01-01" });
  });

  it("record builders pass the fixture policy", () => {
    const mk = (payload: Record<string, unknown>): MockFile => ({
      siteId: "x",
      sources: {
        s: {
          latencyMs: [1, 2],
          responses: [{ queryType: "VEH", default: payload, scenarios: [] }],
        },
      },
    });
    for (const status of ["STOLEN", "NO RECORD"] as const) {
      expect(checkFixturePolicy(mk(vehicleRecord({ plate: plate(1), status, n: 1 })))).toEqual([]);
    }
    expect(checkFixturePolicy(mk(warrantRecord({ n: 1 })))).toEqual([]);
  });
});

describe("--check", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "mock-data-"));
    dirs.push(d);
    return d;
  };

  it("passes on freshly generated files", () => {
    const d = tmp();
    for (const id of ["default", "example-ok"]) writeFileSync(join(d, `${id}.json`), generate(id));
    expect(checkMockFiles(d)).toEqual([]);
  });

  it("names each file that differs or is missing", () => {
    const d = tmp();
    writeFileSync(join(d, "default.json"), `${generate("default")} `);
    expect(checkMockFiles(d)).toEqual(["default.json", "example-ok.json"]);
  });

  it("the committed files are up to date", () => {
    expect(checkMockFiles(new URL("../../packages/config/mock/", import.meta.url))).toEqual([]);
  });
});

describe("main", () => {
  it("--check exits 0 on the committed files; bad arguments exit 2 with fixed text", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--check"])).toBe(0);
      expect(main([])).toBe(2);
      expect(main(["--nope"])).toBe(2);
      expect(main(["nope"])).toBe(2);
      expect(err.mock.calls.flat()).toEqual([
        "usage: generate.ts <siteId> | --check",
        "usage: generate.ts <siteId> | --check",
        "mock-data: unknown site id",
      ]);
    } finally {
      err.mockRestore();
    }
  });
});
