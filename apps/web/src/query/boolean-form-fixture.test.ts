import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SiteConfigSchema, toClientSiteConfig, validateSiteConfig } from "@querymodule/core/config";
import { evaluateForm } from "@querymodule/core/rules";
import { formLevelErrors } from "@querymodule/web-ui";
import { describe, expect, it } from "vitest";

// node:path, not new URL(rel, import.meta.url): jsdom's URL breaks the latter (see msw-server.ts).
const here = dirname(fileURLToPath(import.meta.url));
const sites = join(here, "../../e2e/sites");
const read = (name: string): unknown => JSON.parse(readFileSync(join(sites, name), "utf8"));

const config = SiteConfigSchema.parse(read("boolean-form.json"));
const en = read("../../../../packages/config/locales/en.json") as Record<string, string>;
const bundle = { ...en, ...(read("boolean-form.en.json") as Record<string, string>) };
const NOW = Date.UTC(2026, 8, 29);

describe("FR-005 FR-006 e2e fixture boolean-form.json (#309)", () => {
  it("parses and validates against the shipped schema and the en bundle plus its overlay", () => {
    const result = validateSiteConfig(config, { en: bundle }, { now: NOW });
    expect(result.errors).toEqual([]);
  });

  it("has a required boolean field", () => {
    const qt = config.queryTypes.find((q) => q.code === "CHK");
    const agree = qt?.fields.find((f) => f.key === "agree");
    expect(agree).toMatchObject({ dataType: "boolean", required: true });
  });

  it("yields a form-level error: an invalid value kept in a field a rule then hides", () => {
    // Core emits only field-keyed errors. missingRequired cannot be form-level (required implies
    // visible in a shown section, so always rendered), so the route is an error keyed to a field
    // QueryForm does not render (renderedSections): a bad value typed before a rule hides it.
    const state = evaluateForm(
      toClientSiteConfig(config, `${"0".repeat(63)}1`),
      "CHK",
      { code: "bad value!", mode: "SKIP" },
      { now: NOW },
    );
    expect(state.missingRequired).toEqual(["agree"]);
    expect(state.fields.find((f) => f.key === "code")?.visible).toBe(false);
    expect(formLevelErrors(state)).toEqual([
      { key: "validation.patternMismatch", params: { field: "code" } },
    ]);
  });
});
