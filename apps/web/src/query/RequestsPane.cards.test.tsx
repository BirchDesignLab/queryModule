import type { SubmitQueryResponse } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { mapResponse } from "@querymodule/core/response";
import { act, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ACK_CORRELATION_ID } from "../test/feed-driver.js";
import { CLIENT_CONFIG, detail202, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { RequestsPane } from "./RequestsPane.js";
import { partValuesOf } from "./result-view.js";

// Result cards in the request list (FR-043, FR-060, FR-064, FR-065, UX-004, UX-010; spec 4.5, 6.2).
// Payloads here are synthetic (spec 5.4): plates ZZ-####, names ZZTEST.

const VEH_PART = {
  partId: 1,
  parentPartId: null,
  origin: "primary" as const,
  queryType: "VEH",
  status: "dispatched" as const,
  sourceIds: ["stateSource", "nationalSource"],
  droppedSourceIds: [],
  skipReasons: [],
};
const ACK: SubmitQueryResponse = {
  correlationId: ACK_CORRELATION_ID,
  acknowledgedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
  parts: [VEH_PART],
};

const WNT_PART = {
  partId: 2,
  parentPartId: 0 as const,
  origin: "alsoRun" as const,
  queryType: "WNT",
  status: "dispatched" as const,
  sourceIds: ["nationalSource"],
  droppedSourceIds: [],
  skipReasons: [],
};

const STOLEN = { status: "STOLEN", plate: "ZZ-0001", remarks: "STOLEN VEHICLE" };

type Elements = ClientSiteConfig["responseMappings"][number]["elements"];

/** A detail for the canned request: every listed part, its sources returned with their payloads. */
function detail(
  parts: {
    partId: number;
    parentPartId: number | null;
    origin: string;
    queryType: string;
    sources: { sourceId: string; payload: Record<string, unknown> }[];
    /** What the server planned for the part (GET /queries/{id}); absent when purged or not sent. */
    values?: Record<string, unknown>;
    purged?: boolean;
  }[],
) {
  const base = detail202();
  return {
    ...base,
    parts: parts.map((part) => ({
      ...(base.parts[0] as object),
      ...part,
      sources: part.sources.map((s) => ({
        ...(base.parts[0]?.sources[0] as object),
        ...s,
        status: "returned",
        receivedAt: ACK.acknowledgedAt,
      })),
    })),
  } as never;
}

/** The default config with one mapping's elements replaced (or extended) for a test. */
function withMapping(id: string, change: (elements: Elements) => Elements): ClientSiteConfig {
  return {
    ...CLIENT_CONFIG,
    responseMappings: CLIENT_CONFIG.responseMappings.map((m) =>
      m.id === id ? { ...m, elements: change(m.elements) } : m,
    ),
  };
}

const DETAIL_ROW = {
  kind: "value",
  path: "remarks",
  labelKey: "field.description",
  view: "detail",
  highlight: true,
} as const;

/** A config the test can swap while the pane stays mounted, as a published change does. */
function Harness({
  initial,
  expose,
}: {
  initial: ClientSiteConfig;
  expose(set: (c: ClientSiteConfig) => void): void;
}) {
  const [config, setConfig] = useState(initial);
  expose(setConfig);
  return (
    <>
      <input aria-label="Plate" />
      <RequestsPane config={config} variant="list" />
    </>
  );
}

function setup(
  response: SubmitQueryResponse,
  detailBody: unknown,
  options: {
    config?: ClientSiteConfig;
    values?: Record<string, string>;
    queryType?: string;
  } = {},
) {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  const queryType = options.queryType ?? "VEH";
  const id = services.requests.getState().begin({
    queryType,
    summary: "ignored",
    submitted: {
      queryType,
      values: options.values ?? { plate: "ZZ-0001" },
      sourceIds: [],
      mode: "normal",
    },
  });
  act(() => {
    services.requests.getState().settle(id, { kind: "acknowledged", response, queryType });
    services.requests.getState().applyDetail(detailBody as never);
  });
  let setConfig: (c: ClientSiteConfig) => void = () => undefined;
  const view = renderRoutes(
    [
      {
        path: "/",
        element: (
          <Harness
            initial={options.config ?? CLIENT_CONFIG}
            expose={(set) => {
              setConfig = set;
            }}
          />
        ),
      },
    ],
    { services },
  );
  return { ...view, setConfig: (c: ClientSiteConfig) => act(() => setConfig(c)) };
}

const row = () => document.querySelector("li.qm-request") as HTMLElement;

describe("FR-060 a returned source with its payload is a card (spec 6.2)", () => {
  it("ZZ-0001 shows two cards with critical badges and STOLEN marked", () => {
    setup(
      ACK,
      detail([
        {
          ...VEH_PART,
          sources: [
            { sourceId: "stateSource", payload: STOLEN },
            { sourceId: "nationalSource", payload: STOLEN },
          ],
        },
      ]),
    );
    const cards = screen.getAllByRole("region", { name: /: returned$/ });
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByText("Critical")).toBeVisible();
      expect(card.querySelector("mark")).toHaveTextContent("STOLEN");
    }
    expect(screen.getByRole("region", { name: "State system: returned" })).toBeVisible();
    expect(screen.getByRole("region", { name: "National system: returned" })).toBeVisible();
  });

  it("the entry header carries the request's highest severity", () => {
    setup(
      ACK,
      detail([
        {
          ...VEH_PART,
          sources: [
            { sourceId: "stateSource", payload: { status: "NO RECORD" } },
            { sourceId: "nationalSource", payload: STOLEN },
          ],
        },
      ]),
    );
    const header = row().querySelector(".qm-request__severity");
    expect(header).toHaveTextContent("Critical");
    expect(within(header as HTMLElement).queryByText("Info")).toBeNull();
  });

  it("ABC123 shows an info card, and the header says info", () => {
    setup(
      ACK,
      detail([
        {
          ...VEH_PART,
          sources: [
            { sourceId: "stateSource", payload: { status: "NO RECORD", plate: "ABC123" } },
            { sourceId: "nationalSource", payload: { status: "NO RECORD" } },
          ],
        },
      ]),
      { values: { plate: "ABC123" } },
    );
    const card = screen.getByRole("region", { name: "State system: returned" });
    expect(within(card).getByText("Info")).toBeVisible();
    expect(row().querySelector(".qm-request__severity")).toHaveTextContent("Info");
  });

  it("a source still pending stays a status line, with no card and no header badge", () => {
    setup(ACK, detail202());
    expect(screen.queryByRole("region", { name: /: returned$/ })).toBeNull();
    expect(screen.getByText("State system: pending")).toBeVisible();
    expect(row().querySelector(".qm-request__severity")).toBeNull();
  });
});

