import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// Task 31 part 2 PR2 (#355): rules and conditions, exactly the site-config rule schema (spec 4.2).

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}

type Opened = Awaited<ReturnType<typeof openBuilder>>;

/** Enters text as one paste: each keystroke re-renders the open type, slow in jsdom under load. */
/**
 * A fieldset by its legend text (first match). getByRole("group", { name }) computes accessible
 * names over the whole editor DOM and dominated these tests under full-suite load.
 */
function group(root: ParentNode, name: string | RegExp): HTMLElement {
  const legend = [...root.querySelectorAll("legend")].find((l) => {
    const text = (l.textContent ?? "").trim();
    return typeof name === "string" ? text === name : name.test(text);
  });
  const box = legend?.closest("fieldset");
  if (box === null || box === undefined) throw new Error(`no group named ${String(name)}`);
  return box;
}

async function fill(t: Opened, el: HTMLElement, text: string) {
  await t.user.click(el);
  await t.user.paste(text);
}
type Rule = { field: string; when: unknown; effect: string; value?: unknown };
type QueryType = { code: string; rules: Rule[]; sections: { key: string; when?: unknown }[] };

const types = (t: Opened) =>
  (configDraftStore(t.services).getState().doc as { queryTypes: QueryType[] }).queryTypes;
const rulesOf = (t: Opened, code: string) =>
  (types(t).find((q) => q.code === code) as QueryType).rules;

async function openType(t: Opened, code: string) {
  await t.user.click(await screen.findByText("queryTypes", { selector: "summary" }));
  await t.user.click(screen.getByText(`Query type ${code}`, { selector: "summary" }));
  return group(document, `Query type ${code}`);
}

const ruleBox = (type: HTMLElement, n: number) => group(type, `Rule ${n}`);
/** The rule's own condition group (the first "Condition" group inside it). */
const conditionOf = (rule: HTMLElement) => group(rule, /^Condition/);

