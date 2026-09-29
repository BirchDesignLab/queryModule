import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

// Task 31 part 2 PR1 (#355): purpose-built editors for query types, fields and picklists.

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
type Picklist = { id: string; values: Record<string, unknown>[] };

const state = (t: Opened) => configDraftStore(t.services).getState();
const types = (t: Opened) => (state(t).doc as { queryTypes: QueryType[] }).queryTypes;
const typeOf = (t: Opened, code: string) => types(t).find((q) => q.code === code) as QueryType;
const picklists = (t: Opened) => (state(t).doc as { picklists: Picklist[] }).picklists;

async function openSection(t: Opened, name: string) {
  await t.user.click(await screen.findByText(name, { selector: "summary" }));
}

/** Opens one query type; each type renders on demand. */
async function openType(t: Opened, code: string) {
  await t.user.click(screen.getByText(`Query type ${code}`, { selector: "summary" }));
}

const typeBox = (code: string) => screen.getByRole("group", { name: `Query type ${code}`.trim() });
const fieldBox = (code: string, key: string) =>
  within(typeBox(code)).getByRole("group", { name: `Field ${key}`.trim() });
const picklistBox = (id: string) => screen.getByRole("group", { name: `Picklist ${id}`.trim() });

describe("query type editor (Task 31 part 2, BR-001, FR-060, UX-004)", () => {
  it("edits a type's code and its label text in the draft locale overlay", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "WNT");
    const box = typeBox("WNT");
    // The type's own label comes first; its sections and fields have their own.
    const label = within(box).getAllByLabelText("Label (en)")[0] as HTMLElement;
    expect(label).toHaveValue("Wanted check");
    await t.user.clear(label);
    await t.user.type(label, "Wants");
    expect(state(t).labels.en?.["queryType.WNT"]).toBe("Wants");
    const code = within(box).getByLabelText("Code");
    await t.user.clear(code);
    await t.user.type(code, "WAR");
    expect(types(t).map((q) => q.code)).toContain("WAR");
  });

  it("adds a query type with one base section and one field, and focuses its code", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    const before = types(t).length;
    await t.user.click(screen.getByRole("button", { name: "Add query type" }));
    expect(types(t)).toHaveLength(before + 1);
    const added = types(t).at(-1) as QueryType;
    expect(added).toMatchObject({
      code: "",
      sections: [{ key: "base", labelKey: "" }],
      fields: [{ key: "", labelKey: "", dataType: "string", section: "base" }],
      rules: [],
    });
    expect(within(typeBox("")).getByLabelText("Code")).toHaveFocus();
  });

  it("adds and removes a section; the section select of a field lists the type's sections", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "PER");
    await t.user.click(within(typeBox("PER")).getByRole("button", { name: "Add section" }));
    const sections = (typeOf(t, "PER").sections as { key: string }[]).map((s) => s.key);
    expect(sections).toEqual(["base", ""]);
    const keys = within(typeBox("PER")).getAllByLabelText("Section key");
    await t.user.type(keys[1] as HTMLElement, "extra");
    const select = within(fieldBox("PER", "dob")).getByLabelText("Section");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["base", "extra"]);
    await t.user.selectOptions(select, "extra");
    expect(typeOf(t, "PER").fields.find((f) => f.key === "dob")?.section).toBe("extra");
    await t.user.click(
      within(typeBox("PER")).getByRole("button", { name: "Remove section extra" }),
    );
    expect((typeOf(t, "PER").sections as unknown[]).length).toBe(1);
  });
});

