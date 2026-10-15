import type { RequestEntry, SubmittedQuery } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { editAsNewNote, planEditAsNew, submittedOf } from "./edit-as-new.js";

// Edit as new query (#477): what a 409 row kept is loaded into the form under the config the panel
// has now. Whatever that config no longer has is dropped and named, never sent.

function submitted(over: Partial<SubmittedQuery> = {}): SubmittedQuery {
  return {
    queryType: "VEH",
    values: { plate: "ZZ-0001", state: "TX", year: "2024" },
    sourceIds: ["stateSource", "nationalSource"],
    mode: "full",
    ...over,
  } as SubmittedQuery;
}

/** The default site with edits applied to a deep copy. */
function configWith(edit: (config: ClientSiteConfig) => void): ClientSiteConfig {
  const copy = structuredClone(CLIENT_CONFIG);
  edit(copy);
  return copy;
}

describe("planEditAsNew", () => {
  it("keeps every value the current config still has, and the sources", () => {
    const plan = planEditAsNew(CLIENT_CONFIG, submitted());
    expect(plan.queryType).toBe("VEH");
    expect(plan.values).toEqual({ plate: "ZZ-0001", state: "TX", year: "2024" });
    expect(plan.sourceIds).toEqual(["stateSource", "nationalSource"]);
    expect(plan.dropped).toEqual([]);
  });

  it("drops a value whose field the config no longer has, and names the field", () => {
    const config = configWith((c) => {
      const vehicle = c.queryTypes.find((q) => q.code === "VEH");
      if (vehicle) vehicle.fields = vehicle.fields.filter((f) => f.key !== "year");
    });
    const plan = planEditAsNew(config, submitted());
    expect(plan.values).toEqual({ plate: "ZZ-0001", state: "TX" });
    expect(plan.dropped).toEqual([{ kind: "field", key: "year" }]);
  });

  it("drops a picklist value the config no longer offers, whatever its case, and keeps one it does", () => {
    const config = configWith((c) => {
      const list = c.picklists.find((p) => p.id === "state");
      if (list) list.values = list.values.filter((v) => v.code !== "TX");
    });
    const gone = planEditAsNew(config, submitted());
    expect(gone.values).toEqual({ plate: "ZZ-0001", year: "2024" });
    expect(gone.dropped).toEqual([{ kind: "choice", key: "state" }]);
    const kept = planEditAsNew(config, submitted({ values: { plate: "ZZ-0001", state: "ok" } }));
    expect(kept.values).toEqual({ plate: "ZZ-0001", state: "ok" });
    expect(kept.dropped).toEqual([]);
  });

  it("drops a picklist value the config disabled", () => {
    const config = configWith((c) => {
      const value = c.picklists.find((p) => p.id === "state")?.values.find((v) => v.code === "TX");
      if (value) value.enabled = false;
    });
    expect(planEditAsNew(config, submitted()).dropped).toEqual([{ kind: "choice", key: "state" }]);
  });

  it("an empty value is nothing to drop", () => {
    const config = configWith((c) => {
      const vehicle = c.queryTypes.find((q) => q.code === "VEH");
      if (vehicle) vehicle.fields = vehicle.fields.filter((f) => f.key !== "year");
    });
    const plan = planEditAsNew(config, submitted({ values: { plate: "ZZ-0001", year: "" } }));
    expect(plan.dropped).toEqual([]);
    expect(plan.values).toEqual({ plate: "ZZ-0001" });
  });

  it("a query type the config no longer has loads nothing and says so", () => {
    const config = configWith((c) => {
      c.queryTypes = c.queryTypes.filter((q) => q.code !== "VEH");
    });
    const plan = planEditAsNew(config, submitted());
    expect(plan.queryType).toBeNull();
    expect(plan.values).toEqual({});
    expect(plan.sourceIds).toEqual([]);
    expect(plan.dropped).toEqual([{ kind: "type", key: "VEH" }]);
  });

  it("drops a source the config no longer lists", () => {
    const config = configWith((c) => {
      c.sources = c.sources.filter((s) => s.id !== "nationalSource");
    });
    const plan = planEditAsNew(config, submitted());
    expect(plan.sourceIds).toEqual(["stateSource"]);
    expect(plan.dropped).toEqual([{ kind: "source", key: "nationalSource" }]);
  });

  it("does not change the row's own values", () => {
    const row = submitted();
    const config = configWith((c) => {
      const vehicle = c.queryTypes.find((q) => q.code === "VEH");
      if (vehicle) vehicle.fields = vehicle.fields.filter((f) => f.key !== "year");
    });
    planEditAsNew(config, row);
    expect(row.values).toEqual({ plate: "ZZ-0001", state: "TX", year: "2024" });
  });
});

