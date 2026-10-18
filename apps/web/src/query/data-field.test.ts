import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { isDataField } from "./data-field.js";

type Field = (typeof CLIENT_CONFIG.queryTypes)[number]["fields"][number];
const base = CLIENT_CONFIG.queryTypes[0]?.fields.find((f) => f.dataType === "string") as Field;

describe("read-back data is monospace, from field properties only (design: plates, VINs, IDs)", () => {
  it("the default site flags its code-like strings (plate, VIN, serial, license number), years and dates; names, make, model, caliber, agency and free text stay sans", () => {
    const mono = CLIENT_CONFIG.queryTypes.flatMap((q) =>
      q.fields.filter(isDataField).map((f) => `${q.code}.${f.key}`),
    );
    expect(mono).toEqual([
      "VEH.plate",
      "VEH.year",
      "VEH.vin",
      "PER.dob",
      "PRO.serial",
      "WNT.dob",
      "DL.licenseNumber",
      "DL.dob",
    ]);
  });

  it("only the config flag decides: not the data type, the pattern, the charset or the key (#476)", () => {
    const text = { ...base, key: "plate", mono: false } as Field;
    expect(isDataField(text)).toBe(false);
    expect(isDataField({ ...text, mono: true } as Field)).toBe(true);
    // What used to read as code-like no longer does without the flag.
    expect(isDataField({ ...text, pattern: "[A-Z]+" } as Field)).toBe(false);
    expect(isDataField({ ...text, charset: "printableAscii" } as Field)).toBe(false);
    expect(isDataField({ ...text, dataType: "year" } as Field)).toBe(false);
    expect(isDataField({ ...text, dataType: "date" } as Field)).toBe(false);
    // A flag on any type of field is honored, whatever its key.
    expect(isDataField({ ...text, key: "anything", dataType: "number", mono: true } as Field)).toBe(
      true,
    );
  });
});
