import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { selectBuilderItem } from "../test/builder-tree.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// A-D2 A3: ruled sections with a label column, plain-language labels, keys only in hidden text,
// advanced settings collapsed (docs/design/2026-09-29-visual-system.md, Builder centre).

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
type Field = Record<string, unknown> & { key: string };
type QueryType = Record<string, unknown> & { code: string; fields: Field[] };
const state = (t: Opened) => configDraftStore(t.services).getState();
const typeOf = (t: Opened, code: string) =>
  (state(t).doc as { queryTypes: QueryType[] }).queryTypes.find(
    (q) => q.code === code,
  ) as QueryType;

/** A fieldset by its legend's full text (visible and hidden parts). */
function group(root: ParentNode, name: string | RegExp): HTMLElement {
  const legend = [...root.querySelectorAll("legend")].find((l) => {
    const text = (l.textContent ?? "").trim();
    return typeof name === "string" ? text === name : name.test(text);
  });
  const box = legend?.closest("fieldset");
  if (box === null || box === undefined) throw new Error(`no group named ${String(name)}`);
  return box;
}

const editor = () => document.querySelector(".qm-builder__editor") as HTMLElement;
const typeBox = (code: string) => group(document, `Query type ${code}`);
const fieldBox = (code: string, key: string) => group(typeBox(code), new RegExp(`field ${key}$`));
/** The ruled section headed `title` (h4), up to its container. */
function sect(root: ParentNode, title: string): HTMLElement {
  const h = [...root.querySelectorAll("h4")].find((x) => x.textContent === title);
  const box = h?.closest<HTMLElement>(".qm-sect");
  if (box === null || box === undefined) throw new Error(`no section ${title}`);
  return box;
}
const advanced = (root: HTMLElement) =>
  root.querySelector(":scope > .qm-advanced") as HTMLDetailsElement;

describe("A3 editor heading", () => {
  it("a query type reads as its plain name with the code in mono under a Query types crumb", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    const title = within(editor()).getByRole("heading", { level: 3 });
    expect(title).toHaveTextContent(/^Vehicle VEH/);
    expect(title.querySelector(".qm-tree__key")).toHaveTextContent("VEH");
    expect(editor().querySelector(".qm-editor__crumb")).toHaveTextContent("Query types");
  });

  it("a site item keeps its plain name under a Site crumb", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "picklists");
    const title = within(editor()).getByRole("heading", { level: 3 });
    expect(title).toHaveTextContent(/^Lists picklists/);
    expect(editor().querySelector(".qm-editor__crumb")).toHaveTextContent("Site");
  });
});

