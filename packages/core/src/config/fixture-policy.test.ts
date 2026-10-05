import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MockFile } from "../contracts/mock-file";
import {
  checkFixturePolicy,
  FIXTURE_LEAF_KEYS,
  normaliseFixtureKey,
  SYNTHETIC_NAMES,
  vinCheckDigitValid,
} from "./fixture-policy";

const cfgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config");
const shipped = (rel: string): MockFile =>
  JSON.parse(readFileSync(resolve(cfgDir, rel), "utf8")) as MockFile;

const RESPOND = "/sources/stateSource/responses/0/scenarios/0/respond";

const withRespond = (respond: Record<string, unknown>): MockFile => ({
  siteId: "t",
  sources: {
    stateSource: {
      latencyMs: [1, 2],
      responses: [
        {
          queryType: "VEH",
          default: { status: "NO RECORD" },
          scenarios: [{ when: { plate: "ABC123" }, respond }],
        },
      ],
    },
  },
});

const withDefault = (def: Record<string, unknown>): MockFile => ({
  siteId: "t",
  sources: {
    nationalSource: {
      latencyMs: [1, 2],
      responses: [{ queryType: "VEH", default: def, scenarios: [] }],
    },
  },
});

const check = (respond: Record<string, unknown>) => checkFixturePolicy(withRespond(respond));

// ISO 3779 transliteration, computed here so no published real VIN is ever pasted.
const VALUES: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const vinWithCorrectDigit = (body: string): string => {
  const chars = body.split("");
  const sum = chars.reduce(
    (acc, c, i) => acc + (c >= "0" && c <= "9" ? Number(c) : (VALUES[c] ?? 0)) * (WEIGHTS[i] ?? 0),
    0,
  );
  const r = sum % 11;
  chars[8] = r === 10 ? "X" : String(r);
  return chars.join("");
};

describe("normaliseFixtureKey", () => {
  it("lower-cases and strips underscores and hyphens", () => {
    expect(normaliseFixtureKey("Owner_Name")).toBe("ownername");
    expect(normaliseFixtureKey("SUR-NAME")).toBe("surname");
  });
});

describe("shipped mock files", () => {
  it("default.json reports nothing", () => {
    expect(checkFixturePolicy(shipped("mock/default.json"))).toEqual([]);
  });
  it("example-ok.json reports nothing", () => {
    expect(checkFixturePolicy(shipped("mock/example-ok.json"))).toEqual([]);
  });
});

describe("key allowlist", () => {
  it("reports an unlisted key", () => {
    expect(check({ ssn: "x" })).toEqual([{ pointer: `${RESPOND}/ssn`, key: "fixture.unknownKey" }]);
  });
  it("reports an unlisted key hidden inside a nested object", () => {
    expect(check({ owner: { JOHN_SMITH_1985: "x" } })).toEqual([
      { pointer: `${RESPOND}/owner/JOHN_SMITH_1985`, key: "fixture.unknownKey" },
    ]);
  });
  it("reports unlisted keys in default payloads", () => {
    expect(checkFixturePolicy(withDefault({ ssn: "x" }))).toEqual([
      { pointer: "/sources/nationalSource/responses/0/default/ssn", key: "fixture.unknownKey" },
    ]);
  });
  it("finds a violation inside an array", () => {
    expect(check({ owners: [{ last: "TESTERSON" }, { last: "SMITH" }] })).toEqual([
      { pointer: `${RESPOND}/owners/1/last`, key: "fixture.nonSyntheticName" },
    ]);
  });
  it("never reports trigger inputs in when", () => {
    expect(
      checkFixturePolicy({
        siteId: "t",
        sources: {
          s: {
            latencyMs: [1, 2],
            responses: [
              {
                queryType: "VEH",
                default: { status: "NO RECORD" },
                scenarios: [{ when: { plate: "ABC123", ssn: "123-45-6789" }, behavior: "error" }],
              },
            ],
          },
        },
      }),
    ).toEqual([]);
  });
  it("ignores null and scalar array members", () => {
    expect(check({ warrants: [null, 3, { offense: "FAILURE TO APPEAR" }] })).toEqual([]);
  });
  it("escapes ~ and / in pointers", () => {
    expect(check({ "a/b~c": 1 })).toEqual([
      { pointer: `${RESPOND}/a~1b~0c`, key: "fixture.unknownKey" },
    ]);
  });
});

describe("plate keys", () => {
  it("fails a real-looking plate", () => {
    expect(check({ plate: "ABC1234" })).toEqual([
      { pointer: `${RESPOND}/plate`, key: "fixture.realPlate" },
    ]);
  });
  it("passes ZZ-####", () => {
    expect(check({ plate: "ZZ-0001" })).toEqual([]);
  });
  it("fails a non-string plate", () => {
    expect(check({ plate: 1234 })).toEqual([
      { pointer: `${RESPOND}/plate`, key: "fixture.realPlate" },
    ]);
  });
});

