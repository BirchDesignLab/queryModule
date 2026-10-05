import type { MockFile } from "../contracts/mock-file";

/**
 * Fixture policy for mock payloads (spec 5.4, 10.8; SEC-002: no real CJIS data).
 * Payloads are free-form, so the policy is an allowlist of normalised keys, not a deny list.
 * Pure: no I/O, no Node APIs. Messages carry fixed text and pointers only, never values (spec 5.9).
 */

export interface FixtureDiagnostic {
  pointer: string;
  key:
    | "fixture.realPlate"
    | "fixture.validVin"
    | "fixture.plausibleDob"
    | "fixture.nonSyntheticName"
    | "fixture.nonExampleAddress"
    | "fixture.unknownKey"
    | "fixture.freeTextDigits";
}

/**
 * Allowlist of payload keys by kind (spec 5.4); listed in docs/site-config.md.
 * Keys are normalised before lookup: lower-cased, "_" and "-" removed.
 * `other` holds structural keys (objects and arrays) and descriptive vehicle, property and
 * warrant keys; its strings may not carry a run of 4 or more digits (a `year` of 1901 to 1999
 * is the one exception).
 */
export const FIXTURE_LEAF_KEYS: {
  plate: readonly string[];
  vin: readonly string[];
  dob: readonly string[];
  name: readonly string[];
  address: readonly string[];
  status: readonly string[];
  freeText: readonly string[];
  other: readonly string[];
} = {
  plate: ["plate"],
  vin: ["vin"],
  // `issued` is a date (warrant issue date), held to the same 1901 rule as a birth date.
  dob: ["dob", "dateofbirth", "birthdate", "issued"],
  name: [
    "last",
    "first",
    "middle",
    "name",
    "lastname",
    "firstname",
    "middlename",
    "surname",
    "ownername",
    "registeredowner",
  ],
  address: ["address", "street", "addressline1"],
  status: ["status"],
  freeText: ["remarks", "note", "caution", "description", "offense"],
  other: [
    "make",
    "model",
    "year",
    "type",
    "state",
    "serial",
    "propertytype",
    "warrant",
    "agency",
    "vehicle",
    "owner",
    "owners",
    "subject",
    "warrants",
  ],
};

export const SYNTHETIC_NAMES: ReadonlySet<string> = new Set([
  "TESTERSON",
  "SAMPLEWORTH",
  "EXAMPLESON",
  "SAMPLE",
  "TEST",
  "TESTER",
  "EXAMPLE",
]);

export function normaliseFixtureKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const LETTER_VALUES: Readonly<Record<string, number>> = {
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

/** ISO 3779 position 9. A VIN must FAIL this to be fictitious. I, O, Q and other characters are invalid. */
export function vinCheckDigitValid(vin: string): boolean {
  if (vin.length !== 17) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin.charAt(i).toUpperCase();
    const v = c >= "0" && c <= "9" ? Number(c) : LETTER_VALUES[c];
    if (v === undefined) return false;
    sum += v * (WEIGHTS[i] ?? 0);
  }
  const r = sum % 11;
  return vin.charAt(8).toUpperCase() === (r === 10 ? "X" : String(r));
}

type Violation = FixtureDiagnostic["key"] | null;

const has = (list: readonly string[], k: string): boolean => list.includes(k);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkLeaf(kind: keyof typeof FIXTURE_LEAF_KEYS, nk: string, value: unknown): Violation {
  switch (kind) {
    case "plate":
      return typeof value === "string" && /^ZZ-\d{4}$/.test(value) ? null : "fixture.realPlate";
    case "vin":
      return typeof value === "string" && value.length === 17 && !vinCheckDigitValid(value)
        ? null
        : "fixture.validVin";
    case "dob":
      return typeof value === "string" && /^1901-\d{2}-\d{2}$/.test(value)
        ? null
        : "fixture.plausibleDob";
    case "name": {
      if (typeof value !== "string") return "fixture.nonSyntheticName";
      const words = value.trim().split(/\s+/);
      return value.trim() !== "" && words.every((w) => SYNTHETIC_NAMES.has(w.toUpperCase()))
        ? null
        : "fixture.nonSyntheticName";
    }
    case "address":
      return typeof value === "string" && /\bExample Ave$/i.test(value.trim())
        ? null
        : "fixture.nonExampleAddress";
    case "freeText":
      return typeof value === "string" && !/\d/.test(value) ? null : "fixture.freeTextDigits";
    case "status":
      return typeof value === "object" && value !== null ? "fixture.unknownKey" : null;
    case "other": {
      if (nk === "year" && (typeof value === "string" || typeof value === "number")) {
        return /^19\d{2}$/.test(String(value)) && Number(value) >= 1901
          ? null
          : "fixture.freeTextDigits";
      }
      return typeof value === "string" && /\d{4,}/.test(value) ? "fixture.freeTextDigits" : null;
    }
  }
}

const KINDS = Object.keys(FIXTURE_LEAF_KEYS) as Array<keyof typeof FIXTURE_LEAF_KEYS>;

const escapePointer = (s: string): string => s.replace(/~/g, "~0").replace(/\//g, "~1");

function walk(value: unknown, pointer: string, out: FixtureDiagnostic[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      walk(v, `${pointer}/${i}`, out);
    });
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const at = `${pointer}/${escapePointer(k)}`;
    const nk = normaliseFixtureKey(k);
    const kind = KINDS.find((kd) => has(FIXTURE_LEAF_KEYS[kd], nk));
    if (kind === undefined) {
      out.push({ pointer: at, key: "fixture.unknownKey" });
      continue;
    }
    if (kind === "other" && (Array.isArray(v) || isPlainObject(v))) {
      walk(v, at, out);
      continue;
    }
    const bad = checkLeaf(kind, nk, v);
    if (bad !== null) out.push({ pointer: at, key: bad });
  }
}

/**
 * Walks every respond and default payload, recursing into objects and arrays (never `when`;
 * trigger inputs are exempt), and reports each violation with its JSON pointer.
 */
export function checkFixturePolicy(file: MockFile): FixtureDiagnostic[] {
  const out: FixtureDiagnostic[] = [];
  for (const [sourceId, source] of Object.entries(file.sources)) {
    source.responses.forEach((resp, ri) => {
      const base = `/sources/${escapePointer(sourceId)}/responses/${ri}`;
      walk(resp.default, `${base}/default`, out);
      resp.scenarios.forEach((sc, si) => {
        if (sc.respond !== undefined) walk(sc.respond, `${base}/scenarios/${si}/respond`, out);
      });
    });
  }
  return out;
}