describe("A3 query type editor: ruled sections", () => {
  it("groups the type into labelled sections in order, Advanced settings last and closed", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    const box = typeBox("VEH");
    const titles = [...box.querySelectorAll(":scope > .qm-sect h4")].map((h) => h.textContent);
    expect(titles).toEqual(["Name", "Plate-only queries", "Form sections", "Fields", "Rules"]);
    const adv = advanced(box);
    expect(adv.open).toBe(false);
    expect(adv.querySelector("summary")).toHaveTextContent("Advanced settings");
    // The type's label key lives under Advanced; the code stays in Name.
    expect(within(adv).getByLabelText("Label key")).toHaveValue("queryType.VEH");
    expect(within(sect(box, "Name")).getByLabelText("Code")).toHaveValue("VEH");
    expect(adv).toHaveTextContent("/queryTypes/0");
  });

  it("a field reads as its label; its key is hidden text and sits under a closed Advanced", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    const box = fieldBox("VEH", "plate");
    const legend = box.querySelector("legend") as HTMLElement;
    const hidden = [...legend.querySelectorAll("span")].map((s) => s.textContent).join("");
    expect(legend.textContent?.replace(hidden, "").trim()).toBe("Plate");
    expect(hidden).toContain("plate");
    const adv = advanced(box);
    expect(adv.open).toBe(false);
    for (const label of ["Key", "Label key", "Letter case", "Allowed pattern"])
      expect(within(adv).getByLabelText(label)).toBeInTheDocument();
    expect(adv).toHaveTextContent("/queryTypes/0/fields/0");
    // Buttons say what they do; the key is only in their hidden text.
    const remove = within(box).getByRole("button", { name: "Remove field plate" });
    const shown = [...remove.childNodes]
      .filter((n) => !(n instanceof HTMLElement && n.style.position === "absolute"))
      .map((n) => n.textContent)
      .join("")
      .trim();
    expect(shown).toBe("Remove field");
  });

  it("input types read in plain words and still write the schema value", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "PER");
    const select = within(fieldBox("PER", "first")).getByLabelText("Input type");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Text", "Number", "Year", "Date", "Yes or no", "List"]);
    await t.user.selectOptions(select, "List");
    expect(typeOf(t, "PER").fields.find((f) => f.key === "first")?.dataType).toBe("picklist");
    expect(within(fieldBox("PER", "first")).getByLabelText("Choices come from")).toBeVisible();
  });

  it("a field's section select names sections by their label; the value is the key", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    const select = within(fieldBox("VEH", "vin")).getByLabelText("Appears in section");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["(none)", "Details", "More details"]);
    await t.user.selectOptions(select, "More details");
    expect(typeOf(t, "VEH").fields.find((f) => f.key === "vin")?.section).toBe("expanded");
  });

  it("a new field opens its Advanced settings (the key is blank) and focuses the key", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "WNT");
    await t.user.click(within(typeBox("WNT")).getByRole("button", { name: "Add field" }));
    const box = group(typeBox("WNT"), "New field");
    expect(advanced(box).open).toBe(true);
    expect(within(advanced(box)).getByLabelText("Key")).toHaveFocus();
  });

  it("Advanced opens while a setting in it has an issue", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "WNT");
    act(() => {
      const d = structuredClone(state(t).doc) as { queryTypes: QueryType[] };
      const wnt = d.queryTypes.find((q) => q.code === "WNT") as QueryType;
      (wnt.fields[0] as Field).pattern = "(";
      state(t).setDoc(d as never);
    });
    await waitFor(() => expect(advanced(fieldBox("WNT", "last")).open).toBe(true));
    expect(advanced(fieldBox("WNT", "first")).open).toBe(false);
  });

  it("stays open once the issue is fixed, with focus kept in its control", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "WNT");
    await t.user.click(within(typeBox("WNT")).getByRole("button", { name: "Add field" }));
    const box = group(typeBox("WNT"), "New field");
    const key = within(advanced(box)).getByLabelText("Key");
    expect(key).toHaveFocus();
    await t.user.paste("extra");
    const labelKey = within(advanced(box)).getByLabelText("Label key");
    await t.user.click(labelKey);
    await t.user.paste("field.last");
    // No blank key and no issue now: still open, focus still where the user is.
    const fieldBoxNow = fieldBox("WNT", "extra");
    expect(advanced(fieldBoxNow).open).toBe(true);
    expect(within(advanced(fieldBoxNow)).getByLabelText("Label key")).toHaveFocus();
  });

  it("the issue button reaches a control in an Advanced the user closed", async () => {
    const t = await openBuilder();
    const summary = screen.getByTestId("draft-summary");
    await waitFor(() => expect(summary).toHaveTextContent(/Draft checks: 0 errors/));
    await selectBuilderItem(t.user, "WNT");
    act(() => {
      const d = structuredClone(state(t).doc) as { queryTypes: QueryType[] };
      const wnt = d.queryTypes.find((q) => q.code === "WNT") as QueryType;
      (wnt.fields[0] as Field).pattern = "(";
      state(t).setDoc(d as never);
    });
    const adv = () => advanced(fieldBox("WNT", "last"));
    await waitFor(() => expect(adv().open).toBe(true));
    await t.user.click(adv().querySelector("summary") as HTMLElement);
    expect(adv().open).toBe(false);
    await t.user.click(
      screen.getByRole("button", { name: /^1 error, \d+ warnings?\. Go to the first issue\.$/ }),
    );
    const pattern = within(adv()).getByLabelText("Allowed pattern");
    await waitFor(() => expect(pattern).toHaveFocus());
    expect(adv().open).toBe(true);
  });
});

// A-D2 part 1b: the other editors in the same pattern.

const sentence = (root: HTMLElement) => root.querySelector(".qm-rule__sentence")?.textContent;

describe("A3 rules read as sentences (no new condition syntax)", () => {
  it("each rule states what it does in plain words, from the schema Condition", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    expect(sentence(group(typeBox("VEH"), "Rule 1"))).toBe(
      "Show Plate type when State is not its site default.",
    );
    expect(sentence(group(typeBox("VEH"), "Rule 2"))).toBe(
      "Require Plate type when State is not its site default.",
    );
    await selectBuilderItem(t.user, "PRO");
    expect(sentence(group(typeBox("PRO"), "Rule 1"))).toBe(
      "Show Make when Property type is one of Firearm, Electronics.",
    );
    await selectBuilderItem(t.user, "DL");
    expect(sentence(group(typeBox("DL"), "Rule 1"))).toBe(
      "Require License number when Last name is empty.",
    );
  });

  it("the sentence follows an edit; groups read with and / or", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    const rule = () => group(typeBox("VEH"), "Rule 1");
    await t.user.selectOptions(within(rule()).getByLabelText("Effect"), "hide");
    await t.user.selectOptions(within(rule()).getByLabelText("Condition type"), "any");
    expect(sentence(rule())).toBe("Hide Plate type when State is not its site default.");
    await t.user.click(within(rule()).getByRole("button", { name: "Add condition" }));
    expect(sentence(rule())).toMatch(
      /^Hide Plate type when State is not its site default or .+\.$/,
    );
  });

  it("field selects in rules name fields by their label; the value is the key", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    const target = within(group(typeBox("VEH"), "Rule 1")).getByLabelText("Target field");
    expect(within(target).getByRole("option", { name: "Plate type" })).toHaveValue("plateType");
  });

  it("a section's condition reads as a sentence too", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "PER");
    const base = group(typeBox("PER"), /section base$/);
    await t.user.click(within(base).getByRole("button", { name: "Add condition" }));
    expect(sentence(group(typeBox("PER"), /section base$/))).toBe(
      "Shown when Last name is filled in.",
    );
  });
});

