import type { MockFile } from "../contracts/mock-file";

/**
 * Fixture policy for mock payloads (spec 5.4, 10.8; CLAUDE.md: mock data only, no fixtures that
 * look like real person, vehicle or property records).
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
 * `container` keys must hold an object or array (recursed); a scalar there is a violation.
 * `other` holds descriptive vehicle, property, warrant and licence leaf keys; its strings and numbers may
 * not carry a run of 4 or more digits, counted across separators (every character that is not a letter
 * or a decimal digit is one, and a digit is a digit of any script; a `year` of 1901 to 1999 is the one
 * exception). `status` follows the same run rule. A number in exponent form (1e21) is rejected in both
 * kinds.
 */
export const FIXTURE_LEAF_KEYS: {
  plate: readonly string[];
  vin: readonly string[];
  dob: readonly string[];
  name: readonly string[];
  address: readonly string[];
  status: readonly string[];
  freeText: readonly string[];
  container: readonly string[];
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
  container: ["vehicle", "owner", "owners", "subject", "warrant", "warrants"],
  other: [
    "make",
    "model",
    "year",
    "type",
    "state",
    "serial",
    "propertytype",
    "agency",
    "licensenumber",
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

/** A real calendar date in 1901 (not a leap year), as YYYY-MM-DD. */
const DAYS_1901 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function is1901Date(s: string): boolean {
  const m = /^1901-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= (DAYS_1901[month - 1] ?? 0);
}

/**
 * True when a string or number leaf carries a run of 4 or more digits. Every character that is neither a
 * letter nor a decimal digit is a separator, so 123,456,789 and 123-45-6789 count as one run (#636,
 * #638). A decimal digit is any Unicode Nd digit (Arabic-Indic, Devanagari, full-width: #647); the value
 * is NFKC-folded first so superscripts and the like count too. A number that stringifies in exponent form is treated as a violation.
 */
function hasDigitRun(value: unknown): boolean {
  const text = String(value);
  if (typeof value === "number" && /e/i.test(text)) return true;
  return /\p{Nd}{4,}/u.test(text.normalize("NFKC").replace(/[^\p{L}\p{Nd}]/gu, ""));
}

function checkLeaf(kind: keyof typeof FIXTURE_LEAF_KEYS, nk: string, value: unknown): Violation {
  switch (kind) {
    case "plate":
      return typeof value === "string" && /^ZZ-\d{4}$/.test(value) ? null : "fixture.realPlate";
    case "vin":
      return typeof value === "string" &&
        /^[A-HJ-NPR-Z0-9]{17}$/i.test(value) &&
        !vinCheckDigitValid(value)
        ? null
        : "fixture.validVin";
    case "dob":
      return typeof value === "string" && is1901Date(value) ? null : "fixture.plausibleDob";
    case "name": {
      if (typeof value !== "string") return "fixture.nonSyntheticName";
      const words = value.trim().split(/\s+/);
      return value.trim() !== "" && words.every((w) => SYNTHETIC_NAMES.has(w.toUpperCase()))
        ? null
        : "fixture.nonSyntheticName";
    }
    case "address":
      return typeof value === "string" && /^\d{1,4} Example Ave$/i.test(value.trim())
        ? null
        : "fixture.nonExampleAddress";
    case "freeText":
      return typeof value === "string" && !/\p{Nd}/u.test(value.normalize("NFKC"))
        ? null
        : "fixture.freeTextDigits";
    case "container":
      return "fixture.unknownKey";
    case "status":
      if (typeof value === "object" && value !== null) return "fixture.unknownKey";
      return hasDigitRun(value) ? "fixture.freeTextDigits" : null;
    case "other": {
      if (typeof value === "object" && value !== null) return "fixture.unknownKey";
      if (nk === "year" && (typeof value === "string" || typeof value === "number")) {
        return /^19\d{2}$/.test(String(value)) && Number(value) >= 1901
          ? null
          : "fixture.freeTextDigits";
      }
      // Separators do not hide a number: 123-45-678 and 12 34 count as one run (#636).
      return (typeof value === "string" || typeof value === "number") && hasDigitRun(value)
        ? "fixture.freeTextDigits"
        : null;
    }
  }
}

const KINDS = Object.keys(FIXTURE_LEAF_KEYS) as Array<keyof typeof FIXTURE_LEAF_KEYS>;

const escapePointer = (s: string): string => s.replace(/~/g, "~0").replace(/\//g, "~1");

function walk(value: unknown, pointer: string, out: FixtureDiagnostic[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const at = `${pointer}/${i}`;
      if (Array.isArray(v) || isPlainObject(v)) walk(v, at, out);
      else out.push({ pointer: at, key: "fixture.unknownKey" });
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
    if (kind === "container" && (Array.isArray(v) || isPlainObject(v))) {
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
