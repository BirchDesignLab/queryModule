import type { ConfigChange } from "@querymodule/core/config";
import { diffConfig } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import {
  buildChangeGroups,
  type ChangeDeps,
  labelGroup,
  missingLabels,
  ownerName,
  targetOf,
} from "./changes.js";

const t: ChangeDeps["t"] = (key, params) =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;
const deps: ChangeDeps = {
  t,
  labelText: (k) => (k === "q.veh" ? "Vehicle" : k === "f.plate" ? "Plate" : ""),
  itemName: (k) => `item:${k}`,
};

const live = () => ({
  queryTypes: [
    {
      code: "VEH",
      labelKey: "q.veh",
      fields: [
        { key: "plate", labelKey: "f.plate", required: true },
        { key: "state", labelKey: "f.state", required: false },
      ],
      sections: [{ key: "base", labelKey: "s.base" }],
      rules: [{ field: "state", effect: "show", when: { field: "plate", op: "notEmpty" } }],
      sources: [{ sourceId: "mock", selectedByDefault: true }],
    },
    { code: "PER", labelKey: "q.per", fields: [{ key: "name", labelKey: "f.name" }], rules: [] },
  ],
  picklists: [{ id: "states", values: [{ code: "TX", labelKey: "v.tx", enabled: true }] }],
  commands: [{ code: "VEH", queryType: "VEH", positions: ["plate"] }],
  quickAccess: ["VEH", "PER"],
  terminal: { delimiter: "." },
});

const groupsFor = (edit: (d: ReturnType<typeof live>) => void) => {
  const l = live();
  const d = live();
  edit(d);
  return buildChangeGroups(diffConfig(l, d), l, d, deps);
};
const entries = (g: ReturnType<typeof groupsFor>) =>
  g.flatMap((x) => x.sections.flatMap((s) => s.entries));

describe("buildChangeGroups", () => {
  it("is empty when nothing differs", () => {
    expect(groupsFor(() => undefined)).toEqual([]);
  });

  it("groups a field edit under its query type and field, with plain names and old and new values", () => {
    const groups = groupsFor((d) => {
      (d.queryTypes[0]?.fields[1] as { required: boolean }).required = true;
    });
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group).toMatchObject({ title: "Vehicle", keyText: "VEH" });
    const [section] = group?.sections ?? [];
    expect(section).toMatchObject({ keyText: "state" });
    expect(section?.title).toContain("admin.diff.fieldOf");
    expect(section?.entries).toEqual([
      expect.objectContaining({
        kind: "changed",
        what: "admin.config.field.required",
        keyText: "state required",
        before: { text: "admin.config.no" },
        after: { text: "admin.config.yes" },
        target: "/queryTypes/0/fields/1",
      }),
    ]);
  });

  it("names an added and a removed field without values", () => {
    const added = entries(
      groupsFor((d) => {
        d.queryTypes[1]?.fields.push({ key: "dob", labelKey: "f.dob", required: false });
      }),
    );
    expect(added).toEqual([
      expect.objectContaining({
        kind: "added",
        what: "admin.diff.item.field",
        target: "/queryTypes/1/fields/1",
      }),
    ]);
    const removed = groupsFor((d) => {
      d.queryTypes[0]?.fields.pop();
    });
    expect(entries(removed)[0]).toMatchObject({ kind: "removed", target: "/queryTypes/0" });
    expect(entries(removed)[0]).not.toHaveProperty("after");
  });

  it("reports a removed query type in its own group and opens the first type", () => {
    const groups = groupsFor((d) => {
      d.queryTypes.shift();
    });
    expect(groups.map((g) => g.id)).toEqual(["type:VEH"]);
    expect(entries(groups)[0]).toMatchObject({
      kind: "removed",
      what: "admin.diff.item.queryType",
      target: "/queryTypes/0",
    });
  });

  it("reports an edited rule once, as the rule before and after", () => {
    const groups = groupsFor((d) => {
      const rule = d.queryTypes[0]?.rules[0] as { effect: string; when: { op: string } };
      rule.effect = "hide";
      rule.when.op = "empty";
    });
    const rules = entries(groups);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      kind: "changed",
      what: "admin.diff.item.rule",
      before: { rule: { effect: "show" } },
      after: { rule: { effect: "hide" } },
      target: "/queryTypes/0",
    });
  });

  it("groups picklist values, commands and quick access", () => {
    const groups = groupsFor((d) => {
      (d.picklists[0]?.values[0] as { enabled: boolean }).enabled = false;
      d.picklists[0]?.values.push({ code: "NM", labelKey: "v.nm", enabled: true });
      (d.commands[0] as { positions: string[] }).positions = ["plate", "state"];
      d.quickAccess = ["PER"];
    });
    expect(groups.map((g) => g.id)).toEqual([
      "picklists:states",
      "commands:VEH",
      "site:quickAccess",
    ]);
    expect(groups[0]?.sections.map((s) => s.id)).toEqual(["value:TX", "value:NM"]);
    expect(entries(groups).at(-1)).toMatchObject({
      kind: "removed",
      what: "admin.diff.item.button",
    });
  });

  it("navigates to the item, never to a leaf the editor has no place for", () => {
    const l = live();
    expect(targetOf("/queryTypes/1/fields/0/required", l)).toBe("/queryTypes/1/fields/0");
    expect(targetOf("/queryTypes/1/rules/0/effect", l)).toBe("/queryTypes/1");
    expect(targetOf("/commands/0/positions", l)).toBe("/commands");
    expect(targetOf("", l)).toBeNull();
  });

  it("keeps every entry id unique", () => {
    const groups = groupsFor((d) => {
      d.queryTypes[0]?.fields.reverse();
      d.quickAccess = ["X", "Y", "Z"];
    });
    const ids = entries(groups).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("labels", () => {
  it("lists overlay texts: changed when the shipped text is known and differs, else added", () => {
    const g = labelGroup(
      [
        { locale: "en", key: "f.plate", text: "Licence plate", shipped: "Plate" },
        { locale: "fr", key: "f.plate", text: "Plaque", shipped: null },
      ],
      (l) => l,
      t,
    );
    expect(g?.sections[0]?.entries).toEqual([
      expect.objectContaining({ kind: "changed", before: { text: "Plate" }, keyText: "f.plate" }),
      expect.objectContaining({ kind: "added", after: { text: "Plaque" }, target: "#labels" }),
    ]);
    expect(labelGroup([], (l) => l, t)).toBeNull();
  });

  it("lists a missing label key once, with every language it lacks", () => {
    const d = live();
    const rows = missingLabels(
      [
        { labelKey: "f.state", locale: "en", pointer: "/queryTypes/0/fields/1/labelKey" },
        { labelKey: "f.state", locale: "fr", pointer: "/queryTypes/0/fields/1/labelKey" },
      ],
      d,
      (l) => l.toUpperCase(),
      (p) => ownerName(d, p, deps),
    );
    expect(rows).toEqual([
      {
        owner: "state",
        labelKey: "f.state",
        languages: ["EN", "FR"],
        target: "/queryTypes/0/fields/1",
      },
    ]);
  });
});

it("ConfigChange is what the core diff exports", () => {
  const change: ConfigChange | undefined = diffConfig({ a: 1 }, { a: 2 })[0];
  expect(change?.kind).toBe("changed");
});
