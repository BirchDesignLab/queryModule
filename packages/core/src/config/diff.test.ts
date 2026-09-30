import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyChanges, type ConfigChange, diffConfig, VALUE_IDENTITY } from "./diff";

/** Small alphabets, so two independent documents share keys and items and the diff has matches. */
// "" is a new item whose code or key is not typed yet: several may exist at once.
const code = fc.constantFrom("VEH", "PER", "PRO", "GUN", "");
const word = fc.constantFrom("a", "b", "c", "d", "");
const scalar = fc.oneof(word, fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.constant(null));

const fieldArb = fc.record(
  { key: word, labelKey: word, required: fc.boolean(), maxLength: fc.integer({ min: 1, max: 3 }) },
  { requiredKeys: ["key"] },
);
type Cond = { [key: string]: unknown };
const leafArb = fc.record({ field: word, op: fc.constantFrom("eq", "neq"), value: scalar });
/** Conditions nest: all, any and not around leaves. */
const conditionArb = fc.letrec<{ cond: Cond }>((tie) => ({
  cond: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    leafArb,
    fc.record({ all: fc.array(tie("cond"), { maxLength: 2 }) }),
    fc.record({ any: fc.array(tie("cond"), { maxLength: 2 }) }),
    fc.record({ not: tie("cond") }),
  ),
})).cond;
const ruleArb = fc.record({
  field: word,
  effect: fc.constantFrom("show", "hide", "require"),
  when: conditionArb,
});
const uniqueBy = <T>(arb: fc.Arbitrary<T[]>, pick: (item: T) => string) =>
  arb.map((items) => {
    const seen = new Set<string>();
    return items.filter((i) => pick(i) === "" || (!seen.has(pick(i)) && seen.add(pick(i))));
  });
const typeArb = fc.record({
  code,
  labelKey: word,
  fields: uniqueBy(fc.array(fieldArb, { maxLength: 4 }), (f) => f.key),
  // Rules have no identity of their own and may repeat.
  rules: fc.array(ruleArb, { maxLength: 4 }),
});
/** Commands and response mappings carry two properties that could name them (an id or code, and a queryType). */
const commandArb = fc.record({ code, queryType: code, presets: fc.dictionary(word, scalar) });
const mappingArb = fc.record(
  { id: word, queryType: code, sourceId: word },
  { requiredKeys: ["id", "queryType"] },
);
/** Codes and keys may repeat (a typed duplicate): the lists are then matched by equality. */
const dupConfigArb = fc.record({
  queryTypes: fc.array(typeArb, { maxLength: 3 }),
  quickAccess: fc.array(word, { maxLength: 4 }),
  commands: fc.array(commandArb, { maxLength: 3 }),
  responseMappings: fc.array(mappingArb, { maxLength: 3 }),
});
const configArb = fc.record({
  queryTypes: uniqueBy(fc.array(typeArb, { maxLength: 3 }), (t) => t.code),
  // Unique strings are matched by value; a repeat (below and in dupConfigArb) is matched by equality.
  quickAccess: fc.oneof(
    uniqueBy(fc.array(word, { maxLength: 4 }), (w) => w),
    fc.array(word, { maxLength: 4 }),
  ),
  commands: uniqueBy(fc.array(commandArb, { maxLength: 3 }), (c) => c.code),
  responseMappings: fc.array(mappingArb, { maxLength: 3 }),
  terminal: fc.record({ delimiter: word }, { requiredKeys: [] }),
  defaults: fc.dictionary(word, scalar),
});

/** Deep freeze: a diff or an apply that writes to its input throws in strict mode. */
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Key order in an object never matters; array order does. */
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : typeof v === "object" && v !== null
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, canon(x)]),
        )
      : v;

