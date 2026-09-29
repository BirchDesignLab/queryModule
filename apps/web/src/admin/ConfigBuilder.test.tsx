import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
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
});
