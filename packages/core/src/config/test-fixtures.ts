import type { SiteConfigInput } from "./schema";

const style = (s: "critical" | "warning" | "info") => ({
  color: `color.severity.${s}.fg`,
  background: `color.severity.${s}.bg`,
  bold: true,
  icon: "alert",
  marker: "!",
});

/** Smallest config that passes validateSiteConfig with no errors or warnings. */
export function minimalSiteConfigInput(): SiteConfigInput {
  return {
    schemaVersion: 1,
    site: { id: "t", labelKey: "site.t" },
    personas: [{ key: "dispatch", labelKey: "persona.dispatch", layout: "dispatch" }],
    auth: {},
    delegation: {},
    retention: { payloadDays: null, valuesDays: null },
    defaults: { state: "TX" },
    picklists: [
      {
        id: "state",
        values: [
          { code: "TX", labelKey: "picklist.state.TX" },
          { code: "OK", labelKey: "picklist.state.OK" },
        ],
      },
    ],
    sources: [
      {
        id: "src1",
        labelKey: "source.src1",
        scope: "state",
        kind: "mock",
        requiresCredentials: false,
      },
    ],
    queryTypes: [
      {
        code: "VEH",
        labelKey: "queryType.VEH",
        sections: [{ key: "base", labelKey: "section.base" }],
        fields: [
          { key: "plate", labelKey: "field.plate", dataType: "string", required: true },
          { key: "state", labelKey: "field.state", dataType: "picklist", picklist: "state" },
        ],
        rules: [],
        sources: [{ sourceId: "src1", selectedByDefault: true }],
      },
    ],
    commands: [{ code: "VEH", queryType: "VEH", positions: ["plate", "state"] }],
    keywords: [{ keyword: "STOLEN", severity: "critical", except: ["NOT STOLEN"] }],
    keywordSeverityStyles: {
      critical: style("critical"),
      warning: style("warning"),
      info: style("info"),
    },
    responseMappings: [],
    quickAccess: ["VEH"],
  };
}

export const MINIMAL_LOCALES: Record<string, Record<string, string>> = {
  en: {
    "site.t": "Test site",
    "persona.dispatch": "Dispatch",
    "delegation.training": "Training",
    "picklist.state.TX": "Texas",
    "picklist.state.OK": "Oklahoma",
    "source.src1": "Source one",
    "queryType.VEH": "Vehicle",
    "section.base": "Base",
    "field.plate": "Plate",
    "field.state": "State",
  },
};

export const TEST_TOKEN_NAMES: readonly string[] = [
  "color.severity.critical.fg",
  "color.severity.critical.bg",
  "color.severity.warning.fg",
  "color.severity.warning.bg",
  "color.severity.info.fg",
  "color.severity.info.bg",
];