describe("diffConfig properties", () => {
  it("diff(x, x) is empty", () => {
    fc.assert(
      fc.property(configArb, (x) => {
        expect(diffConfig(x, structuredClone(x))).toEqual([]);
      }),
    );
    fc.assert(
      fc.property(fc.jsonValue(), (x) => {
        expect(diffConfig(x, structuredClone(x))).toEqual([]);
      }),
    );
  });

  it("applying diff(live, draft) to live gives the draft", () => {
    fc.assert(
      fc.property(configArb, configArb, (live, draft) => {
        const l = freeze(structuredClone(live));
        const d = freeze(structuredClone(draft));
        expect(canon(applyChanges(l, diffConfig(l, d)))).toEqual(canon(d));
      }),
      { numRuns: 500 },
    );
  });

  it("holds when codes, keys and blanks repeat (lists that cannot be matched by identity)", () => {
    fc.assert(
      fc.property(dupConfigArb, dupConfigArb, (live, draft) => {
        const l = freeze(structuredClone(live));
        const d = freeze(structuredClone(draft));
        expect(canon(applyChanges(l, diffConfig(l, d)))).toEqual(canon(d));
      }),
      { numRuns: 500 },
    );
  });

  it("holds when a kept type's rules and fields are edited, shuffled and dropped", () => {
    const edited = configArb
      .filter((c) => c.queryTypes.length > 0)
      .chain((live) =>
        fc
          .tuple(
            fc.shuffledSubarray(live.queryTypes[0]?.rules ?? []),
            fc.array(ruleArb, { maxLength: 2 }),
            fc.shuffledSubarray(live.queryTypes[0]?.fields ?? []),
            word,
            fc.boolean(),
          )
          .map(([rules, moreRules, fields, code, keep]) => {
            const first = live.queryTypes[0] as (typeof live.queryTypes)[number];
            const types = [...live.queryTypes];
            types[0] = {
              ...first,
              // A blank code being filled in on a kept type, or a filled one cleared.
              code: keep ? first.code : (code as typeof first.code),
              rules: [...rules, ...moreRules],
              fields: fields.map((f, i) => (i === 0 ? { ...f, required: !f.required } : f)),
            };
            return { live, draft: { ...live, queryTypes: types } };
          }),
      );
    fc.assert(
      fc.property(edited, ({ live, draft }) => {
        const l = freeze(structuredClone(live));
        const d = freeze(structuredClone(draft));
        expect(canon(applyChanges(l, diffConfig(l, d)))).toEqual(canon(d));
      }),
      { numRuns: 500 },
    );
  });

  it("holds for arbitrary JSON documents, whatever their shape", () => {
    fc.assert(
      fc.property(fc.object({ maxDepth: 3 }), fc.object({ maxDepth: 3 }), (live, draft) => {
        const l = freeze(structuredClone(live));
        const d = freeze(structuredClone(draft));
        expect(canon(applyChanges(l, diffConfig(l, d)))).toEqual(canon(d));
      }),
      { numRuns: 300 },
    );
  });

  it("holds when the draft is an edit of the live config (shuffle, drop, add, change)", () => {
    const edited = configArb.chain((live) =>
      fc
        .tuple(
          fc.shuffledSubarray(live.queryTypes, { minLength: 0 }),
          fc.array(typeArb, { maxLength: 2 }),
          fc.shuffledSubarray(live.quickAccess),
          word,
        )
        .map(([kept, added, quick, label]) => {
          const known = new Set(kept.map((t) => t.code));
          const types = [...kept, ...added.filter((t) => !known.has(t.code))].map((t, i) =>
            i === 0 ? { ...t, labelKey: label } : t,
          );
          return { live, draft: { ...live, queryTypes: types, quickAccess: quick } };
        }),
    );
    fc.assert(
      fc.property(edited, ({ live, draft }) => {
        const l = freeze(structuredClone(live));
        expect(canon(applyChanges(l, diffConfig(l, draft)))).toEqual(canon(draft));
      }),
      { numRuns: 500 },
    );
  });
});

