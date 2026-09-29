import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// Task 31 part 2 PR3a (#355): terminal commands and quick access (FR-050 to FR-055, FR-060).

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
type Command = {
  code: string;
  queryType: string;
  positions: unknown[];
  presets?: Record<string, unknown>;
};

/** A fieldset by its legend text (getByRole name lookups are slow over the editor DOM). */
function group(root: ParentNode, name: string): HTMLElement {
  const legend = [...root.querySelectorAll("legend")].find(
    (l) => (l.textContent ?? "").trim() === name,
  );
  const box = legend?.closest("fieldset");
  if (box === null || box === undefined) throw new Error(`no group named ${name}`);
  return box;
}

async function fill(t: Opened, el: HTMLElement, text: string) {
  await t.user.click(el);
  await t.user.paste(text);
}

const doc = (t: Opened) => configDraftStore(t.services).getState().doc as Record<string, unknown>;
const commands = (t: Opened) => doc(t).commands as Command[];
const command = (t: Opened, code: string) => commands(t).find((c) => c.code === code) as Command;

async function openSection(t: Opened, name: string) {
  await t.user.click(await screen.findByText(name, { selector: "summary" }));
}
const box = (code: string) => group(document, code === "" ? "Command (new)" : `Command ${code}`);

describe("commands editor (Task 31 part 2, FR-050, FR-051, FR-060, UX-004)", () => {
  it("edits a command's code and query type", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    const type = within(box("NAM")).getByLabelText("Query type");
    expect(type).toHaveValue("PER");
    expect(
      within(type)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("WNT");
    await t.user.selectOptions(type, "WNT");
    expect(command(t, "NAM").queryType).toBe("WNT");
    const code = within(box("NAM")).getByLabelText("Code");
    await t.user.clear(code);
    await fill(t, code, "NAME");
    expect(commands(t).map((c) => c.code)).toContain("NAME");
  });

  it("reorders positions, marks the last one as rest of line, and adds an unused field", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    const pos2 = group(box("VEH"), "Position 2");
    await t.user.click(within(pos2).getByRole("button", { name: "Move up position 2" }));
    expect(command(t, "VEH").positions).toEqual(["state", "plate", "year", "vin"]);
    await t.user.click(within(group(box("VEH"), "Position 4")).getByLabelText("Rest of line"));
    expect(command(t, "VEH").positions[3]).toEqual({ field: "vin", rest: true });
    await t.user.click(within(group(box("VEH"), "Position 4")).getByLabelText("Rest of line"));
    expect(command(t, "VEH").positions[3]).toBe("vin");
    await t.user.click(within(box("VEH")).getByRole("button", { name: "Add position" }));
    expect(command(t, "VEH").positions).toEqual(["state", "plate", "year", "vin", "plateType"]);
    expect(within(group(box("VEH"), "Position 5")).getByLabelText("Field")).toHaveFocus();
    await t.user.click(
      within(group(box("VEH"), "Position 5")).getByRole("button", { name: "Remove position 5" }),
    );
    expect(command(t, "VEH").positions).toHaveLength(4);
  });

  it("a rest position keeps its field when the field changes", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    const pos3 = group(box("PRO"), "Position 3");
    expect(within(pos3).getByLabelText("Rest of line")).toBeChecked();
    await t.user.selectOptions(within(pos3).getByLabelText("Field"), "make");
    expect(command(t, "PRO").positions[2]).toEqual({ field: "make", rest: true });
  });

  it("critic I3/I4: a new preset writes nothing until a value is entered; rename skips taken keys", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    await t.user.click(within(box("VEH")).getByRole("button", { name: "Add preset" }));
    // Pending: the first free field, no value written yet.
    expect(command(t, "VEH").presets).toBeUndefined();
    const field = within(group(box("VEH"), "Preset 1")).getByLabelText("Field");
    expect(field).toHaveValue("plateType");
    expect(field).toHaveFocus();
    const options = within(field)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).not.toContain("plate");
    await fill(t, within(group(box("VEH"), "Preset 1")).getByLabelText("Value"), "PC");
    expect(command(t, "VEH").presets).toEqual({ plateType: "PC" });
    await t.user.selectOptions(
      within(group(box("VEH"), "Preset 1")).getByLabelText("Field"),
      "plateColor",
    );
    expect(command(t, "VEH").presets).toEqual({ plateColor: "PC" });
    await t.user.click(
      within(group(box("VEH"), "Preset 1")).getByRole("button", { name: "Remove preset 1" }),
    );
    expect(command(t, "VEH").presets).toBeUndefined();
  });

  it("critic I4: removing a pending preset writes nothing", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    await t.user.click(within(box("VEH")).getByRole("button", { name: "Add preset" }));
    await t.user.click(
      within(group(box("VEH"), "Preset 1")).getByRole("button", { name: "Remove preset 1" }),
    );
    expect(command(t, "VEH").presets).toBeUndefined();
    expect(within(box("VEH")).getByRole("button", { name: "Add preset" })).toHaveFocus();
  });

  it("critic I1: a command without positions shows why on its positions", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    await t.user.click(screen.getByRole("button", { name: "Add command" }));
    // A valid code, so the semantic checks run; PER has required fields and no positions yet.
    await fill(t, within(box("")).getByLabelText("Code"), "ZZ");
    await t.user.selectOptions(within(box("ZZ")).getByLabelText("Query type"), "PER");
    const positions = group(box("ZZ"), "Positions");
    await waitFor(() => expect(positions).toHaveAccessibleDescription(/^Error:/));
  });

  it("adds a command and focuses its code; a code with the delimiter shows its diagnostic", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    const before = commands(t).length;
    await t.user.click(screen.getByRole("button", { name: "Add command" }));
    expect(commands(t)).toHaveLength(before + 1);
    expect(commands(t).at(-1)).toEqual({ code: "", queryType: "VEH", positions: [] });
    const code = within(box("")).getByLabelText("Code");
    expect(code).toHaveFocus();
    await fill(t, code, "A.B");
    await waitFor(() => expect(code).toHaveAttribute("aria-invalid", "true"));
    expect(code).toHaveAccessibleDescription(/^Error:/);
  });

  it("removes a command", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    await t.user.click(within(box("NAM")).getByRole("button", { name: "Remove command NAM" }));
    expect(commands(t).map((c) => c.code)).not.toContain("NAM");
  });
});

