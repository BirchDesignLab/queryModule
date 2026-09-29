import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { defaultSite, exampleOkSite } from "./__fixtures__/sites";
import * as terminal from "./index";
import { parseCommand } from "./parse";
import { checkTerminalSubmit } from "./submit-check";
import type { Draft, TerminalConfig } from "./types";

const now = Date.UTC(2026, 8, 28);
const check = (input: string, drafts: Readonly<Record<string, Draft>> = {}) =>
  checkTerminalSubmit(defaultSite, input, drafts, { now });

describe("[A4] FR-053 what Enter in the terminal would submit", () => {
  it("VEH.ABC123..26 with an empty draft is valid; defaults fill the omitted state", () => {
    const c = check("VEH.ABC123..26");
    expect(c.errors).toEqual([]);
    expect(c.queryType).toBe("VEH");
    expect(c.merged).toEqual({ plate: "ABC123", state: null, year: "26", vin: null });
    expect(c.formState?.valid).toBe(true);
    expect(c.formState?.values).toMatchObject({ state: "TX", year: 2026 });
  });

  it("XYZ.123 is an unknown command with nothing merged", () => {
    const c = check("XYZ.123");
    expect(c.errors).toEqual([{ key: "terminal.unknownCommand", params: { code: "XYZ" } }]);
    expect(c.queryType).toBeUndefined();
    expect(c.merged).toBeUndefined();
    expect(c.formState).toBeUndefined();
  });

  it("returns the tokenize result it evaluated", () => {
    expect(check("VEH.ABC123").tokenized).toEqual(terminal.tokenize(defaultSite, "VEH.ABC123"));
  });
});

describe("FR-056 the merged draft is evaluated, not the command alone (#297 item 3)", () => {
  it("a draft-only plateType satisfies the rule", () => {
    const c = check("VEH.ABC123.OK", { VEH: { plateType: "PC" } });
    expect(c.errors).toEqual([]);
    expect(c.formState?.valid).toBe(true);
    expect(c.merged).toMatchObject({ plate: "ABC123", state: "OK", plateType: "PC" });
  });

  it("with an empty draft plateType is required, with no position", () => {
    expect(check("VEH.ABC123.OK").errors).toEqual([
      { key: "validation.required", params: { field: "plateType", labelKey: "field.plateType" } },
    ]);
  });

  it("a position the command omits overwrites the draft with null (spec 4.4)", () => {
    const c = check("VEH.ABC123", { VEH: { plate: "ZZ-0001", state: "OK", year: "26" } });
    expect(c.merged).toEqual({ plate: "ABC123", state: null, year: null, vin: null });
  });
});

describe("FR-056 other query types' drafts are untouched (#297 item 4)", () => {
  it("VEH.ABC123 merges into the VEH draft only", () => {
    const drafts = { PER: { last: "TESTERSON" } };
    const c = check("VEH.ABC123", drafts);
    expect(c.merged).toEqual({ plate: "ABC123", state: null, year: null, vin: null });
    expect(drafts).toEqual({ PER: { last: "TESTERSON" } });
  });

  it("a query type named like an Object.prototype key reads no inherited draft", () => {
    const drafts = JSON.parse('{"__proto__":{"plate":"leak"}}') as Record<string, Draft>;
    expect(check("VEH.ABC123", drafts).merged).toEqual({
      plate: "ABC123",
      state: null,
      year: null,
      vin: null,
    });
  });
});

describe("FR-055 hidden typed values and positions", () => {
  it("VEH.ABC123.TX.plateType=PC: valueForHiddenField; the value stays in merged", () => {
    const c = check("VEH.ABC123.TX.plateType=PC");
    expect(c.errors).toEqual([
      {
        key: "terminal.valueForHiddenField",
        params: { field: "plateType", labelKey: "field.plateType" },
      },
    ]);
    expect(c.merged).toMatchObject({ plateType: "PC" });
  });

  it("a hidden value from the draft alone raises no error", () => {
    expect(check("VEH.ABC123.TX", { VEH: { plateType: "PC" } }).errors).toEqual([]);
  });

  // Plan text used VEH..TX; plate is not required on the default site, so PER..PAT (last).
  it("PER..PAT: last required at position 1", () => {
    expect(check("PER..PAT").errors).toEqual([
      {
        key: "validation.required",
        params: { field: "last", labelKey: "field.last", position: 1 },
      },
    ]);
  });

  it("a preset-only key never raises valueForHiddenField (spec 4.4)", () => {
    const site: TerminalConfig = {
      ...defaultSite,
      commands: [
        {
          code: "VPC",
          queryType: "VEH",
          presets: { plateType: "PC" },
          positions: ["plate", "state"],
        },
      ],
    };
    const c = checkTerminalSubmit(site, "VPC.ABC123.TX", {}, { now });
    expect(c.errors.map((e) => e.key)).not.toContain("terminal.valueForHiddenField");
    expect(c.merged).toMatchObject({ plateType: "PC" });
  });

  it("is exported from @querymodule/core/terminal", () => {
    expect(terminal.checkTerminalSubmit).toBe(checkTerminalSubmit);
  });
});

describe("FR-053 with an empty draft map, errors equal parseCommand's (same enrichment)", () => {
  const sites: [string, TerminalConfig][] = [
    ["default", defaultSite],
    ["example-ok", exampleOkSite],
  ];
  it.each(sites)("%s site", (_name, site) => {
    const codes = [...site.commands.map((c) => c.code), "XYZ", ""];
    const tokens = [
      "",
      " ",
      "ABC123",
      "ZZ-0001",
      "OK",
      "TX",
      "QQ",
      "26",
      "1901-01-01",
      "TESTERSON",
      "PC",
      "plateType=PC",
      "state=QQ",
      "last=",
      "bogus=1",
      "=",
    ];
    const input = fc
      .tuple(
        fc.constantFrom(...codes),
        fc.array(fc.oneof(fc.constantFrom(...tokens), fc.string({ maxLength: 6 })), {
          maxLength: 6,
        }),
      )
      .map(([code, rest]) => [code, ...rest].join(site.terminal.delimiter));
    fc.assert(
      fc.property(fc.oneof(input, fc.string({ maxLength: 20 })), (text) => {
        expect(checkTerminalSubmit(site, text, {}, { now }).errors).toEqual(
          parseCommand(site, text, { now }).errors,
        );
      }),
      { numRuns: 300 },
    );
  });
});