describe("rules editor (Task 31 part 2, spec 4.2, FR-060, UX-004)", () => {
  it("shows a rule's target, effect and a $default comparison", async () => {
    const t = await openBuilder();
    const rule = ruleBox(await openType(t, "VEH"), 1);
    expect(within(rule).getByLabelText("Target field")).toHaveValue("plateType");
    expect(within(rule).getByLabelText("Effect")).toHaveValue("show");
    const cond = conditionOf(rule);
    expect(within(cond).getByLabelText("Condition type")).toHaveValue("leaf");
    expect(within(cond).getByLabelText("Field")).toHaveValue("state");
    expect(within(cond).getByLabelText("Operator")).toHaveValue("neq");
    expect(within(cond).getByLabelText("Compare with")).toHaveValue("default");
    expect(within(cond).getByLabelText("Default of field")).toHaveValue("state");
  });

  it("setDefault takes a value; another effect drops it", async () => {
    const t = await openBuilder();
    const rule = ruleBox(await openType(t, "VEH"), 1);
    await t.user.selectOptions(within(rule).getByLabelText("Effect"), "setDefault");
    await fill(t, within(ruleBox(typeBoxOf("VEH"), 1)).getByLabelText("Default value"), "PC");
    expect(rulesOf(t, "VEH")[0]).toMatchObject({ effect: "setDefault", value: "PC" });
    await t.user.selectOptions(
      within(ruleBox(typeBoxOf("VEH"), 1)).getByLabelText("Effect"),
      "require",
    );
    expect(rulesOf(t, "VEH")[0]?.effect).toBe("require");
    expect("value" in (rulesOf(t, "VEH")[0] as object)).toBe(false);
  });

  it("adds a rule to a type with none, and focuses its target", async () => {
    const t = await openBuilder();
    const type = await openType(t, "WNT");
    await t.user.click(within(type).getByRole("button", { name: "Add rule" }));
    expect(rulesOf(t, "WNT")).toEqual([
      { field: "last", when: { field: "last", op: "notEmpty" }, effect: "show" },
    ]);
    expect(within(ruleBox(typeBoxOf("WNT"), 1)).getByLabelText("Target field")).toHaveFocus();
  });

  it("a leaf becomes All of (wrapping it), gains a second condition, and back", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    const cond = () => conditionOf(ruleBox(typeBoxOf("VEH"), 1));
    await t.user.selectOptions(
      within(cond()).getAllByLabelText("Condition type")[0] as HTMLElement,
      "all",
    );
    const leaf = { field: "state", op: "neq", value: { $default: "state" } };
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({ all: [leaf] });
    await t.user.click(within(cond()).getByRole("button", { name: "Add condition" }));
    expect(rulesOf(t, "VEH")[0]?.when).toMatchObject({ all: [leaf, { op: "notEmpty" }] });
    await t.user.selectOptions(
      within(cond()).getAllByLabelText("Condition type")[0] as HTMLElement,
      "not",
    );
    // #388 M3: Not wraps the whole group.
    expect(rulesOf(t, "VEH")[0]?.when).toMatchObject({ not: { all: [leaf, { op: "notEmpty" }] } });
    await t.user.selectOptions(
      within(cond()).getAllByLabelText("Condition type")[0] as HTMLElement,
      "leaf",
    );
    expect(rulesOf(t, "VEH")[0]?.when).toEqual(leaf);
  });

  it("operators reshape the value: one of takes a list, empty takes none", async () => {
    const t = await openBuilder();
    await openType(t, "PRO");
    const cond = () => conditionOf(ruleBox(typeBoxOf("PRO"), 2));
    expect(rulesOf(t, "PRO")[1]?.when).toEqual({
      field: "propertyType",
      op: "eq",
      value: "FIREARM",
    });
    await t.user.selectOptions(within(cond()).getByLabelText("Operator"), "in");
    expect(rulesOf(t, "PRO")[1]?.when).toMatchObject({ op: "in", value: ["FIREARM"] });
    await t.user.click(within(cond()).getByRole("button", { name: "Add value" }));
    await fill(t, within(cond()).getByLabelText("Value 2"), "VEHICLE");
    expect(rulesOf(t, "PRO")[1]?.when).toMatchObject({ value: ["FIREARM", "VEHICLE"] });
    await t.user.selectOptions(within(cond()).getByLabelText("Operator"), "empty");
    expect(rulesOf(t, "PRO")[1]?.when).toEqual({ field: "propertyType", op: "empty" });
  });

  it("compare with a literal or a field's default", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    const cond = () => conditionOf(ruleBox(typeBoxOf("VEH"), 1));
    await t.user.selectOptions(within(cond()).getByLabelText("Compare with"), "value");
    // Critic I1: no silent "" literal; the missing value is reported at the control.
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({ field: "state", op: "neq" });
    await fill(t, within(cond()).getByLabelText("Value"), "TX");
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({ field: "state", op: "neq", value: "TX" });
    await t.user.selectOptions(within(cond()).getByLabelText("Compare with"), "default");
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({
      field: "state",
      op: "neq",
      value: { $default: "state" },
    });
  });

  it("removes and reorders rules", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    await t.user.click(
      within(ruleBox(typeBoxOf("VEH"), 3)).getByRole("button", { name: "Move up rule 3" }),
    );
    expect(rulesOf(t, "VEH").map((r) => r.field)).toEqual(["plateType", "plateColor", "plateType"]);
    await t.user.click(
      within(ruleBox(typeBoxOf("VEH"), 1)).getByRole("button", { name: "Remove rule 1" }),
    );
    expect(rulesOf(t, "VEH")).toHaveLength(2);
  });

  it("a setDefault rule without a value shows its diagnostic on the rule", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    await t.user.selectOptions(
      within(ruleBox(typeBoxOf("VEH"), 1)).getByLabelText("Effect"),
      "setDefault",
    );
    const value = within(ruleBox(typeBoxOf("VEH"), 1)).getByLabelText("Default value");
    await waitFor(() => expect(value).toHaveAttribute("aria-invalid", "true"));
    expect(value).toHaveAccessibleDescription(/^Error:/);
  });

  it("a section condition can be added and removed", async () => {
    const t = await openBuilder();
    const type = await openType(t, "PER");
    const section = group(type, "Section base");
    await t.user.click(within(section).getByRole("button", { name: "Add condition" }));
    const per = () => types(t).find((q) => q.code === "PER") as QueryType;
    expect(per().sections[0]?.when).toEqual({ field: "last", op: "notEmpty" });
    await t.user.click(
      within(group(typeBoxOf("PER"), "Section base")).getByRole("button", {
        name: "Remove condition",
      }),
    );
    expect(per().sections[0] && "when" in per().sections[0]).toBe(false);
  });
});

describe("#388 diagnostics polish", () => {
  it("issue messages carry their level as text", async () => {
    const t = await openBuilder();
    await openType(t, "WNT");
    const key = within(group(typeBoxOf("WNT"), "Field first")).getByLabelText("Key");
    await t.user.clear(key);
    await waitFor(() => expect(key).toHaveAttribute("aria-invalid", "true"));
    expect(key).toHaveAccessibleDescription(/^Error:/);
  });
});

function typeBoxOf(code: string) {
  return group(document, `Query type ${code}`);
}

