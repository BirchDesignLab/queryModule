import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { findSetting, selectBuilderItem } from "../test/builder-tree.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";
import type { JsonObject } from "./draft.js";

beforeAll(preloadAdminRoutes);

// B1 undo and redo on the draft: toolbar buttons and keys, in the builder only, restoring the
// selection, announced through the shared region, memory only.

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

const store = (t: Opened) => configDraftStore(t.services).getState();
const doc = (t: Opened) => store(t).doc as JsonObject;
const undoButton = () => screen.getByRole("button", { name: "Undo" });
const redoButton = () => screen.getByRole("button", { name: "Redo" });
const treeItem = (name: RegExp) =>
  within(screen.getByRole("navigation", { name: "Configuration items" })).getByRole("treeitem", {
    name,
  });
const polite = (t: Opened) => t.services.announcer.current().polite?.text ?? "";

/** Types into the delimiter field of Terminal settings, as a user would. */
async function editDelimiter(t: Opened, text = ";") {
  await selectBuilderItem(t.user, "terminal");
  const input = await findSetting("terminal.delimiter");
  await t.user.clear(input);
  await t.user.type(input, text);
  return input;
}

describe("undo and redo (B1)", () => {
  it("the buttons are aria-disabled with a visible reason until there is something to do", async () => {
    const t = await openBuilder();
    for (const b of [undoButton(), redoButton()]) {
      expect(b).toHaveAttribute("aria-disabled", "true");
      expect(b).not.toBeDisabled();
      expect(b).toHaveAccessibleDescription("Nothing to undo or redo yet.");
    }
    await t.user.click(undoButton());
    expect(store(t).undoCount).toBe(0);
    await editDelimiter(t);
    expect(undoButton()).not.toHaveAttribute("aria-disabled");
    expect(redoButton()).toHaveAttribute("aria-disabled", "true");
    expect(redoButton()).toHaveAccessibleDescription("Nothing to redo.");
    await t.user.click(undoButton());
    expect(undoButton()).toHaveAttribute("aria-disabled", "true");
    expect(undoButton()).toHaveAccessibleDescription("Nothing to undo.");
    expect(redoButton()).not.toHaveAttribute("aria-disabled");
  });

  it("Undo puts back what was typed over and Redo brings it again; typing is one step", async () => {
    const t = await openBuilder();
    const before = (doc(t).terminal as { delimiter: string }).delimiter;
    const input = await editDelimiter(t, ";;;");
    // Clearing and typing in the same control is one step, not four.
    expect(store(t).undoCount).toBe(1);
    await t.user.click(undoButton());
    expect(input).toHaveValue(before);
    expect((doc(t).terminal as { delimiter: string }).delimiter).toBe(before);
    await t.user.click(redoButton());
    expect(input).toHaveValue(";;;");
  });

  it("Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work from a tree row and the toolbar, not in a text input", async () => {
    const t = await openBuilder();
    const input = await editDelimiter(t);
    const value = () => (doc(t).terminal as { delimiter: string }).delimiter;
    expect(value()).toBe(";");
    // In a text input the browser's own undo is left alone: the event is not handled.
    expect(fireEvent.keyDown(input, { key: "z", ctrlKey: true })).toBe(true);
    expect(value()).toBe(";");
    // From a tree row it is the draft's undo.
    const row = treeItem(/^Terminal settings/);
    act(() => row.focus());
    expect(fireEvent.keyDown(row, { key: "z", ctrlKey: true })).toBe(false);
    await waitFor(() => expect(value()).not.toBe(";"));
    fireEvent.keyDown(row, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(value()).toBe(";"));
    fireEvent.keyDown(row, { key: "z", ctrlKey: true });
    await waitFor(() => expect(value()).not.toBe(";"));
    fireEvent.keyDown(row, { key: "y", ctrlKey: true });
    await waitFor(() => expect(value()).toBe(";"));
    // Command on a Mac.
    fireEvent.keyDown(row, { key: "z", metaKey: true });
    await waitFor(() => expect(value()).not.toBe(";"));
  });

  it("the keys do nothing outside the builder", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    const before = store(t).undoCount;
    const header = screen.getByRole("banner");
    expect(fireEvent.keyDown(header, { key: "z", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "z", ctrlKey: true })).toBe(true);
    expect(store(t).undoCount).toBe(before);
  });

  it("other Ctrl and Alt combinations and plain letters are not undo", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    const row = treeItem(/^Terminal settings/);
    act(() => row.focus());
    expect(fireEvent.keyDown(row, { key: "z" })).toBe(true);
    expect(fireEvent.keyDown(row, { key: "z", ctrlKey: true, altKey: true })).toBe(true);
    expect(fireEvent.keyDown(row, { key: "y", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(row, { key: "x", ctrlKey: true })).toBe(true);
    expect(store(t).redoCount).toBe(0);
  });

  it("restores the selection the state had, and the editor follows", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    await t.user.click(treeItem(/^Sources/));
    await screen.findByRole("heading", { name: /^Sources sources/, level: 3 });
    await t.user.click(undoButton());
    // The edit was made on Terminal settings: that item is selected again, showing the old value.
    await waitFor(() =>
      expect(treeItem(/^Terminal settings/)).toHaveAttribute("aria-selected", "true"),
    );
    expect(await findSetting("terminal.delimiter")).not.toHaveValue(";");
    // Redo goes back to where the undo was made from.
    await t.user.click(redoButton());
    await waitFor(() => expect(treeItem(/^Sources/)).toHaveAttribute("aria-selected", "true"));
  });

  it("announces through the shared live region only, and the button keeps focus", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    const summary = screen.getByTestId("draft-summary");
    const summaryBefore = summary.textContent;
    undoButton().focus();
    await t.user.click(undoButton());
    expect(polite(t)).toBe("Undone. Undo steps left: 0.");
    expect(undoButton()).toHaveFocus();
    await t.user.click(redoButton());
    expect(polite(t)).toBe("Redone. Redo steps left: 0.");
    // The builder's own polite summary carries no undo text.
    expect(summary.textContent).toBe(summaryBefore);
    expect(summary.textContent).not.toMatch(/undo|redo/i);
  });

  it("an undo speaks one announcement: the summary region updates silently (#485)", async () => {
    const t = await openBuilder();
    const spy = vi.spyOn(t.services.announcer, "announce");
    // "/" collides with a single-key shortcut, so the draft gains an error the undo then removes.
    await editDelimiter(t, "/");
    const summary = screen.getByTestId("draft-summary");
    await waitFor(() => expect(summary.textContent).toMatch(/[1-9]\d* error/));
    const withError = summary.textContent;
    expect(summary).toHaveAttribute("aria-live", "polite");
    spy.mockClear();
    await t.user.click(undoButton());
    // The counts change under the undo, but the region is not live while they do.
    await waitFor(() => expect(summary.textContent).not.toBe(withError));
    expect(summary).toHaveAttribute("aria-live", "off");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(polite(t)).toBe("Undone. Undo steps left: 0.");
    // The next edit makes it a polite region again.
    await editDelimiter(t, "/");
    expect(summary).toHaveAttribute("aria-live", "polite");
  });

  it("a Raw edit that does not parse after an undo is announced: the summary is polite (#485)", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    await t.user.click(undoButton());
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const summary = screen.getByTestId("draft-summary");
    fireEvent.change(screen.getByRole("textbox", { name: "Draft JSON" }), {
      target: { value: "{" },
    });
    await waitFor(() => expect(summary.textContent).toMatch(/does not parse/i));
    expect(summary).toHaveAttribute("aria-live", "polite");
  });

  it("undoing a setting edit and then a label edit, in the order they were made", async () => {
    const t = await openBuilder();
    act(() => store(t).setLabel("en", "site.x", "X"));
    act(() => store(t).setPath(["quickAccess"], ["VEH"]));
    await t.user.click(undoButton());
    expect(doc(t).quickAccess).not.toEqual(["VEH"]);
    await t.user.click(undoButton());
    expect(store(t).labels).toEqual({});
  });

  it("the history is cleared with the draft (sign-out) and is never stored", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const t = await openBuilder();
    await editDelimiter(t);
    expect(store(t).undoCount).toBeGreaterThan(0);
    act(() => t.services.reset.resetAll());
    expect(configDraftStore(t.services).getState().undoCount).toBe(0);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    setItem.mockRestore();
  });

  it("Raw JSON follows an undo", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const raw = screen.getByRole("textbox", { name: "Draft JSON" });
    const text = () => (raw as HTMLTextAreaElement).value;
    await waitFor(() => expect(text()).toContain('"delimiter": ";"'));
    await t.user.click(undoButton());
    await waitFor(() => expect(text()).not.toContain('"delimiter": ";"'));
    // The user stays on the Raw tab: an undo does not switch views.
    expect(screen.getByRole("tab", { name: "Raw JSON" })).toHaveAttribute("aria-selected", "true");
  });

  it("I1: a raw edit, a form edit, then Undo: the Raw text matches the draft and does not bring the edit back", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const raw = screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement;
    const d1 = structuredClone(doc(t)) as { terminal: { delimiter: string } };
    d1.terminal.delimiter = "@";
    fireEvent.change(raw, { target: { value: JSON.stringify(d1, null, 2) } });
    await waitFor(() => expect((doc(t).terminal as { delimiter: string }).delimiter).toBe("@"));
    await t.user.click(screen.getByRole("tab", { name: "Form" }));
    await selectBuilderItem(t.user, "terminal");
    const input = await findSetting("terminal.delimiter");
    await t.user.clear(input);
    await t.user.type(input, "~");
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    await t.user.click(undoButton());
    const text = () =>
      (screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement).value;
    // The text is the draft again (the raw edit), not the undone form edit.
    await waitFor(() => expect(text()).toContain('"delimiter": "@"'));
    expect(text()).not.toContain('"delimiter": "~"');
    // The next raw keystroke keeps the draft as it is.
    fireEvent.change(screen.getByRole("textbox", { name: "Draft JSON" }), {
      target: { value: `${text()} ` },
    });
    expect((doc(t).terminal as { delimiter: string }).delimiter).toBe("@");
  });

  it("m5: Undo while the Raw text does not parse puts the draft's text back", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const raw = screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement;
    fireEvent.change(raw, { target: { value: "{ not json" } });
    await waitFor(() => expect(screen.getAllByText(/does not parse/i).length).toBeGreaterThan(0));
    await t.user.click(undoButton());
    await waitFor(() => expect(raw.value.startsWith("{\n")).toBe(true));
    expect(raw.value).not.toContain("not json");
  });

  it("I2: toggles and structural edits are steps of their own; only text entry coalesces", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "features");
    const box = await findSetting("features.credentials");
    await t.user.click(box);
    await t.user.click(box);
    expect(store(t).undoCount).toBe(2);
    await t.user.click(undoButton());
    expect(box).toBeChecked();
  });

  it("I3: an undo that switches the item hands lost focus to the selected tree row, and the keys keep working", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "features");
    const box = await findSetting("features.credentials");
    await t.user.click(box);
    await t.user.click(box);
    await selectBuilderItem(t.user, "sources");
    // A button in the Sources editor has focus (not a text entry: the key is the draft's undo).
    const remove = (
      await screen.findAllByRole("button", { name: /^Remove Item/ })
    )[0] as HTMLElement;
    act(() => remove.focus());
    fireEvent.keyDown(remove, { key: "z", ctrlKey: true });
    await waitFor(() => expect(treeItem(/^Features/)).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(treeItem(/^Features/)).toHaveFocus());
    // The keys still reach the builder from where focus went.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "z", ctrlKey: true });
    await waitFor(() => expect(store(t).undoCount).toBe(0));
  });

  it("m2 and m3: Cmd+Y is not redo; a non-Latin layout still undoes by the physical key", async () => {
    const t = await openBuilder();
    await editDelimiter(t);
    const row = treeItem(/^Terminal settings/);
    act(() => row.focus());
    expect(fireEvent.keyDown(row, { key: "y", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(row, { key: "я", code: "KeyZ", ctrlKey: true })).toBe(false);
    await waitFor(() => expect(store(t).undoCount).toBe(0));
    // Dvorak's Ctrl+; reports key "z": the key wins where it is a Latin letter.
    expect(
      fireEvent.keyDown(row, { key: "z", code: "Semicolon", ctrlKey: true, shiftKey: true }),
    ).toBe(false);
    await waitFor(() => expect(store(t).redoCount).toBe(0));
  });
});
