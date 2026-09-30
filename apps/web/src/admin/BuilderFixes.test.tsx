import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { findAddItem, findSetting, selectBuilderItem } from "../test/builder-tree.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// Wave AB inline batch (checker 09-29-26): deferred critic and quality minors that matter for the demo.

function asImplementer() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
}

async function openBuilder() {
  asImplementer();
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}

const draft = (t: Awaited<ReturnType<typeof openBuilder>>) =>
  configDraftStore(t.services).getState().doc as Record<string, unknown>;

async function openSection(t: Awaited<ReturnType<typeof openBuilder>>, name: string) {
  if (name !== "queryTypes") await selectBuilderItem(t.user, name);
}

describe("config builder fixes (Tasks 31, 33; UX-004)", () => {
  it("M3/C4: raw-tab diagnostics are not a live region; only the summary announces", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" });
    const described = document.getElementById(area.getAttribute("aria-describedby") ?? "");
    expect(described).not.toBeNull();
    expect(described?.closest("[aria-live]")).toBeNull();
    expect(screen.getByTestId("draft-summary")).toHaveAttribute("aria-live", "polite");
  });

  it("C9/M7: an unparsable raw edit is announced once in the summary and survives a tab switch", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" });
    await t.user.click(area);
    await t.user.keyboard("{Control>}{End}{/Control}xx");
    await waitFor(() =>
      expect(screen.getByTestId("draft-summary")).toHaveTextContent("Draft JSON does not parse"),
    );
    const broken = (area as HTMLTextAreaElement).value;
    await t.user.click(screen.getByRole("tab", { name: "Form" }));
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    expect(screen.getByRole("textbox", { name: "Draft JSON" })).toHaveValue(broken);
  });

  it("M8: a failed config load shows an error, not an endless loading state", async () => {
    server.use(
      http.get(`${API}/api/v1/config`, () =>
        HttpResponse.json(
          { error: { code: "internal", requestId: "r1" } },
          {
            status: 500,
          },
        ),
      ),
    );
    asImplementer();
    renderRoot({ path: "/admin/config" });
    expect(await screen.findByText("The site config could not be loaded.")).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("M1: a number field can be cleared and take a negative value", async () => {
    const t = await openBuilder();
    await openSection(t, "delegation");
    const input = await findSetting("delegation.maxDurationMinutes");
    await t.user.clear(input);
    expect(input).toHaveValue("");
    await t.user.type(input, "-5");
    expect(input).toHaveValue("-5");
    expect((draft(t).delegation as Record<string, unknown>).maxDurationMinutes).toBe(-5);
  });

  it("M5: Add item clears the new item's identity key; an empty list adds through Raw JSON", async () => {
    const t = await openBuilder();
    await openSection(t, "keywords");
    await t.user.click(await findAddItem("keywords"));
    const keywords = draft(t).keywords as { keyword: string }[];
    expect(keywords.at(-1)?.keyword).toBe("");
    expect(keywords.at(-2)?.keyword).not.toBe("");
    // Task 31 part 2: rules have a purpose-built editor; an emptied generic list shows the rule.
    act(() => configDraftStore(t.services).getState().setPath(["keywords"], []));
    const add = await findAddItem("keywords");
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(/Add the first item in Raw JSON/);
  });

  it("M4: ArrowLeft, ArrowRight, Home and End move between tabs by direction", async () => {
    const t = await openBuilder();
    const form = screen.getByRole("tab", { name: "Form" });
    const raw = screen.getByRole("tab", { name: "Raw JSON" });
    const changes = screen.getByRole("tab", { name: "Changes" });
    form.focus();
    await t.user.keyboard("{ArrowRight}");
    expect(raw).toHaveFocus();
    await t.user.keyboard("{ArrowRight}");
    expect(changes).toHaveFocus();
    await t.user.keyboard("{ArrowRight}");
    expect(form).toHaveFocus();
    await t.user.keyboard("{ArrowLeft}");
    expect(changes).toHaveFocus();
    await t.user.keyboard("{Home}");
    expect(form).toHaveFocus();
    await t.user.keyboard("{End}");
    expect(changes).toHaveFocus();
  });

  it("Q8: resetting the draft while the builder is open reseeds it from the config", async () => {
    const t = await openBuilder();
    act(() => configDraftStore(t.services).getState().reset());
    await waitFor(() => expect(configDraftStore(t.services).getState().doc).not.toBeNull());
    expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(3);
  });
});

describe("config builder wave-critic fixes (I1, I2)", () => {
  it("I1: typing in Raw JSON keeps the user's text (a new blank line stays)", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement;
    area.setSelectionRange(1, 1);
    await t.user.type(area, "{Enter}", {
      initialSelectionStart: 1,
      initialSelectionEnd: 1,
    });
    await waitFor(() => expect(area.value.startsWith("{\n\n")).toBe(true));
  });

  it("I2: a form edit made while Raw JSON is broken replaces the broken text, so no edit is lost", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" });
    await t.user.click(area);
    await t.user.keyboard("{Control>}{End}{/Control}xx");
    await t.user.click(screen.getByRole("tab", { name: "Form" }));
    await openSection(t, "terminal");
    const input = await findSetting("terminal.delimiter");
    await t.user.clear(input);
    await t.user.type(input, ",");
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const text = (screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement).value;
    expect(JSON.parse(text).terminal).toEqual({ delimiter: "," });
    expect(screen.getByTestId("draft-summary")).not.toHaveTextContent("does not parse");
  });
});