describe("FR-064 a nested part is labelled from its origin and shows its own card", () => {
  const WNT_CONFIG = withMapping("wnt-summary", () => [
    { kind: "value", path: "status", labelKey: "mapping.status", view: "both", highlight: true },
    {
      kind: "table",
      path: "warrants",
      labelKey: "field.description",
      view: "both",
      highlight: true,
      columns: [
        { path: "issued", labelKey: "field.dob" },
        { path: "offense", labelKey: "field.last" },
      ],
    },
  ]);
  const PER_ACK: SubmitQueryResponse = {
    ...ACK,
    parts: [{ ...VEH_PART, queryType: "PER", sourceIds: ["nationalSource"] }, WNT_PART],
  };

  it("WANTED shows the nested part labelled from the primary type, with a warrants table", () => {
    setup(
      PER_ACK,
      detail([
        {
          ...VEH_PART,
          queryType: "PER",
          sources: [{ sourceId: "nationalSource", payload: { status: "NO RECORD" } }],
        },
        {
          ...WNT_PART,
          sources: [
            {
              sourceId: "nationalSource",
              payload: {
                status: "WANTED",
                warrants: [{ issued: "1901-01-02", offense: "FAILURE TO APPEAR" }],
              },
            },
          ],
        },
      ]),
      { config: WNT_CONFIG, queryType: "PER", values: { last: "WANTED", first: "ZZTEST" } },
    );
    expect(screen.getByText("Wanted check, also run from Person")).toBeVisible();
    const table = screen.getByRole("table");
    expect(within(table).getByText("FAILURE TO APPEAR")).toBeVisible();
    // The outline: the list at 2, the primary card at 4, the nested part's own heading at 4 (its
    // section), and the nested card under it at 5 (design: a nested part is its own section).
    expect(screen.getAllByRole("heading", { level: 5 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
    const nested = screen.getByRole("region", { name: "Wanted check, also run from Person" });
    expect(
      within(nested).getByRole("heading", {
        level: 4,
        name: "Wanted check, also run from Person",
      }),
    ).toBeVisible();
    expect(within(nested).getAllByRole("heading", { level: 5 })).toHaveLength(1);
    expect(row().querySelector(".qm-request__severity")).toHaveTextContent("Critical");
  });
});

describe("#576 the skip reason of a part that was not run (design ruling 4)", () => {
  const skipped = (reasons: unknown[]): SubmitQueryResponse =>
    ({
      ...ACK,
      parts: [
        { ...VEH_PART, queryType: "PER", sourceIds: ["nationalSource"] },
        { ...WNT_PART, status: "skipped", sourceIds: [], skipReasons: reasons },
      ],
    }) as SubmitQueryResponse;

  it("a missing required field reads 'needs <field label>'", () => {
    setup(skipped([{ key: "validation.required", params: { field: "last" } }]), detail202(), {
      queryType: "PER",
      values: { first: "ZZTEST" },
    });
    expect(screen.getByText("Wanted check not run: needs last name.")).toBeVisible();
  });

  it("a plan reason is its own sentence, and several make one sentence each", () => {
    setup(
      skipped([
        { key: "validation.required", params: { field: "dob" } },
        { key: "plan.nestedNoSources" },
      ]),
      detail202(),
      { queryType: "PER", values: { last: "ZZTEST" } },
    );
    expect(
      screen.getByText(
        "Wanted check not run: needs date of birth. The linked query has no sources to run.",
      ),
    ).toBeVisible();
  });
});

describe("Q2 a publish re-maps an open card in place (spec 6.6)", () => {
  const add = (elements: Elements): Elements => [
    ...elements,
    { kind: "value", path: "make", labelKey: "field.description", view: "both", highlight: true },
  ];

  it("re-renders the card with the new mapping, keeping the card and focus in Plate", async () => {
    const { user, setConfig } = setup(
      ACK,
      detail([
        {
          ...VEH_PART,
          sources: [
            { sourceId: "stateSource", payload: { ...STOLEN, make: "TESTMAKE" } },
            { sourceId: "nationalSource", payload: STOLEN },
          ],
        },
      ]),
    );
    await user.click(screen.getByLabelText("Plate"));
    const card = screen.getByRole("region", { name: "State system: returned" });
    expect(within(card).queryByText("Description")).toBeNull();
    setConfig({ ...withMapping("veh-summary", add), configHash: "2".repeat(64) });
    const after = screen.getByRole("region", { name: "State system: returned" });
    expect(after).toBe(card);
    expect(within(after).getByText("Description")).toBeVisible();
    expect(within(after).getByText("TESTMAKE")).toBeVisible();
    expect(screen.getByLabelText("Plate")).toHaveFocus();
  });

  it("an open detail stays open, with focus on its toggle, across a re-map", async () => {
    const withDetail = (hash: string): ClientSiteConfig => ({
      ...withMapping("veh-summary", (elements) => [...elements, DETAIL_ROW]),
      configHash: hash,
    });
    const { user, setConfig } = setup(
      ACK,
      detail([{ ...VEH_PART, sources: [{ sourceId: "stateSource", payload: STOLEN }] }]),
      { config: withDetail("1".repeat(64)) },
    );
    await user.click(screen.getByRole("button", { name: /Show detail/ }));
    expect(screen.getByRole("button", { name: /Hide detail/ })).toHaveFocus();
    setConfig(withDetail("2".repeat(64)));
    expect(screen.getByRole("button", { name: /Hide detail/ })).toHaveFocus();
  });
});

describe("ruling 12 the toggle's hidden text names the source, type and primary typed field", () => {
  it("says which card it opens", () => {
    setup(ACK, detail([{ ...VEH_PART, sources: [{ sourceId: "stateSource", payload: STOLEN }] }]), {
      config: withMapping("veh-summary", (elements) => [...elements, DETAIL_ROW]),
    });
    expect(screen.getByRole("button", { name: /for State system, Vehicle ZZ-0001/ })).toBeVisible();
  });
});

describe("spec 4.2 the mapping's `when` reads canonical values, not raw typed text", () => {
  const config = {
    ...CLIENT_CONFIG,
    responseMappings: [
      {
        id: "veh-2026",
        queryType: "VEH",
        when: { field: "year", op: "eq", value: 2026 },
        elements: [
          {
            kind: "value",
            path: "status",
            labelKey: "mapping.status",
            view: "both",
            highlight: true,
          },
        ],
      },
      ...CLIENT_CONFIG.responseMappings,
    ],
  } as ClientSiteConfig;
  const NOW = Date.UTC(2026, 9, 13);
  const submitted = {
    queryType: "VEH",
    values: { plate: "ZZ-0001", year: "26" },
    sourceIds: [],
    mode: "normal" as const,
  };
  const ctx = (partValues: Readonly<Record<string, unknown>>) => ({
    queryType: "VEH",
    partValues,
    sourceId: "stateSource",
  });
  const payload = { status: "OK", plate: "ZZ-0001" };

  it("the raw two-digit year does not match, the canonical four-digit one does", () => {
    expect(mapResponse(config, ctx({ year: "26" }), payload, NOW).mappingIndex).not.toBe(0);
    const canonical = partValuesOf(
      { queryType: "VEH", parentPartId: null },
      submitted,
      config,
      NOW,
    );
    expect(canonical.year).toBe(2026);
    expect(mapResponse(config, ctx(canonical), payload, NOW).mappingIndex).toBe(0);
  });

  it("a nested part's values are the ones the server planned for it; the primary uses what it submitted (#633)", () => {
    const nested = { queryType: "WNT", parentPartId: 0, values: { last: "ZZTEST" } };
    expect(partValuesOf(nested, submitted, config, NOW)).toEqual({ last: "ZZTEST" });
    expect(partValuesOf({ ...nested, values: undefined }, submitted, config, NOW)).toEqual({});
    const primary = { queryType: "VEH", parentPartId: null, values: { plate: "NOT-USED" } };
    expect(partValuesOf(primary, submitted, config, NOW).plate).toBe("ZZ-0001");
  });

  it("only the primary part kept its values", () => {
    expect(partValuesOf({ queryType: "WNT", parentPartId: 0 }, submitted, config, NOW)).toEqual({});
    expect(partValuesOf({ queryType: "VEH", parentPartId: null }, undefined, config, NOW)).toEqual(
      {},
    );
  });
});

describe("#633 a nested part's mapping `when` reads the values the server planned for it", () => {
  // Per part, own values only (ruling 10-13-26): the primary's values and a sibling's never apply.
  const wantedByLast = (config: ClientSiteConfig): ClientSiteConfig => ({
    ...config,
    responseMappings: [
      {
        id: "wnt-zztest",
        queryType: "WNT",
        when: { field: "last", op: "eq", value: "ZZTEST" },
        elements: [
          {
            kind: "value",
            path: "conditionalMarker",
            labelKey: "field.description",
            view: "both",
            highlight: false,
          },
        ],
      },
      ...config.responseMappings,
    ],
  });
  const PER_ACK: SubmitQueryResponse = {
    ...ACK,
    parts: [{ ...VEH_PART, queryType: "PER", sourceIds: ["nationalSource"] }, WNT_PART],
  };
  const parts = (nested: { values?: Record<string, unknown>; purged?: boolean }) =>
    detail([
      {
        ...VEH_PART,
        queryType: "PER",
        sources: [{ sourceId: "nationalSource", payload: { status: "NO RECORD" } }],
      },
      {
        ...WNT_PART,
        ...nested,
        sources: [
          {
            sourceId: "nationalSource",
            payload: {
              status: "WANTED",
              remarks: "ZZ-DEFAULT-REMARKS",
              conditionalMarker: "ZZ-CONDITIONAL-REMARKS",
            },
          },
        ],
      },
    ]);
  const nestedCard = () => screen.getByRole("region", { name: /Wanted check, also run from/ });

  it("uses the conditional mapping when the detail's values for that part match", () => {
    setup(PER_ACK, parts({ values: { last: "ZZTEST" } }), {
      config: wantedByLast(CLIENT_CONFIG),
      queryType: "PER",
      values: { last: "OTHER" },
    });
    expect(within(nestedCard()).getByText("ZZ-CONDITIONAL-REMARKS")).toBeVisible();
  });

  it("falls back to the unconditional card when the detail carried no values for the part", () => {
    setup(PER_ACK, parts({}), {
      config: wantedByLast(CLIENT_CONFIG),
      queryType: "PER",
      values: { last: "ZZTEST" },
    });
    // the primary's submitted last name never stands in for the nested part's own values
    expect(within(nestedCard()).queryByText("ZZ-CONDITIONAL-REMARKS")).toBeNull();
  });

  it("falls back when the part was purged (no values), and a values mismatch does not match", () => {
    setup(PER_ACK, parts({ purged: true }), {
      config: wantedByLast(CLIENT_CONFIG),
      queryType: "PER",
    });
    expect(within(nestedCard()).queryByText("ZZ-CONDITIONAL-REMARKS")).toBeNull();
  });

  it("a mismatching planned value picks the unconditional card too", () => {
    setup(PER_ACK, parts({ values: { last: "OTHER" } }), {
      config: wantedByLast(CLIENT_CONFIG),
      queryType: "PER",
    });
    expect(within(nestedCard()).queryByText("ZZ-CONDITIONAL-REMARKS")).toBeNull();
  });

  it("a skipped nested part has no card, whatever values the detail holds", () => {
    const skipped: SubmitQueryResponse = {
      ...PER_ACK,
      parts: [
        { ...VEH_PART, queryType: "PER", sourceIds: ["nationalSource"] },
        {
          ...WNT_PART,
          status: "skipped",
          sourceIds: [],
          skipReasons: [{ key: "validation.required", params: { field: "dob" } }],
        },
      ],
    };
    setup(
      skipped,
      detail([
        {
          ...VEH_PART,
          queryType: "PER",
          sources: [{ sourceId: "nationalSource", payload: { status: "NO RECORD" } }],
        },
        { ...WNT_PART, sources: [], values: { last: "ZZTEST" } },
      ]),
      { config: wantedByLast(CLIENT_CONFIG), queryType: "PER" },
    );
    expect(screen.queryByText("ZZ-CONDITIONAL-REMARKS")).toBeNull();
  });
});

describe("payloads are memory only (spec 6.7)", () => {
  it("sign-out empties the cards", () => {
    const { services } = setup(
      ACK,
      detail([{ ...VEH_PART, sources: [{ sourceId: "stateSource", payload: STOLEN }] }]),
    );
    expect(screen.getByRole("region", { name: "State system: returned" })).toBeVisible();
    act(() => services.reset.resetAll());
    expect(screen.queryByRole("region", { name: /: returned$/ })).toBeNull();
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("STOLEN");
  });
});