describe("diffConfig entries", () => {
  const live = {
    queryTypes: [
      {
        code: "VEH",
        labelKey: "q.veh",
        fields: [
          { key: "plate", required: true },
          { key: "state", required: false },
        ],
        rules: [{ field: "state", effect: "show" }],
      },
      { code: "PER", labelKey: "q.per", fields: [{ key: "name" }], rules: [] },
    ],
    quickAccess: ["VEH", "PER"],
  };

  it("matches query types and fields by their key, not by position", () => {
    const draft = structuredClone(live);
    draft.queryTypes.shift(); // VEH removed: PER is now first
    const changes = diffConfig(live, draft);
    expect(changes).toEqual([
      expect.objectContaining({
        kind: "removed",
        path: ["queryTypes", { by: "code", is: "VEH" }],
        // The item is gone, so the entry points at what held it: the whole document.
        pointer: "",
      }),
    ]);
  });

  it("reports a changed value with its old and new value and the draft's pointer", () => {
    const draft = structuredClone(live);
    (draft.queryTypes[0]?.fields[1] as { required: boolean }).required = true;
    expect(diffConfig(live, draft)).toEqual([
      {
        kind: "changed",
        path: [
          "queryTypes",
          { by: "code", is: "VEH" },
          "fields",
          { by: "key", is: "state" },
          "required",
        ],
        pointer: "/queryTypes/0/fields/1/required",
        before: false,
        after: true,
      },
    ]);
  });

  it("reports an added field at its place in the draft", () => {
    const draft = structuredClone(live);
    draft.queryTypes[1]?.fields.unshift({ key: "dob", required: false });
    const [change, ...rest] = diffConfig(live, draft);
    expect(rest).toEqual([]);
    expect(change).toMatchObject({
      kind: "added",
      pointer: "/queryTypes/1/fields/0",
      after: { key: "dob" },
      index: 0,
    });
  });

  it("keeps matching by identity when a new item has no code yet", () => {
    // Live A, B, C; the draft drops C and adds a type whose code is still blank.
    const l = { types: [{ code: "A" }, { code: "B" }, { code: "C" }] };
    const d = { types: [{ code: "A" }, { code: "B" }, { code: "" }] };
    const changes = diffConfig(l, d);
    expect(changes.map((c) => c.kind).sort()).toEqual(["added", "removed"]);
    expect(changes.find((c) => c.kind === "removed")?.path).toEqual([
      "types",
      { by: "code", is: "C" },
    ]);
    expect(applyChanges(l, changes)).toEqual(d);
  });

  it("never matches an item with no code yet, on either side", () => {
    const l = { types: [{ code: "" }, { code: "A" }] };
    const d = { types: [{ code: "A" }, { code: "NEW" }] };
    const changes = diffConfig(l, d);
    expect(changes.map((c) => c.kind).sort()).toEqual(["added", "removed"]);
    expect(changes.find((c) => c.kind === "removed")?.path).toEqual(["types", 0]);
    expect(applyChanges(l, changes)).toEqual(d);
  });

  it("pairs an edited rule with its old self, not with a deleted neighbour", () => {
    const l = {
      rules: [
        { field: "a", value: 1 },
        { field: "b", value: 2 },
      ],
    };
    const d = { rules: [{ field: "b", value: 9 }] };
    const changes = diffConfig(l, d);
    expect(changes).toEqual([
      expect.objectContaining({ kind: "removed", path: ["rules", 0] }),
      expect.objectContaining({
        kind: "changed",
        path: ["rules", 1, "value"],
        before: 2,
        after: 9,
      }),
    ]);
    expect(applyChanges(l, changes)).toEqual(d);
  });

  it("reports a reordered keyed list as moved", () => {
    const draft = structuredClone(live);
    draft.queryTypes.reverse();
    const kinds = diffConfig(live, draft).map((c) => c.kind);
    expect(kinds).toEqual(["moved"]);
  });

  it("pairs an edited rule as a change, not a removal and an addition", () => {
    const draft = structuredClone(live);
    (draft.queryTypes[0]?.rules[0] as { effect: string }).effect = "hide";
    const changes = diffConfig(live, draft);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "changed",
      path: ["queryTypes", { by: "code", is: "VEH" }, "rules", 0, "effect"],
      pointer: "/queryTypes/0/rules/0/effect",
      before: "show",
      after: "hide",
    });
  });

  describe("lists of unique strings are keyed by value", () => {
    it("reads a reordered quick access list as moved, not as removals and additions", () => {
      const changes = diffConfig(
        { quickAccess: ["VEH", "PER", "GUN"] },
        { quickAccess: ["GUN", "VEH", "PER"] },
      );
      expect(changes).toEqual([
        expect.objectContaining({
          kind: "moved",
          path: ["quickAccess"],
          by: VALUE_IDENTITY,
          order: ["GUN", "VEH", "PER"],
        }),
      ]);
    });

    it("reads an added and a removed value by the value itself, with no in-place change", () => {
      const changes = diffConfig({ quickAccess: ["VEH", "PER"] }, { quickAccess: ["VEH", "GUN"] });
      expect(changes).toEqual([
        expect.objectContaining({
          kind: "removed",
          path: ["quickAccess", { by: VALUE_IDENTITY, is: "PER" }],
          before: "PER",
        }),
        expect.objectContaining({
          kind: "added",
          path: ["quickAccess", { by: VALUE_IDENTITY, is: "GUN" }],
          after: "GUN",
          index: 1,
        }),
      ]);
    });

    it("applies a move together with an addition and a removal", () => {
      const live = { quickAccess: ["VEH", "PER", "GUN"] };
      const draft = { quickAccess: ["GUN", "PRO", "VEH"] };
      expect(applyChanges(live, diffConfig(live, draft))).toEqual(draft);
    });

    it("falls back to equality when a value repeats or a list mixes strings with other values", () => {
      for (const [a, b] of [
        [["VEH", "VEH"], ["VEH"]],
        [["VEH", 1], ["VEH"]],
      ] as const) {
        const changes = diffConfig({ list: a }, { list: b });
        expect(changes.every((c) => c.path.every((seg) => typeof seg !== "object"))).toBe(true);
        expect(applyChanges({ list: a }, changes)).toEqual({ list: b });
      }
    });
  });

  it("keeps a command's positions matched by slot: their order is their meaning", () => {
    const live = { commands: [{ code: "V", queryType: "VEH", positions: ["plate", "state"] }] };
    const swapped = { commands: [{ code: "V", queryType: "VEH", positions: ["state", "plate"] }] };
    const keyed = (cs: ConfigChange[]) =>
      cs.some(
        (c) =>
          c.kind === "moved" ||
          c.path.some((seg) => typeof seg === "object" && seg.by === VALUE_IDENTITY),
      );
    expect(keyed(diffConfig(live, swapped))).toBe(false);
    const replaced = { commands: [{ code: "V", queryType: "VEH", positions: ["vin", "state"] }] };
    expect(diffConfig(live, replaced)).toEqual([
      expect.objectContaining({
        kind: "changed",
        path: ["commands", { by: "code", is: "V" }, "positions", 0],
        before: "plate",
        after: "vin",
      }),
    ]);
    for (const d of [swapped, replaced]) expect(applyChanges(live, diffConfig(live, d))).toEqual(d);
  });

  describe("one identity property per list", () => {
    const named = (seg: unknown) => typeof seg === "object" && seg !== null && "by" in seg;

    it("does not name response mappings from queryType or sourceId when their ids are duplicated", () => {
      const live = {
        responseMappings: [
          { id: "m", queryType: "VEH", sourceId: "s1" },
          { id: "m", queryType: "PER", sourceId: "s2" },
        ],
      };
      const draft = { responseMappings: [live.responseMappings[1]] };
      const changes = diffConfig(live, draft);
      expect(changes).toHaveLength(1);
      expect(changes.flatMap((c) => c.path).some(named)).toBe(false);
      expect(applyChanges(live, changes)).toEqual(draft);
    });

    it("does not name commands from queryType when their codes are duplicated", () => {
      const live = {
        commands: [
          { code: "V", queryType: "VEH" },
          { code: "V", queryType: "PER" },
        ],
      };
      const draft = { commands: [{ code: "V", queryType: "PER" }] };
      const changes = diffConfig(live, draft);
      expect(changes.flatMap((c) => c.path).some(named)).toBe(false);
      expect(applyChanges(live, changes)).toEqual(draft);
    });

    it("still names them by the first property once it is unique", () => {
      const live = {
        commands: [
          { code: "V", queryType: "VEH" },
          { code: "P", queryType: "VEH" },
        ],
      };
      const draft = { commands: [{ code: "P", queryType: "VEH" }] };
      expect(diffConfig(live, draft)).toEqual([
        expect.objectContaining({ kind: "removed", path: ["commands", { by: "code", is: "V" }] }),
      ]);
    });
  });

  it("escapes ~ and / in a pointer", () => {
    const changes = diffConfig({ "a/b": { "c~d": 1 } }, { "a/b": { "c~d": 2 } });
    expect(changes[0]?.pointer).toBe("/a~1b/c~0d");
  });

  it("does not treat a __proto__ key as a special property", () => {
    const draft = JSON.parse('{"__proto__": {"polluted": true}}') as object;
    const changes: ConfigChange[] = diffConfig({}, draft);
    const out = applyChanges({}, changes) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
  });
});
