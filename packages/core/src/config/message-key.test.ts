import { describe, expect, it } from "vitest";
import { AuditValidationErrorSchema } from "../contracts/audit";
import { ValidationErrorSchema } from "../contracts/validation-error";
import { ClientSiteConfigSchema } from "./client-config";
import { DiagnosticSchema } from "./diagnostic";
import { makeSiteConfigSchemas } from "./schema";
import { makeFieldSchemas } from "./schema-fields";

const GOOD = ["app.title", "config.unknownToken", "field.plate", "a"];
const BAD = [
  "App.title",
  "app..title",
  "app.",
  "app title",
  "app-title",
  "plate.ZZ-0001",
  `a${".b".repeat(64)}`,
];

const strict = makeFieldSchemas("strict");
const site = makeSiteConfigSchemas("strict");

/** Every schema that carries a message or label key, as "accepts this key?" (ADR-0005, #61). */
const carriers: Record<string, (key: string) => boolean> = {
  auditKey: (key) => AuditValidationErrorSchema.safeParse({ key }).success,
  auditLabelKey: (key) =>
    AuditValidationErrorSchema.safeParse({ key: "validation.required", params: { labelKey: key } })
      .success,
  validationErrorKey: (key) => ValidationErrorSchema.safeParse({ key }).success,
  diagnosticKey: (key) =>
    DiagnosticSchema.safeParse({ level: "error", path: "", key, params: {} }).success,
  fieldLabelKey: (key) =>
    strict.FieldDef.safeParse({ key: "plate", labelKey: key, dataType: "string" }).success,
  sectionLabelKey: (key) => strict.SectionDef.safeParse({ key: "base", labelKey: key }).success,
  personaLabelKey: (key) =>
    site.PersonaDef.safeParse({ key: "dispatch", labelKey: key, layout: "dispatch" }).success,
  clientSiteLabelKey: (key) =>
    ClientSiteConfigSchema.shape.site.safeParse({ id: "example-ok", labelKey: key }).success,
};

describe("#61 message and label keys are bounded the same way everywhere (ADR-0005)", () => {
  for (const [name, accepts] of Object.entries(carriers)) {
    it(`${name} accepts well-formed keys and rejects malformed ones`, () => {
      for (const k of GOOD) expect(accepts(k), `${name} ${k}`).toBe(true);
      for (const k of BAD) expect(accepts(k), `${name} ${k}`).toBe(false);
    });
  }

  it("picklist value codes are not message keys (ADR-0005: codes such as BLK/WHI stay valid)", () => {
    expect(
      site.Picklist.safeParse({
        id: "vehicleColor",
        values: [{ code: "BLK/WHI", labelKey: "color.blackWhite" }],
      }).success,
    ).toBe(true);
  });
});