describe("A3 terminal commands and quick access in plain words", () => {
  it("query type and field selects name types and fields; values stay codes and keys", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "commands");
    const veh = group(editor(), "Command VEH");
    const type = within(veh).getByLabelText("Query type");
    expect(within(type).getByRole("option", { name: "Vehicle (VEH)" })).toHaveValue("VEH");
    const first = group(veh, "Position 1");
    const field = within(first).getByLabelText("Field");
    expect(within(field).getByRole("option", { name: "Plate" })).toHaveValue("plate");
    await selectBuilderItem(t.user, "quickAccess");
    const slot = within(editor()).getByLabelText("Button 1");
    expect(within(slot).getByRole("option", { name: "Vehicle (VEH)" })).toHaveValue("VEH");
  });
});

describe("A3 lists", () => {
  it("a value's label key sits under a closed Advanced; code, label and enabled stay in view", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "picklists");
    const value = group(group(editor(), "Picklist sex"), "Value F");
    const adv = advanced(value);
    expect(adv.open).toBe(false);
    expect(within(adv).getByLabelText("Label key")).toBeInTheDocument();
    expect(adv.contains(within(value).getByLabelText("Code"))).toBe(false);
    expect(adv.contains(within(value).getByLabelText("Label (en)"))).toBe(false);
  });
});

describe("A3 generic form in plain words", () => {
  it("a setting reads as its name; the config path is a hidden description, not in the name (B1)", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "delegation");
    const input = within(editor()).getByLabelText(/^Max duration minutes/);
    const label = document.querySelector(`label[for="${input.id}"]`) as HTMLElement;
    expect(label.textContent).toBe("Max duration minutes");
    expect(input).toHaveAccessibleName("Max duration minutes");
    expect(input).toHaveAccessibleDescription("Setting: delegation.maxDurationMinutes");
  });
});

describe("A3 Advanced keeps its state across a move (critic, part 1a)", () => {
  it("an Advanced the user opened on a field stays open when another field moves", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "PER");
    const dob = () => fieldBox("PER", "dob");
    await t.user.click(advanced(dob()).querySelector("summary") as HTMLElement);
    expect(advanced(dob()).open).toBe(true);
    await t.user.click(
      within(fieldBox("PER", "first")).getByRole("button", { name: "Move up first" }),
    );
    expect(advanced(dob()).open).toBe(true);
    expect(advanced(fieldBox("PER", "first")).open).toBe(false);
  });
});

describe("A3 rule sentences over every condition shape (critic, part 1b)", () => {
  const TX = { field: "state", op: "eq", value: "TX" };
  const Y = { field: "year", op: "gte", value: 2020 };
  const cases: [string, Record<string, unknown>, string][] = [
    [
      "not around a group, one pair of parentheses",
      { field: "plateType", effect: "show", when: { not: { all: [TX, Y] } } },
      "Show Plate type when not (State is Texas and Year is 2020 or more).",
    ],
    [
      "a group nested in a group",
      {
        field: "plateType",
        effect: "hide",
        when: { any: [{ field: "plate", op: "empty" }, { all: [TX, Y] }] },
      },
      "Hide Plate type when Plate is empty or (State is Texas and Year is 2020 or more).",
    ],
    [
      "setDefault names the value by its list label",
      {
        field: "state",
        effect: "setDefault",
        value: "OK",
        when: { field: "plate", op: "notEmpty" },
      },
      "Fill in State with Oklahoma when Plate is filled in.",
    ],
    [
      "an unknown operator does not pretend to be equals",
      { field: "plateType", effect: "show", when: { field: "state", op: "zz", value: "TX" } },
      "Show Plate type when the condition is not finished.",
    ],
    [
      "a blank field",
      { field: "plateType", effect: "show", when: { field: "", op: "eq", value: "TX" } },
      "Show Plate type when the condition is not finished.",
    ],
    [
      "an empty group",
      { field: "plateType", effect: "show", when: { all: [] } },
      "Show Plate type when the condition is not finished.",
    ],
    [
      "an empty value list",
      { field: "plateType", effect: "show", when: { field: "state", op: "in", value: [] } },
      "Show Plate type when the condition is not finished.",
    ],
  ];
  it.each(cases)("%s", async (_name, rule, expected) => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "VEH");
    act(() => {
      const d = structuredClone(state(t).doc) as { queryTypes: QueryType[] };
      const veh = d.queryTypes.find((q) => q.code === "VEH") as QueryType;
      (veh.rules as unknown[])[0] = rule;
      state(t).setDoc(d as never);
    });
    expect(sentence(group(typeBox("VEH"), "Rule 1"))).toBe(expected);
  });
});