describe("quick access editor (Task 31 part 2, FR-060, UX-004)", () => {
  const quick = (t: Opened) => doc(t).quickAccess as string[];

  it("reorders, removes, changes and adds quick-access types", async () => {
    const t = await openBuilder();
    await openSection(t, "quickAccess");
    const list = group(document, "Quick access");
    await t.user.click(within(list).getByRole("button", { name: "Move up WNT" }));
    expect(quick(t)).toEqual(["VEH", "PER", "WNT", "PRO", "DL"]);
    expect(
      within(group(document, "Quick access")).getByRole("button", { name: "Move up WNT" }),
    ).toHaveFocus();
    await t.user.click(
      within(group(document, "Quick access")).getByRole("button", { name: "Remove DL" }),
    );
    expect(quick(t)).toEqual(["VEH", "PER", "WNT", "PRO"]);
    await t.user.click(
      within(group(document, "Quick access")).getByRole("button", { name: "Add quick access" }),
    );
    expect(quick(t)).toEqual(["VEH", "PER", "WNT", "PRO", "DL"]);
    const selects = within(group(document, "Quick access")).getAllByLabelText(/^Quick access \d$/);
    await t.user.selectOptions(selects[0] as HTMLElement, "PRO");
    expect(quick(t)[0]).toBe("PRO");
  });
});

describe("PR3a deferrals (#388 M1, M2, M5)", () => {
  it("M1: after a query type change, fields the new type lacks can be removed", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    await t.user.selectOptions(within(box("NAM")).getByLabelText("Query type"), "WNT");
    // Critic I1: a type change keeps everything (arrowing a select must not lose data)...
    expect(command(t, "NAM").positions).toHaveLength(5);
    // ...and an explicit button removes what the new type lacks.
    await t.user.click(
      within(box("NAM")).getByRole("button", { name: "Remove fields not in WNT" }),
    );
    expect(within(box("NAM")).queryByRole("button", { name: /^Remove fields not in/ })).toBeNull();
    expect(command(t, "NAM")).toMatchObject({
      queryType: "WNT",
      positions: ["last", "first", "dob"],
    });
  });

  it("M2: a rest checkbox on a non-last position is invalid and described", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    const rest = () => within(group(box("PRO"), "Position 2")).getByLabelText("Rest of line");
    await t.user.click(rest());
    await waitFor(() => expect(rest()).toHaveAttribute("aria-invalid", "true"));
    expect(rest()).toHaveAccessibleDescription(/^Error:/);
  });

  it("M5: a command without a code is named as new", async () => {
    const t = await openBuilder();
    await openSection(t, "commands");
    await t.user.click(screen.getByRole("button", { name: "Add command" }));
    expect(group(document, "Command (new)")).toBeTruthy();
  });
});