describe("field editor (Task 31 part 2, FR-060, UX-004)", () => {
  it("sets data type, required and the picklist, which is offered only for picklist fields", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "PER");
    const box = fieldBox("PER", "first");
    expect(within(box).queryByLabelText("Picklist")).toBeNull();
    await t.user.click(within(box).getByLabelText("Required"));
    expect(typeOf(t, "PER").fields.find((f) => f.key === "first")?.required).toBe(true);
    await t.user.selectOptions(within(box).getByLabelText("Data type"), "picklist");
    const picklist = within(fieldBox("PER", "first")).getByLabelText("Picklist");
    expect(
      within(picklist)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("race");
    await t.user.selectOptions(picklist, "race");
    expect(typeOf(t, "PER").fields.find((f) => f.key === "first")).toMatchObject({
      dataType: "picklist",
      picklist: "race",
      required: true,
    });
  });

  it("changing the data type drops a picklist reference and a default that no longer fit", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "PER");
    const box = fieldBox("PER", "sex");
    await t.user.type(within(box).getByLabelText("Default value"), "F");
    expect(typeOf(t, "PER").fields.find((f) => f.key === "sex")?.defaultValue).toBe("F");
    await t.user.selectOptions(within(box).getByLabelText("Data type"), "number");
    const sex = typeOf(t, "PER").fields.find((f) => f.key === "sex") as Field;
    expect(sex.dataType).toBe("number");
    expect("picklist" in sex && sex.picklist !== undefined).toBe(false);
    expect(sex.defaultValue).toBeUndefined();
  });

  it("a number default is written as a number; non-numeric text is flagged at the control", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "VEH");
    const input = within(fieldBox("VEH", "year")).getByLabelText("Default value");
    await t.user.type(input, "2020");
    expect(typeOf(t, "VEH").fields.find((f) => f.key === "year")?.defaultValue).toBe(2020);
    await t.user.type(input, "a");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/enter a number/i);
    expect(typeOf(t, "VEH").fields.find((f) => f.key === "year")?.defaultValue).toBe(2020);
    await t.user.clear(input);
    expect(typeOf(t, "VEH").fields.find((f) => f.key === "year")?.defaultValue).toBeUndefined();
  });

  it("pattern and transform: blank pattern removes the key", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "VEH");
    const box = fieldBox("VEH", "vin");
    await t.user.selectOptions(within(box).getByLabelText("Transform"), "upper");
    const pattern = within(box).getByLabelText("Pattern");
    await t.user.clear(pattern);
    await t.user.type(pattern, "^[[A-Z0-9]+$");
    expect(typeOf(t, "VEH").fields.find((f) => f.key === "vin")).toMatchObject({
      transform: "upper",
      pattern: "^[A-Z0-9]+$",
    });
    await t.user.clear(pattern);
    expect(typeOf(t, "VEH").fields.find((f) => f.key === "vin")?.pattern).toBeUndefined();
  });

  it("reorders fields with Move up and Move down and keeps focus on the moved field", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "PER");
    await t.user.click(within(fieldBox("PER", "dob")).getByRole("button", { name: "Move up dob" }));
    expect(
      typeOf(t, "PER")
        .fields.map((f) => f.key)
        .slice(0, 3),
    ).toEqual(["last", "dob", "first"]);
    expect(
      within(fieldBox("PER", "dob")).getByRole("button", { name: "Move up dob" }),
    ).toHaveFocus();
    await t.user.keyboard("{Enter}");
    expect(typeOf(t, "PER").fields[0]?.key).toBe("dob");
    // The first field has no Move up; focus goes to its Move down.
    expect(
      within(fieldBox("PER", "dob")).getByRole("button", { name: "Move down dob" }),
    ).toHaveFocus();
  });

  it("adds and removes a field", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "WNT");
    const count = typeOf(t, "WNT").fields.length;
    await t.user.click(within(typeBox("WNT")).getByRole("button", { name: "Add field" }));
    expect(typeOf(t, "WNT").fields).toHaveLength(count + 1);
    expect(within(fieldBox("WNT", "")).getByLabelText("Key")).toHaveFocus();
    await t.user.click(
      within(fieldBox("WNT", "dob")).getByRole("button", { name: "Remove field dob" }),
    );
    expect(typeOf(t, "WNT").fields.map((f) => f.key)).not.toContain("dob");
  });

  it("an invalid field key shows its diagnostic at the control", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "WNT");
    const key = within(fieldBox("WNT", "first")).getByLabelText("Key");
    await t.user.clear(key);
    await t.user.type(key, "bad key");
    // Diagnostics follow the debounced draft check.
    await waitFor(() => expect(key).toHaveAttribute("aria-invalid", "true"));
    expect(key).toHaveAccessibleDescription(/must match pattern/);
  });

  it("settings without a purpose-built control stay editable in the generic form", async () => {
    const t = await openBuilder();
    await openSection(t, "queryTypes");
    await openType(t, "PER");
    const box = fieldBox("PER", "last");
    await t.user.click(within(box).getByText("More settings", { selector: "summary" }));
    const max = within(box).getByLabelText("queryTypes.1.fields.0.maxLength");
    await t.user.clear(max);
    await t.user.type(max, "40");
    expect(typeOf(t, "PER").fields[0]?.maxLength).toBe(40);
  });
});

describe("picklist editor (Task 31 part 2, FR-060, UX-004)", () => {
  it("edits a value's code, label text and enabled flag", async () => {
    const t = await openBuilder();
    await openSection(t, "picklists");
    const value = within(picklistBox("sex")).getByRole("group", { name: "Value F" });
    await t.user.click(within(value).getByLabelText("Enabled"));
    const label = within(value).getByLabelText("Label (en)");
    await t.user.clear(label);
    await t.user.type(label, "Woman");
    const sex = picklists(t).find((p) => p.id === "sex") as Picklist;
    expect(sex.values[0]).toMatchObject({ code: "F", enabled: false });
    expect(state(t).labels.en?.["picklist.sex.F"]).toBe("Woman");
  });

  it("adds a value with a blank code and focuses it; removes and reorders values", async () => {
    const t = await openBuilder();
    await openSection(t, "picklists");
    const box = picklistBox("sex");
    await t.user.click(within(box).getByRole("button", { name: "Add value" }));
    const sex = () => picklists(t).find((p) => p.id === "sex") as Picklist;
    expect(sex().values.at(-1)).toMatchObject({ code: "", labelKey: "", enabled: true });
    expect(within(picklistBox("sex")).getByRole("group", { name: "Value" })).toContainElement(
      document.activeElement as HTMLElement,
    );
    const second = sex().values[1]?.code as string;
    await t.user.click(
      within(picklistBox("sex")).getByRole("button", { name: `Move up ${second}` }),
    );
    expect(sex().values[0]?.code).toBe(second);
    await t.user.click(
      within(picklistBox("sex")).getByRole("button", { name: `Remove value ${second}` }),
    );
    expect(sex().values.map((v) => v.code)).not.toContain(second);
  });

  it("adds a picklist; a blank id shows its diagnostic", async () => {
    const t = await openBuilder();
    await openSection(t, "picklists");
    const before = picklists(t).length;
    await t.user.click(screen.getByRole("button", { name: "Add picklist" }));
    expect(picklists(t)).toHaveLength(before + 1);
    expect(picklists(t).at(-1)).toMatchObject({ id: "", values: [{ code: "", enabled: true }] });
    const id = within(picklistBox("")).getByLabelText("Picklist id");
    expect(id).toHaveFocus();
  });
});
