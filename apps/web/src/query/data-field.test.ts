import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { isDataField } from "./data-field.js";

type Field = (typeof CLIENT_CONFIG.queryTypes)[number]["fields"][number];
const base = CLIENT_CONFIG.queryTypes[0]?.fields.find((f) => f.dataType === "string") as Field;

describe("read-back data is monospace, from field properties only (design: plates, VINs, IDs)", () => {
  it("the default site: code-like strings (plate, VIN, serial, licence number), years and dates; names, make, model, caliber, agency and free text stay sans", () => {
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

  it("a string is code-like with a pattern or the ASCII-only charset; upper case alone is not; any key", () => {
    const text = {
      ...base,
      key: "plate",
      pattern: undefined,
      transform: "none",
      charset: "printable",
    } as Field;
    expect(isDataField(text)).toBe(false);
    expect(isDataField({ ...text, pattern: "[A-Z]+" } as Field)).toBe(true);
    expect(isDataField({ ...text, transform: "upper" } as Field)).toBe(false);
    expect(isDataField({ ...text, charset: "printableAscii" } as Field)).toBe(true);
    expect(isDataField({ ...text, key: "anything", dataType: "year" } as Field)).toBe(true);
    expect(isDataField({ ...text, dataType: "date" } as Field)).toBe(true);
    expect(isDataField({ ...text, dataType: "boolean" } as Field)).toBe(false);
    expect(isDataField({ ...text, dataType: "number" } as Field)).toBe(false);
  });
});
