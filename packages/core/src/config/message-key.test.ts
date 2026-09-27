import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuditValidationErrorSchema } from "../contracts/audit";
import { MESSAGE_KEY_MAX_LENGTH, MESSAGE_KEY_PATTERN } from "../contracts/primitives";
import { ValidationErrorSchema } from "../contracts/validation-error";
import { ClientSiteConfigSchema } from "./client-config";
import { DiagnosticSchema } from "./diagnostic";
import { makeSiteConfigSchemas, SiteConfigSchema } from "./schema";
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

  // Review M2 (PR #93): every labelKey node in the generated JSON Schema carries the bound, so
  // reverting any one carrier (picklist value, source, query type, purpose, mappings...) fails.
  for (const [name, schema] of Object.entries({
    SiteConfigSchema,
    ClientSiteConfigSchema,
  })) {
    it(`${name}: every labelKey in the JSON Schema is a MessageKey`, () => {
      const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
      const defs = (json as { $defs?: Record<string, unknown> }).$defs ?? {};
      const deref = (node: unknown): unknown => {
        const ref = (node as { $ref?: string } | null)?.$ref;
        return ref?.startsWith("#/$defs/") ? deref(defs[ref.slice(8)]) : node;
      };
      const found: string[] = [];
      const walk = (node: unknown, path: string): void => {
        if (Array.isArray(node)) {
          for (const [i, n] of node.entries()) walk(n, `${path}/${i}`);
          return;
        }
        if (node === null || typeof node !== "object") return;
        for (const [k, v] of Object.entries(node)) {
          if (k === "properties" && v && typeof v === "object" && "labelKey" in v) {
            const lk = deref((v as Record<string, unknown>).labelKey);
            found.push(path);
            expect(lk, `${path}/properties/labelKey`).toMatchObject({
              type: "string",
              pattern: MESSAGE_KEY_PATTERN.source,
              maxLength: MESSAGE_KEY_MAX_LENGTH,
            });
          }
          walk(v, `${path}/${k}`);
        }
      };
      walk(json, "");
      expect(found.length).toBeGreaterThan(0);
    });
  }
});
