import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyChanges, type ConfigChange, diffConfig } from "./diff";

/** Small alphabets, so two independent documents share keys and items and the diff has matches. */
const code = fc.constantFrom("VEH", "PER", "PRO", "GUN");
const word = fc.constantFrom("a", "b", "c", "d");
const scalar = fc.oneof(word, fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.constant(null));

const fieldArb = fc.record(
  { key: word, labelKey: word, required: fc.boolean(), maxLength: fc.integer({ min: 1, max: 3 }) },
  { requiredKeys: ["key"] },
);
const ruleArb = fc.record({
  field: word,
  effect: fc.constantFrom("show", "hide", "require"),
  when: fc.record({ field: word, op: fc.constantFrom("eq", "neq"), value: scalar }),
});
const uniqueBy = <T>(arb: fc.Arbitrary<T[]>, pick: (item: T) => string) =>
  arb.map((items) => {
    const seen = new Set<string>();
    return items.filter((i) => !seen.has(pick(i)) && seen.add(pick(i)));
  });
const typeArb = fc.record({
  code,
  labelKey: word,
  fields: uniqueBy(fc.array(fieldArb, { maxLength: 4 }), (f) => f.key),
  // Rules have no identity of their own and may repeat.
  rules: fc.array(ruleArb, { maxLength: 4 }),
});
const configArb = fc.record({
  queryTypes: uniqueBy(fc.array(typeArb, { maxLength: 3 }), (t) => t.code),
  quickAccess: fc.array(word, { maxLength: 4 }),
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