describe("PR2 critic fixes", () => {
  it("I1/I2: a leaf re-points its $default on a field change; a number literal is typed", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    const cond = () => conditionOf(ruleBox(typeBoxOf("VEH"), 1));
    await t.user.selectOptions(within(cond()).getByLabelText("Field"), "year");
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({
      field: "year",
      op: "neq",
      value: { $default: "year" },
    });
    await t.user.selectOptions(within(cond()).getByLabelText("Compare with"), "value");
    await t.user.click(within(cond()).getByLabelText("Value"));
    await t.user.paste("2020");
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({ field: "year", op: "neq", value: 2020 });
  });

  it("I2: a target change to another value kind drops the rule value", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    const rule = () => ruleBox(typeBoxOf("VEH"), 1);
    await t.user.selectOptions(within(rule()).getByLabelText("Effect"), "setDefault");
    await t.user.click(within(rule()).getByLabelText("Default value"));
    await t.user.paste("PC");
    await t.user.selectOptions(within(rule()).getByLabelText("Target field"), "year");
    expect(rulesOf(t, "VEH")[0]).toMatchObject({ field: "year", effect: "setDefault" });
    expect("value" in (rulesOf(t, "VEH")[0] as object)).toBe(false);
  });

  it("I3: a stray value on a non-setDefault rule stays visible with its diagnostic", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    act(() =>
      configDraftStore(t.services).getState().setPath(["queryTypes", 0, "rules", 0, "value"], "X"),
    );
    const value = within(ruleBox(typeBoxOf("VEH"), 1)).getByLabelText("Default value");
    expect(value).toHaveValue("X");
    await waitFor(() => expect(value).toHaveAttribute("aria-invalid", "true"));
  });

  it("I4: adding a section condition focuses its type; removing it focuses Add condition", async () => {
    const t = await openBuilder();
    await openType(t, "PER");
    const section = () => group(typeBoxOf("PER"), "Section base");
    await t.user.click(within(section()).getByRole("button", { name: "Add condition" }));
    expect(within(section()).getByLabelText("Condition type")).toHaveFocus();
    await t.user.click(within(section()).getByRole("button", { name: "Remove condition" }));
    expect(within(section()).getByRole("button", { name: "Add condition" })).toHaveFocus();
  });
});

describe("PR2 deferrals (#388 M3, M5, M6)", () => {
  it("M3: Not wraps a whole group; a single test keeps the first leaf found", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    const cond = () => conditionOf(ruleBox(typeBoxOf("VEH"), 1));
    const kind = () => within(cond()).getAllByLabelText("Condition type")[0] as HTMLElement;
    const leaf = { field: "state", op: "neq", value: { $default: "state" } };
    await t.user.selectOptions(kind(), "all");
    await t.user.click(within(cond()).getByRole("button", { name: "Add condition" }));
    await t.user.selectOptions(kind(), "not");
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({
      not: { all: [leaf, { field: "plate", op: "notEmpty" }] },
    });
    await t.user.selectOptions(kind(), "leaf");
    expect(rulesOf(t, "VEH")[0]?.when).toEqual(leaf);
  });

  it("M5: nested conditions are named by position path", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    const cond = () => conditionOf(ruleBox(typeBoxOf("VEH"), 1));
    await t.user.selectOptions(
      within(cond()).getAllByLabelText("Condition type")[0] as HTMLElement,
      "all",
    );
    const child = group(cond(), "Condition 1");
    await t.user.selectOptions(
      within(child).getAllByLabelText("Condition type")[0] as HTMLElement,
      "any",
    );
    expect(group(cond(), "Condition 1.1")).toBeTruthy();
    expect(within(cond()).getByRole("button", { name: "Remove condition 1.1" })).toBeTruthy();
  });

  it("M6: editor output passes validateSiteConfig with no new errors", async () => {
    const { validateDraft, flattenBundle } = await import("./draft.js");
    const { EN_BUNDLE } = await import("../test/en-bundle.js");
    const t = await openBuilder();
    const errors = () => {
      const v = validateDraft(
        configDraftStore(t.services).getState().doc as never,
        {},
        flattenBundle(EN_BUNDLE),
      );
      if (!v.ok) throw new Error(JSON.stringify(v.issues));
      return v.errors.length;
    };
    const base = errors();
    const type = await openType(t, "WNT");
    await t.user.click(within(type).getByRole("button", { name: "Add rule" }));
    const cond = () => conditionOf(ruleBox(typeBoxOf("WNT"), 1));
    await t.user.selectOptions(
      within(cond()).getAllByLabelText("Condition type")[0] as HTMLElement,
      "any",
    );
    await t.user.click(within(cond()).getByRole("button", { name: "Add condition" }));
    await t.user.selectOptions(
      within(ruleBox(typeBoxOf("WNT"), 1)).getByLabelText("Effect"),
      "require",
    );
    expect(errors()).toBe(base);
  });
});

describe("PR3b critic m3", () => {
  it("group -> not -> group does not nest deeper", async () => {
    const t = await openBuilder();
    await openType(t, "VEH");
    const kind = () =>
      within(conditionOf(ruleBox(typeBoxOf("VEH"), 1))).getAllByLabelText(
        "Condition type",
      )[0] as HTMLElement;
    const leaf = { field: "state", op: "neq", value: { $default: "state" } };
    await t.user.selectOptions(kind(), "all");
    await t.user.selectOptions(kind(), "not");
    await t.user.selectOptions(kind(), "any");
    expect(rulesOf(t, "VEH")[0]?.when).toEqual({ any: [leaf] });
  });
});
