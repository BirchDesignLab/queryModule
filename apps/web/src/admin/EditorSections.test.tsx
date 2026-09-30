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
});
