import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { findSetting, selectBuilderItem } from "../test/builder-tree.js";
import {
  API,
  adminConfigBody,
  CLIENT_CONFIG,
  server,
  TEST_USER,
  versionRow,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";

beforeAll(preloadAdminRoutes);

// BW3 Task 5 (#734, D-M2P0-4, BR-001, UX-004; design note "Publish note and history drawer",
// D-M2P2-B5 to B7): the publish dialog takes an optional change note and the history drawer shows
// each version's publisher name and note. The note is plain text, sent trimmed, 200 characters at
// most (UTF-16 units, as zod counts); control characters become spaces as they are typed.

let publishes: unknown[];

async function openBuilder(versions: unknown[] = []) {
  publishes = [];
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () => HttpResponse.json(adminConfigBody())),
    http.get(`${API}/api/v1/admin/config/versions`, () => HttpResponse.json({ versions })),
    http.put(`${API}/api/v1/admin/config/draft`, () => HttpResponse.json(versionRow(2, "draft"))),
    http.post(`${API}/api/v1/admin/config/validate`, () =>
      HttpResponse.json({ errors: [], warnings: [] }),
    ),
    http.post(`${API}/api/v1/admin/config/publish`, async ({ request }) => {
      publishes.push(await request.json());
      return HttpResponse.json(versionRow(2, "published"));
    }),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

async function openReview(t: Opened) {
  await selectBuilderItem(t.user, "terminal");
  const input = await findSetting("terminal.delimiter");
  await t.user.clear(input);
  await t.user.type(input, ",");
  await t.user.click(screen.getByRole("button", { name: "Review and publish" }));
  return screen.findByRole("dialog", { name: /^Publish version \d+$/ });
}
const noteField = (dialog: HTMLElement) =>
  within(dialog).getByRole("textbox", { name: "Change note (optional)" });
const publishButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Publish version 2" });

describe("the publish dialog's change note", () => {
  it("is optional, has a visible label and the history-only hint, and says nothing about the audit log", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    expect(noteField(dialog)).toHaveValue("");
    expect(dialog).toHaveTextContent(
      "Shown in the version history with your name. Never put typed values or case details in it.",
    );
    expect(dialog).not.toHaveTextContent(/audit/i);
    expect(dialog).toHaveTextContent("0 of 200");
  });

  it("sends the note trimmed with the draft version", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    await t.user.type(noteField(dialog), "  Raised the delimiter  ");
    await t.user.click(publishButton(dialog));
    await waitFor(() =>
      expect(publishes).toEqual([{ draftVersion: 2, note: "Raised the delimiter" }]),
    );
  });

  it("sends no note when the field is empty or only spaces", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    await t.user.type(noteField(dialog), "   ");
    await t.user.click(publishButton(dialog));
    await waitFor(() => expect(publishes).toEqual([{ draftVersion: 2 }]));
  });

  it("turns control characters and line breaks into spaces as they are typed (D-M2P2-B6)", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    // A text area normalizes a pasted CRLF to one LF before the handler sees it.
    fireEvent.change(noteField(dialog), { target: { value: "one\ntwo\tthree\r\nfour\u0007five" } });
    expect(noteField(dialog)).toHaveValue("one two three four five");
    await t.user.click(publishButton(dialog));
    await waitFor(() =>
      expect(publishes).toEqual([{ draftVersion: 2, note: "one two three four five" }]),
    );
  });

  it("counts in UTF-16 units, as the contract does, and counts left from 180 and over from 201", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    fireEvent.change(noteField(dialog), { target: { value: "a".repeat(37) } });
    expect(dialog).toHaveTextContent("37 of 200");
    fireEvent.change(noteField(dialog), { target: { value: "a".repeat(192) } });
    expect(dialog).toHaveTextContent("8 left");
    fireEvent.change(noteField(dialog), { target: { value: `${"a".repeat(199)}\u{1F600}` } });
    // The emoji is two UTF-16 units: 201 in all.
    expect(dialog).toHaveTextContent("1 over");
  });

  it("blocks a note over 200 characters with a field error, aria-invalid and a reason in the footer", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    fireEvent.change(noteField(dialog), { target: { value: "a".repeat(213) } });
    const field = noteField(dialog);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(dialog).toHaveTextContent("Note can be at most 200 characters (13 over).");
    expect(field).toHaveAccessibleDescription(/13 over/);
    const publish = publishButton(dialog);
    expect(publish).toHaveAttribute("aria-disabled", "true");
    expect(publish).toHaveAccessibleDescription("Shorten the change note to publish.");
    await t.user.click(publish);
    expect(publishes).toHaveLength(0);
    // Still focusable and the dialog stays open.
    expect(screen.getByRole("dialog", { name: /^Publish version \d+$/ })).toBeInTheDocument();
    // Back at the limit it publishes.
    fireEvent.change(noteField(dialog), { target: { value: "a".repeat(200) } });
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    await t.user.click(publishButton(dialog));
    await waitFor(() => expect(publishes).toHaveLength(1));
  });

  it("starts empty each time the dialog opens", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    await t.user.type(noteField(dialog), "first");
    await t.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /^Publish version \d+$/ }),
      ).not.toBeInTheDocument(),
    );
    await t.user.click(screen.getByRole("button", { name: "Review and publish" }));
    const again = await screen.findByRole("dialog", { name: /^Publish version \d+$/ });
    expect(noteField(again)).toHaveValue("");
  });

  it("the rollback confirmation has no note field (D-M2P2-B5)", async () => {
    const t = await openBuilder([versionRow(3, "published"), versionRow(2, "superseded")]);
    await t.user.click(screen.getByRole("button", { name: "History" }));
    const region = await screen.findByRole("region", { name: "Version history" });
    await t.user.click(
      await within(region).findByRole("button", { name: "Roll back to version 2" }),
    );
    const dialog = await screen.findByRole("dialog", { name: /Roll back/ });
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("the history drawer shows publisher name and note (D-M2P0-4)", () => {
  const open = async (versions: unknown[]) => {
    const t = await openBuilder(versions);
    await t.user.click(screen.getByRole("button", { name: "History" }));
    return screen.findByRole("region", { name: "Version history" });
  };
  const row = (region: HTMLElement, version: number) => {
    const item = within(region)
      .getAllByRole("listitem")
      .find((li) => within(li).queryByText(`Version ${version}`) !== null);
    if (item === undefined) throw new Error(`no row for version ${version}`);
    return item;
  };

  it("shows the name and the note, or the id with a notice and 'No note'", async () => {
    const region = await open([
      versionRow(4, "published", {
        publishedByName: "Avery Test",
        note: "Moved the delimiter to a comma",
      }),
      versionRow(3, "superseded", { publishedBy: "user-0042" }),
      versionRow(2, "superseded", { publishedByName: "Blake Test" }),
    ]);
    await within(region).findByText("Version 4");
    const live = row(region, 4);
    expect(live).toHaveTextContent("Published by Avery Test");
    expect(live).toHaveTextContent("Moved the delimiter to a comma");
    expect(live).not.toHaveTextContent("No note");
    const noName = row(region, 3);
    expect(noName).toHaveTextContent("Published by user-0042 (name not available)");
    expect(noName).toHaveTextContent("No note");
    expect(row(region, 2)).toHaveTextContent("Published by Blake Test");
  });

  it("shows a draft with no publisher line", async () => {
    const region = await open([
      versionRow(3, "draft", { createdBy: "user-0001" }),
      versionRow(2, "published", { publishedByName: "Avery Test" }),
    ]);
    await within(region).findByText("Version 3");
    expect(row(region, 3)).not.toHaveTextContent("Published by");
    expect(row(region, 3)).not.toHaveTextContent("No note");
  });

  it("a rollback shows the Rollback tag and the system line, apart from a typed note", async () => {
    const region = await open([
      versionRow(4, "published", { rollbackOf: 2, publishedByName: "Avery Test" }),
      versionRow(3, "superseded", { publishedByName: "Avery Test" }),
      versionRow(2, "superseded", { publishedByName: "Avery Test" }),
    ]);
    await within(region).findByText("Version 4");
    const rolled = row(region, 4);
    expect(within(rolled).getByText("Rollback")).toBeInTheDocument();
    expect(rolled).toHaveTextContent("Rolled back to version 2");
    expect(rolled).not.toHaveTextContent("No note");
  });

  it("renders a note as plain text, never as markup", async () => {
    const region = await open([
      versionRow(2, "published", { publishedByName: "Avery Test", note: "<b>bold</b> & more" }),
    ]);
    await within(region).findByText("Version 2");
    expect(region.querySelector("b")).toBeNull();
    expect(row(region, 2)).toHaveTextContent("<b>bold</b> & more");
  });
});

describe("the note count is announced once per state, never per key (spec 6.6)", () => {
  it("says 'left' once on entering 180, nothing while typing on, then the error once over the limit", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    const said = vi.spyOn(t.services.announcer, "announce");
    const type = (n: number) =>
      fireEvent.change(noteField(dialog), { target: { value: "a".repeat(n) } });
    for (const n of [150, 170, 179]) type(n);
    expect(said).not.toHaveBeenCalled();
    for (const n of [180, 181, 182, 185, 199, 200]) type(n);
    expect(said.mock.calls.map((c) => c[0])).toEqual(["20 left"]);
    for (const n of [201, 205, 213]) type(n);
    expect(said).toHaveBeenCalledTimes(2);
    expect(said.mock.calls[1]?.[0]).toBe("Note can be at most 200 characters (1 over).");
    // Back under the limit and over again says it again: a new state, not a repeat.
    type(190);
    type(210);
    expect(said.mock.calls.filter((c) => /over\)/.test(String(c[0])))).toHaveLength(2);
  });

  it("marks the warn and over states with an icon as well as words", async () => {
    const t = await openBuilder();
    const dialog = await openReview(t);
    const count = () => dialog.querySelector(".qm-publish-note__count") as HTMLElement;
    expect(count().querySelector(".qm-publish-note__icon")).toBeNull();
    fireEvent.change(noteField(dialog), { target: { value: "a".repeat(185) } });
    const warn = count().querySelector(".qm-publish-note__icon--warn");
    expect(warn).toHaveAttribute("aria-hidden", "true");
    expect(warn).toHaveTextContent("\u24D8");
    fireEvent.change(noteField(dialog), { target: { value: "a".repeat(205) } });
    const over = count().querySelector(".qm-publish-note__icon--over");
    expect(over).toHaveAttribute("aria-hidden", "true");
    expect(over).toHaveTextContent("\u26A0");
    expect(count().querySelector(".qm-publish-note__icon--warn")).toBeNull();
    expect(count()).toHaveTextContent("5 over");
  });
});