describe("vin keys", () => {
  it("fails a VIN with a correct check digit", () => {
    const vin = vinWithCorrectDigit("ZZZZZZZZ?ZZZZZZZ0");
    expect(vinCheckDigitValid(vin)).toBe(true);
    expect(check({ vin })).toEqual([{ pointer: `${RESPOND}/vin`, key: "fixture.validVin" }]);
  });
  it("accepts X as a correct check digit", () => {
    let found = false;
    for (const c of "ABCDEFGHJKLMNPRSTUVWXYZ123456789") {
      for (const d of "ABCDEFGHJKLMNPRSTUVWXYZ123456789") {
        const vin = vinWithCorrectDigit(`${c}${d}ZZZZZZ?ZZZZZZZ0`);
        if (vin[8] === "X") {
          found = true;
          expect(vinCheckDigitValid(vin)).toBe(true);
        }
      }
    }
    expect(found).toBe(true);
  });
  it("passes a VIN failing the check digit", () => {
    expect(vinCheckDigitValid("ZZZZZZZZZZZZZZZZ0")).toBe(false);
    expect(check({ vin: "ZZZZZZZZZZZZZZZZ0" })).toEqual([]);
  });
  it("rejects wrong length, invalid characters and non-strings", () => {
    expect(vinCheckDigitValid("ZZZ")).toBe(false);
    expect(vinCheckDigitValid("ZZZZZZZZ-ZZZZZZZ0")).toBe(false);
    expect(vinCheckDigitValid("IIIIIIIIIIIIIIIII")).toBe(false);
    expect(check({ vin: "ZZZ" })).toHaveLength(1);
    expect(check({ vin: 5 })).toHaveLength(1);
  });
});

describe("dob keys", () => {
  it("fails a 1985 DOB", () => {
    expect(check({ dob: "1985-04-12" })).toEqual([
      { pointer: `${RESPOND}/dob`, key: "fixture.plausibleDob" },
    ]);
  });
  it("passes a 1901 DOB", () => {
    expect(check({ dob: "1901-01-01" })).toEqual([]);
  });
  it("fails a non-string DOB", () => {
    expect(check({ dob: 19010101 })).toHaveLength(1);
  });
});

describe("name keys", () => {
  it.each(["ownerName", "owner_name", "SURNAME"])("%s is a name key and fails on SMITH", (k) => {
    expect(check({ [k]: "SMITH" })).toEqual([
      { pointer: `${RESPOND}/${k}`, key: "fixture.nonSyntheticName" },
    ]);
  });
  it("passes TESTERSON in any case", () => {
    expect(check({ last: "TESTERSON" })).toEqual([]);
    expect(check({ last: "testerson" })).toEqual([]);
    expect(check({ last: "Testerson" })).toEqual([]);
  });
  it("requires every word to be synthetic", () => {
    expect(check({ name: "SAMPLE TESTERSON" })).toEqual([]);
    expect(check({ name: "SAMPLE SMITH" })).toHaveLength(1);
  });
  it("fails empty and non-string names", () => {
    expect(check({ last: "" })).toHaveLength(1);
    expect(check({ last: 7 })).toHaveLength(1);
  });
  it("exposes the synthetic name set in upper case", () => {
    expect(SYNTHETIC_NAMES.has("TESTERSON")).toBe(true);
    expect(SYNTHETIC_NAMES.has("SAMPLEWORTH")).toBe(true);
  });
});

describe("address keys", () => {
  it("fails 12 Main St", () => {
    expect(check({ address: "12 Main St" })).toEqual([
      { pointer: `${RESPOND}/address`, key: "fixture.nonExampleAddress" },
    ]);
  });
  it("passes 1 Example Ave", () => {
    expect(check({ address: "1 Example Ave" })).toEqual([]);
  });
  it("fails a non-string address", () => {
    expect(check({ street: 4 })).toHaveLength(1);
  });
});

describe("free text keys", () => {
  it("fails remarks carrying a name and a date", () => {
    expect(check({ remarks: "JOHN SMITH DOB 04/12/1985" })).toEqual([
      { pointer: `${RESPOND}/remarks`, key: "fixture.freeTextDigits" },
    ]);
  });
  it("passes canned text", () => {
    expect(check({ remarks: "STOLEN VEHICLE" })).toEqual([]);
  });
  it("fails non-string free text", () => {
    expect(check({ note: 5 })).toHaveLength(1);
  });
});

describe("status and other keys", () => {
  it("allows free status text but not nested data", () => {
    expect(check({ status: "WANTED 12 TIMES" })).toEqual([]);
    expect(check({ status: { x: 1 } })).toHaveLength(1);
  });
  it("rejects a run of 4 digits in an other string", () => {
    expect(check({ make: "FORD 1234" })).toEqual([
      { pointer: `${RESPOND}/make`, key: "fixture.freeTextDigits" },
    ]);
  });
  it("allows short digit runs", () => {
    expect(check({ serial: "ZZSTOLEN1" })).toEqual([]);
  });
  it("allows a year in 1901 to 1999 and rejects others", () => {
    expect(check({ year: 1901 })).toEqual([]);
    expect(check({ year: "1999" })).toEqual([]);
    expect(check({ year: 2020 })).toEqual([
      { pointer: `${RESPOND}/year`, key: "fixture.freeTextDigits" },
    ]);
    expect(check({ year: "2020" })).toHaveLength(1);
  });
});

describe("FIXTURE_LEAF_KEYS", () => {
  it("lists only normalised keys, each in one kind", () => {
    const all = Object.values(FIXTURE_LEAF_KEYS).flat();
    for (const k of all) expect(normaliseFixtureKey(k)).toBe(k);
    expect(new Set(all).size).toBe(all.length);
  });
});
