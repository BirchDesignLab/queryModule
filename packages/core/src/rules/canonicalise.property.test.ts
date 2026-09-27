import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeField, NOW } from "./__fixtures__/rules-fixtures.js";
import { canonicalise } from "./canonicalise.js";

const CODES = ["TX", "OK", "NM"];
const fields = {
  string: makeField({
    key: "s",
    dataType: "string",
    transform: "upper",
    charset: "printable",
    maxLength: 4096,
  }),
  asciiString: makeField({ key: "a", dataType: "string" }),
  picklist: makeField({ key: "p", dataType: "picklist", picklist: "state" }),
  number: makeField({ key: "n", dataType: "number", numberKind: "decimal" }),
  year: makeField({ key: "y", dataType: "year", century: "past" }),
  date: makeField({
    key: "d",
    dataType: "date",
    century: "past",
    inputFormats: ["MMDDYY", "MM/DD/YYYY"],
  }),
  boolean: makeField({ key: "b", dataType: "boolean" }),
};
const raw = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc.integer().map(String),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map(String),
  fc.constantFrom("26", "99", "092526", "12/31/1999", "y", "N", "tx", "-0", "1.50", "  ok  "),
);

describe("canonicalisation is idempotent: canon(canon(x)) = canon(x) (spec 4.3, 10.1)", () => {
  for (const [name, field] of Object.entries(fields)) {
    it(name, () => {
      fc.assert(
        fc.property(raw, (input) => {
          const once = canonicalise(field, input, { now: NOW, codes: CODES });
          if (once.value === null) return;
          const twice = canonicalise(field, once.value, { now: NOW, codes: CODES });
          expect(twice).toEqual(once);
        }),
        { numRuns: 500 },
      );
    });
  }
});
