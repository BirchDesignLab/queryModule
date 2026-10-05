import type { SourcePayload } from "@querymodule/core/contracts";

/**
 * Fixture-safe payload builders (spec 5.4, 10.8). Every value they emit passes checkFixturePolicy
 * by construction: plates ZZ-####, VINs that fail the ISO 3779 check digit, DOBs in 1901,
 * synthetic names, addresses on Example Ave, and no digit runs in free text.
 */

/** "ZZ-" plus a 4-digit, zero-padded number. */
export function plate(n: number): string {
  return `ZZ-${String(n % 10000).padStart(4, "0")}`;
}

/**
 * 17 characters, check digit forced wrong: position 9 is "Z", which is not a valid ISO 3779
 * check character (only 0-9 and X are), so no n can produce a valid VIN. The last character
 * is (n + 9) % 10, so vin(1) keeps the "ZZZZZZZZZZZZZZZZ0" value of the M1 mock files.
 */
export function vin(n: number): string {
  return `${"Z".repeat(16)}${(n + 9) % 10}`;
}

const DAYS_1901 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A date in 1901 by day of year (1 to 365), as YYYY-MM-DD. */
export function dob(dayOfYear: number): string {
  if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 365) {
    throw new RangeError("mock-data: dayOfYear out of range");
  }
  let rest = dayOfYear;
  for (let m = 0; m < 12; m++) {
    const len = DAYS_1901[m] ?? 0;
    if (rest <= len) {
      return `1901-${String(m + 1).padStart(2, "0")}-${String(rest).padStart(2, "0")}`;
    }
    rest -= len;
  }
  throw new RangeError("mock-data: dayOfYear out of range");
}

const LASTS = ["TESTERSON", "SAMPLEWORTH", "EXAMPLESON"] as const;
const FIRSTS = ["SAMPLE", "TEST"] as const;

/** A synthetic person; the 1901 birth date is day n of the year (wraps at 365). */
export function person(n: number): { last: string; first: string; dob: string } {
  const i = Math.abs(n - 1);
  return {
    last: LASTS[i % LASTS.length] ?? "TESTERSON",
    first: FIRSTS[i % FIRSTS.length] ?? "SAMPLE",
    dob: dob((i % 365) + 1),
  };
}

export function address(n: number): string {
  return `${n % 10000} Example Ave`;
}

/**
 * A vehicle response. "NO RECORD" is the bare status. "STOLEN" is the full state record, or with
 * `summary` the short national record (status, plate, remarks).
 */
export function vehicleRecord(o: {
  plate: string;
  status: "STOLEN" | "NO RECORD";
  n: number;
  summary?: boolean;
}): SourcePayload {
  if (o.status === "NO RECORD") return { status: "NO RECORD" };
  if (o.summary === true) return { status: "STOLEN", plate: o.plate, remarks: "STOLEN VEHICLE" };
  const owner = person(o.n);
  return {
    status: "STOLEN",
    plate: o.plate,
    state: "TX",
    vehicle: { make: "TESTMAKE", model: "SAMPLEMODEL", year: 1901, vin: vin(o.n) },
    owner: { last: owner.last, first: owner.first, address: address(o.n) },
    remarks: "STOLEN VEHICLE",
  };
}

/** A stolen property response; the serial is a trigger-style token, not a real serial number. */
export function propertyRecord(o: { serial: string }): SourcePayload {
  return {
    status: "STOLEN",
    serial: o.serial,
    propertyType: "ARTICLE",
    description: "SAMPLE ARTICLE",
    remarks: "STOLEN PROPERTY",
  };
}

/** A wanted-person response: birth date is day n of 1901, the warrant is issued the next day. */
export function warrantRecord(o: { n: number }): SourcePayload {
  return {
    status: "WANTED",
    subject: { last: "SAMPLEWORTH", first: "TEST", dob: dob(o.n) },
    warrants: [{ offense: "FAILURE TO APPEAR", issued: dob(o.n + 1) }],
  };
}

/** A missing-person response: birth date is day n of 1901. */
export function missingRecord(o: { n: number }): SourcePayload {
  return {
    status: "MISSING PERSON",
    subject: { last: "EXAMPLESON", first: "TEST", dob: dob(o.n) },
    remarks: "MISSING PERSON",
  };
}