describe("editAsNewNote", () => {
  const messages: Record<string, string> = {
    "field.year": "Year",
    "field.state": "State",
    "editAsNew.dropped": "Not loaded, because the site configuration no longer has them: {items}.",
    "editAsNew.item.field": "{label}",
    "editAsNew.item.choice": "{label} (that choice is no longer offered)",
    "editAsNew.item.type": "the {type} query type",
    "editAsNew.item.source": "a source",
  };
  const t = (key: string, params?: Readonly<Record<string, string | number | boolean>>) =>
    Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      messages[key] ?? key,
    );

  it("is null when nothing was dropped", () => {
    expect(
      editAsNewNote(
        [],
        t,
        (key) => key,
        (code) => code,
      ),
    ).toBeNull();
  });

  it("names each dropped field, choice, type and source in words, never a value", () => {
    const note = editAsNewNote(
      [
        { kind: "field", key: "year" },
        { kind: "choice", key: "state" },
        { kind: "source", key: "nationalSource" },
        { kind: "type", key: "VEH" },
      ],
      t,
      (key) => (t(`field.${key}`) === `field.${key}` ? key : t(`field.${key}`)),
      (code) => (code === "VEH" ? "Vehicle" : code),
    );
    expect(note).toBe(
      "Not loaded, because the site configuration no longer has them: Year, State (that choice is no longer offered), a source, the Vehicle query type.",
    );
  });
});

describe("submittedOf (G32: Edit as new query on every row)", () => {
  const primary = {
    partId: 1,
    parentPartId: null,
    queryType: "VEH",
    status: "dispatched",
    droppedSourceIds: [],
    sources: [
      { sourceId: "stateSource", status: "returned" },
      { sourceId: "nationalSource", status: "pending" },
    ],
    values: { plate: "ZZ-0001", state: "TX", year: 2024, flag: true, nested: { a: 1 } },
  };
  const acknowledged = (over: Record<string, unknown> = {}): RequestEntry =>
    ({
      id: "r1",
      sentAt: 0,
      queryType: "VEH",
      summary: "",
      status: "acknowledged",
      correlationId: "c1",
      acknowledgedAt: 1,
      parts: [primary],
      ...over,
    }) as unknown as RequestEntry;

  it("a row this browser sent keeps what it sent", () => {
    const kept = submitted();
    expect(submittedOf(acknowledged({ submitted: kept }))).toBe(kept);
  });

  it("a row listed after a reload is rebuilt from its primary part's planned values and its sources", () => {
    expect(submittedOf(acknowledged())).toEqual({
      queryType: "VEH",
      values: { plate: "ZZ-0001", state: "TX", year: "2024", flag: true },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
  });

  it("sources the planner dropped before dispatch were still the user's choice", () => {
    const row = acknowledged({
      parts: [{ ...primary, droppedSourceIds: ["nationalSource"], sources: [primary.sources[0]] }],
    });
    expect(submittedOf(row)?.sourceIds).toEqual(["stateSource", "nationalSource"]);
  });

  it("takes the primary part, not a nested one", () => {
    const nested = { ...primary, partId: 2, parentPartId: 1, queryType: "WNT", values: { q: "x" } };
    expect(submittedOf(acknowledged({ parts: [nested, primary] }))?.values).toMatchObject({
      plate: "ZZ-0001",
    });
  });

  it("is undefined while the values have not arrived, for a purged part and for a row still sending", () => {
    expect(
      submittedOf(acknowledged({ parts: [{ ...primary, values: undefined }] })),
    ).toBeUndefined();
    expect(submittedOf(acknowledged({ parts: [] }))).toBeUndefined();
    expect(
      submittedOf({ id: "r2", sentAt: 0, queryType: "VEH", summary: "", status: "sending" }),
    ).toBeUndefined();
  });
});
