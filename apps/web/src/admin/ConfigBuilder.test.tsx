import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { findAddItem, findSetting, selectBuilderItem } from "../test/builder-tree.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("heading", { name: "Site configuration", level: 2 });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}

const draftDoc = (t: Awaited<ReturnType<typeof openBuilder>>) =>
  configDraftStore(t.services).getState().doc;

async function replaceRaw(t: Awaited<ReturnType<typeof openBuilder>>, text: string) {
  await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
  const area = screen.getByRole("textbox", { name: "Draft JSON" });
  await t.user.clear(area);
  await t.user.click(area);
  await t.user.paste(text);
  return area;
}

describe("config builder (Task 31 part 1, BR-001, FR-060, UX-004)", () => {
  it("edits in the generic form change the draft JSON", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "terminal");
    const input = await findSetting("terminal.delimiter");
    await t.user.clear(input);
    await t.user.type(input, ",");
    expect(draftDoc(t)?.terminal).toEqual({ delimiter: "," });
  });

  it("labels server-only sections; publish and history are aria-disabled, focusable, with one reason", async () => {
    const t = await openBuilder();
    expect(
      screen.getByText(/server settings: available after the config store lands/i),
    ).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publish" });
    const history = screen.getByRole("button", { name: "History" });
    for (const b of [publish, history]) {
      expect(b).not.toBeDisabled();
      expect(b).toHaveAttribute("aria-disabled", "true");
      expect(b).toHaveAccessibleDescription("Publish and history arrive with the config store.");
    }
    expect(history.getAttribute("aria-describedby")).toBe(publish.getAttribute("aria-describedby"));
    const reason = document.getElementById(publish.getAttribute("aria-describedby") ?? "");
    expect(reason).not.toHaveAttribute("tabindex");
    const before = JSON.stringify(draftDoc(t));
    await t.user.click(publish);
    await t.user.click(history);
    expect(JSON.stringify(draftDoc(t))).toBe(before);
  });

  it("the toolbar follows the section title and shows a draft status that is not a live region", async () => {
    const t = await openBuilder();
    const heading = screen.getByRole("heading", { name: "Site configuration", level: 2 });
    const toolbar = heading.nextElementSibling as HTMLElement;
    expect(toolbar).toHaveClass("qm-builder__toolbar");
    const status = within(toolbar).getByTestId("draft-status");
    expect(status).toHaveTextContent("Draft: no changes");
    expect(status).not.toHaveAttribute("aria-live");
    expect(status).not.toHaveAttribute("role");
    await selectBuilderItem(t.user, "terminal");
    const input = await findSetting("terminal.delimiter");
    await t.user.clear(input);
    await t.user.type(input, ",");
    expect(status).toHaveTextContent("Draft: unpublished changes, kept in this tab only");
    expect(status).not.toHaveTextContent(/saved|version/i);
  });

  it("the raw JSON tab shows the draft and a valid edit updates it", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement;
    expect(area.value).toContain('"delimiter"');
    const next = JSON.parse(area.value);
    next.terminal.delimiter = ";";
    await replaceRaw(t, JSON.stringify(next));
    await waitFor(() => expect(draftDoc(t)?.terminal).toEqual({ delimiter: ";" }));
    expect(area).toHaveAttribute("aria-invalid", "false");
  });

  it("invalid raw JSON shows its parse error at the tab and keeps the last good draft", async () => {
    const t = await openBuilder();
    const area = await replaceRaw(t, '{"a":');
    expect(area).toHaveAttribute("aria-invalid", "true");
    const error = document.getElementById(area.getAttribute("aria-describedby") ?? "");
    expect(error).toHaveTextContent(/JSON/i);
    expect(draftDoc(t)?.terminal).toEqual({ delimiter: "." });
    expect(area).toHaveFocus();
  });

  it("a shape error in valid JSON is listed with its pointer", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement;
    const doc = JSON.parse(area.value);
    doc.terminal.delimiter = 5;
    await replaceRaw(t, JSON.stringify(doc));
    expect(await screen.findByText(/\/terminal\/delimiter/)).toBeInTheDocument();
  });

  it("label text edits go to the locale overlay", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "Label text");
    const sect = within(
      (await screen.findByText("Texts for en", { selector: "h4" })).closest(
        ".qm-sect",
      ) as HTMLElement,
    );
    await t.user.type(sect.getByLabelText("Label key"), "site.custom");
    await t.user.type(sect.getByLabelText("Text"), "Custom");
    await t.user.click(sect.getByRole("button", { name: "Add English label" }));
    expect(configDraftStore(t.services).getState().labels).toEqual({
      en: { "site.custom": "Custom" },
    });
  });

  it("arrow keys move between the tabs", async () => {
    const t = await openBuilder();
    screen.getByRole("tab", { name: "Form" }).focus();
    await t.user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Raw JSON" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Raw JSON" })).toHaveAttribute("aria-selected", "true");
  });

  it("logout clears the draft", async () => {
    const t = await openBuilder();
    expect(draftDoc(t)).not.toBeNull();
    t.services.reset.resetAll();
    expect(draftDoc(t)).toBeNull();
  });

  it("a failed locale bundle fetch shows a polite message instead of silent no-checks (Q1, I2)", async () => {
    // #388: bootstrap caches the bundle; with that cache gone, the builder's own fetch fails.
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user: { ...TEST_USER, role: "implementer" } }),
      ),
    );
    const t = renderRoot({ path: "/" });
    const admin = await screen.findByRole("link", { name: "Admin" });
    server.use(http.get(`${API}/api/v1/locales/en`, () => new HttpResponse(null, { status: 500 })));
    act(() => t.services.queryClient.removeQueries({ queryKey: ["locale", "en"] }));
    await t.user.click(admin);
    await screen.findByRole("tab", { name: "Form" });
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" });
    const region = document.getElementById(area.getAttribute("aria-describedby") ?? "");
    // Batch M3/C4: the summary is the one live region; the raw-tab diagnostics are not live.
    const summary = screen.getByTestId("draft-summary");
    await waitFor(() => expect(summary).toHaveTextContent(/draft checks are unavailable/i));
    expect(summary).toHaveAttribute("aria-live", "polite");
    expect(region?.closest("[aria-live]")).toBeNull();
    expect(screen.queryByText(/Draft checks: \d+ errors/)).not.toBeInTheDocument();
    expect(area).not.toHaveFocus();
  });

  it("shows a loading message until the bundle arrives, then the counts (I2)", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    expect(await screen.findByText(/Draft checks: \d+ errors/)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("non-string locales pasted in the raw tab do not crash the form (I1)", async () => {
    const t = await openBuilder();
    const doc = { ...draftDoc(t), locales: [{}, 5, "en"] };
    await replaceRaw(t, JSON.stringify(doc));
    await t.user.click(screen.getByRole("tab", { name: "Form" }));
    await selectBuilderItem(t.user, "Label text");
    expect(await screen.findByText("Texts for en", { selector: "h4" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Site configuration", level: 2 }),
    ).toBeInTheDocument();
  });

  it("removing an array item keeps focus in the list; adding focuses the new item (I3)", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "sources");
    const count = () => screen.queryAllByRole("button", { name: /^Remove Item \d+$/ }).length;
    const before = count();
    expect(before).toBeGreaterThan(1);
    await t.user.click(screen.getByRole("button", { name: "Remove Item 1" }));
    expect(count()).toBe(before - 1);
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(active.closest(".qm-admin__item")).not.toBeNull();
    // adding focuses the new item
    await t.user.click(await findAddItem("sources"));
    const added = document.querySelector(`.qm-admin__item[data-item-path='sources.${before - 1}']`);
    expect(added?.contains(document.activeElement)).toBe(true);
    // remove down to empty: Add is disabled (batch M5), so its reason text takes focus
    while (count() > 0) {
      await t.user.click(screen.getByRole("button", { name: "Remove Item 1" }));
    }
    expect(await findAddItem("sources")).toBeDisabled();
    expect(document.activeElement).toHaveTextContent("Add the first item in Raw JSON");
  });

  it("per-source timeoutMs is server-side and read-only in the generic form (CV1)", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "sources");
    const field = await findSetting("sources.0.timeoutMs");
    expect(field).toHaveAttribute("readonly");
    const before = JSON.stringify(draftDoc(t)?.sources);
    await t.user.type(field, "9");
    expect(JSON.stringify(draftDoc(t)?.sources)).toBe(before);
  });
});
