import type { KeywordStyle } from "@querymodule/core/config";
import type { Assessment, MappedResult } from "@querymodule/core/contracts";
import type { SeverityStyles } from "./severity.js";

/** Synthetic card data for the result primitive tests (spec 5.4: no real records). */
export const MESSAGES: Record<string, string> = {
  "severity.critical": "Critical",
  "severity.warning": "Warning",
  "severity.info": "Info",
  "severity.word.critical": "critical",
  "severity.word.warning": "warning",
  "severity.word.info": "info",
  "sourceStatus.line": "{source}: {status}",
  "result.showDetail": "Show detail",
  "result.hideDetail": "Hide detail",
  "result.moreItems.one": "{count} more item",
  "result.moreItems.other": "{count} more items",
  "result.rowCount.one": "{count} row",
  "result.rowCount.other": "{count} rows",
  "result.keywordSeverity": "({severity})",
  "result.noMapping": "No card is set up for this result, so every field shows under its path.",
  "result.diagnostics": "Mapping notes (development)",
  "mapping.plate": "Plate",
  "mapping.make": "Make",
  "mapping.flags": "Flags",
  "mapping.owner": "Owner",
  "mapping.history": "History",
  "mapping.year": "Year",
  "mapping.event": "Event",
};

export const t = (key: string, params?: Readonly<Record<string, string | number | boolean>>) => {
  const form =
    params !== undefined && "count" in params
      ? `${key}.${params.count === 1 ? "one" : "other"}`
      : key;
  const raw = MESSAGES[form] ?? MESSAGES[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
};

export const STYLES: SeverityStyles = {
  critical: {
    color: "color.severity.critical.fg",
    background: "color.severity.critical.bg",
    bold: true,
    icon: "alert-octagon",
    marker: "!!",
  },
  warning: {
    color: "color.severity.warning.fg",
    background: "color.severity.warning.bg",
    bold: true,
    icon: "alert-triangle",
    marker: "!",
  },
  info: {
    color: "color.severity.info.fg",
    background: "color.severity.info.bg",
    bold: false,
    icon: "info",
    marker: "i",
  },
};

export const KEYWORDS: KeywordStyle[] = [
  { keyword: "STOLEN", severity: "critical" },
  { keyword: "TESTMAKE", severity: "warning" },
];

export const CRITICAL: Assessment = {
  severity: "critical",
  matches: [{ keyword: "STOLEN", severity: "critical", path: "/flags/0" }],
};
export const CLEAR: Assessment = { severity: null, matches: [] };

export const MAPPED: MappedResult = {
  mappingIndex: 0,
  diagnostics: [{ path: "/missing", reason: "unresolved" }],
  elements: [
    {
      kind: "scalar",
      label: { key: "mapping.plate" },
      value: "ZZ-0001",
      view: "both",
      highlight: false,
    },
    {
      kind: "scalar",
      label: { key: "mapping.flags" },
      value: "STOLEN VEHICLE",
      view: "summary",
      highlight: true,
    },
    {
      kind: "scalar",
      label: { key: "mapping.owner" },
      value: "ZZTEST, ALEX",
      view: "detail",
      highlight: true,
    },
    {
      kind: "table",
      label: { key: "mapping.history" },
      view: "detail",
      highlight: true,
      columns: [{ labelKey: "mapping.year" }, { labelKey: "mapping.event" }],
      rows: [
        ["1901", "TESTMAKE recall"],
        ["1902", "Registered"],
      ],
    },
  ],
};

export const GENERIC: MappedResult = {
  mappingIndex: null,
  diagnostics: [],
  elements: [
    {
      kind: "scalar",
      label: { text: "/vehicle/make" },
      value: "TESTMAKE",
      view: "both",
      highlight: true,
    },
  ],
};
