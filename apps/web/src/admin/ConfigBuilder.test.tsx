import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("heading", { name: "Site config", level: 2 });
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
    await t.user.click(await screen.findByText("terminal"));
    const input = await screen.findByLabelText("terminal.delimiter");
    await t.user.clear(input);
    await t.user.type(input, ",");
    expect(draftDoc(t)?.terminal).toEqual({ delimiter: "," });
  });

  it("labels server-only sections and disables publish and history with a reason", async () => {
    await openBuilder();
    expect(
      screen.getByText(/server settings: available after the config store lands/i),
    ).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publish" });
    const history = screen.getByRole("button", { name: "History" });
    expect(publish).toBeDisabled();
    expect(history).toBeDisabled();
    const reason = document.getElementById(publish.getAttribute("aria-describedby") ?? "");
    expect(reason).toHaveTextContent("Publish and history arrive with the config store");
    expect(reason).toHaveAttribute("tabindex", "0");
    expect(history.getAttribute("aria-describedby")).toBe(publish.getAttribute("aria-describedby"));
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
    await t.user.click(await screen.findByText("Label text"));
    await t.user.type(await screen.findByLabelText("Label key (en)"), "site.custom");
    await t.user.type(screen.getByLabelText("Label text (en)"), "Custom");
    await t.user.click(screen.getByRole("button", { name: "Add label (en)" }));
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
    // the app bootstrap fetches the bundle first (200); the builder's own fetch then fails
    let calls = 0;
    server.use(
      http.get(`${API}/api/v1/locales/en`, () =>
        ++calls === 1 ? HttpResponse.json(EN_BUNDLE) : new HttpResponse(null, { status: 500 }),
      ),
    );
    const t = await openBuilder();
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
    await t.user.click(await screen.findByText("Label text"));
    expect(await screen.findByLabelText("Label key (en)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Site config", level: 2 })).toBeInTheDocument();
  });

  it("removing an array item keeps focus in the list; adding focuses the new item (I3)", async () => {
    const t = await openBuilder();
    await t.user.click(await screen.findByText("sources"));
    const count = () => screen.queryAllByRole("button", { name: /^Remove sources\.\d+$/ }).length;
    const before = count();
    expect(before).toBeGreaterThan(1);
    await t.user.click(screen.getByRole("button", { name: "Remove sources.0" }));
    expect(count()).toBe(before - 1);
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(active.closest(".qm-admin__item")).not.toBeNull();
    // adding focuses the new item
    await t.user.click(screen.getByRole("button", { name: "Add item sources" }));
    const added = document.querySelector(`.qm-admin__item[data-item-path='sources.${before - 1}']`);
    expect(added?.contains(document.activeElement)).toBe(true);
    // remove down to empty: Add is disabled (batch M5), so its reason text takes focus
    while (count() > 0) {
      await t.user.click(screen.getByRole("button", { name: "Remove sources.0" }));
    }
    expect(screen.getByRole("button", { name: "Add item sources" })).toBeDisabled();
    expect(document.activeElement).toHaveTextContent("Add the first item in Raw JSON");
  });

  it("per-source timeoutMs is server-side and read-only in the generic form (CV1)", async () => {
    const t = await openBuilder();
    await t.user.click(await screen.findByText("sources"));
    const field = await screen.findByLabelText("sources.0.timeoutMs");
    expect(field).toHaveAttribute("readonly");
    const before = JSON.stringify(draftDoc(t)?.sources);
    await t.user.type(field, "9");
    expect(JSON.stringify(draftDoc(t)?.sources)).toBe(before);
  });
});
