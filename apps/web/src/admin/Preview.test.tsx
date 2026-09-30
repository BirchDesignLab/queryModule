import { createTranslator } from "@querymodule/client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../app/i18n-context.js";
import { ServicesProvider } from "../app/services-context.js";
import { selectBuilderItem } from "../test/builder-tree.js";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { API, server, submitRecorder, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { testServices } from "../test/render-routes.js";
import { configDraftStore } from "./ConfigBuilder.js";
import type { JsonObject } from "./draft.js";
import { BuilderPreview } from "./Preview.js";

beforeAll(preloadAdminRoutes);

// Task 32 (#357): the builder's live preview is the dispatcher's own panel (ADR-0011 item 4).

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  const preview = await screen.findByRole("region", { name: "Live preview" });
  await within(preview).findByRole("button", { name: "Run query" });
  return { ...t, preview };
}

type Opened = Awaited<ReturnType<typeof openBuilder>>;

const store = (t: Opened) => configDraftStore(t.services).getState();
const doc = (t: Opened) => store(t).doc as JsonObject;

/**
 * A builder edit, as the form or the raw tab would make it, then a wait until the debounced draft
 * reaches the preview (aria-busy clears). Acting before that raced the old config on CI (#357).
 */
async function edit(t: Opened, change: (d: JsonObject) => JsonObject) {
  act(() => store(t).setDoc(change(structuredClone(doc(t)))));
  await waitFor(() => expect(t.preview).not.toHaveAttribute("aria-busy"));
}

type Field = { key: string; required?: boolean };
type QueryType = { code: string; fields: Field[] };

afterEach(() => {
  submitRecorder.calls = [];
});

describe("builder live preview (Task 32, BR-001, UX-004)", () => {
  it("renders the dispatcher panel from the draft, submit aria-disabled with the Preview reason", async () => {
    const { preview } = await openBuilder();
    const submit = within(preview).getByRole("button", { name: "Run query" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAccessibleDescription("Preview");
    expect(within(preview).getByRole("button", { name: "Vehicle" })).toBeInTheDocument();
  });

  it("#357 CI flake: the preview is aria-busy until the settled draft reaches it", async () => {
    const t = await openBuilder();
    expect(t.preview).not.toHaveAttribute("aria-busy");
    act(() => store(t).setDoc({ ...structuredClone(doc(t)), quickAccess: ["PER", "VEH"] }));
    expect(t.preview).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(t.preview).not.toHaveAttribute("aria-busy"));
    const buttons = within(t.preview).getAllByRole("button", { name: /^(Person|Vehicle)$/ });
    expect(buttons.map((b) => b.lastChild?.textContent)).toEqual(["Person", "Vehicle"]);
  });

  it("a builder edit that makes DOB required shows the required error on preview submit, and sends nothing", async () => {
    const t = await openBuilder();
    await edit(t, (d) => {
      const per = (d.queryTypes as QueryType[]).find((q) => q.code === "PER");
      const dob = per?.fields.find((f) => f.key === "dob");
      if (dob === undefined) throw new Error("fixture: PER dob");
      dob.required = true;
      return d;
    });
    await t.user.click(within(t.preview).getByRole("button", { name: "Person" }));
    await t.user.type(within(t.preview).getByLabelText(/Last name/), "TESTERSON");
    await t.user.click(within(t.preview).getByRole("button", { name: "Run query" }));
    expect(await within(t.preview).findByText("Date of birth is required.")).toBeInTheDocument();
    expect(submitRecorder.calls).toHaveLength(0);
  });

  it("a command added in the builder parses in the preview terminal", async () => {
    const t = await openBuilder();
    await t.user.click(within(t.preview).getByRole("button", { name: "Terminal mode" }));
    const command = await within(t.preview).findByLabelText("Command");
    await t.user.type(command, "ZZN.TESTERSON{Enter}");
    expect(within(t.preview).getByRole("list", { name: "Command problems" })).toBeInTheDocument();
    await edit(t, (d) => ({
      ...d,
      commands: [
        ...(d.commands as unknown[]),
        { code: "ZZN", queryType: "PER", positions: ["last"] },
      ],
    }));
    const again = within(t.preview).getByLabelText("Command");
    await t.user.clear(again);
    await t.user.type(again, "ZZN.TESTERSON{Enter}");
    await waitFor(() =>
      expect(within(t.preview).queryByRole("list", { name: "Command problems" })).toBeNull(),
    );
    expect(submitRecorder.calls).toHaveLength(0);
  });

  it("typing in the preview never touches the dispatcher's draft store", async () => {
    const t = await openBuilder();
    const before = JSON.stringify(t.services.drafts.getState());
    await t.user.type(within(t.preview).getByLabelText("Plate"), "ZZ-1234");
    expect(JSON.stringify(t.services.drafts.getState())).toBe(before);
  });

  it("an invalid draft pauses the preview on the last good config", async () => {
    const t = await openBuilder();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    expect(
      await within(t.preview).findByText(
        "Preview paused: 1 error. Showing the last valid version.",
      ),
    ).toBeInTheDocument();
    expect(within(t.preview).getByRole("button", { name: "Vehicle" })).toBeInTheDocument();
  });

  it("M2: a type renamed in the builder makes the preview fall back to the first quick-access type", async () => {
    const t = await openBuilder();
    await t.user.click(within(t.preview).getByRole("button", { name: "Person" }));
    expect(within(t.preview).getByRole("button", { name: "Person" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await edit(t, (d) => JSON.parse(JSON.stringify(d).replaceAll('"PER"', '"PEX"')) as JsonObject);
    await waitFor(() =>
      expect(within(t.preview).getByRole("button", { name: "Vehicle" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("label text edited in the builder shows in the preview", async () => {
    const t = await openBuilder();
    act(() => store(t).setLabel("en", "queryType.VEH", "Car"));
    expect(await within(t.preview).findByRole("button", { name: "Car" })).toBeInTheDocument();
  });

  it("critic 5: unparsable raw JSON pauses the preview", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    await t.user.click(screen.getByRole("textbox", { name: "Draft JSON" }));
    await t.user.keyboard("{Control>}{End}{/Control}xx");
    expect(
      await within(t.preview).findByText(
        "Preview paused: the JSON does not parse. Showing the last valid version.",
      ),
    ).toBeInTheDocument();
  });

  it("critic 5: a draft reset clears the preview draft", async () => {
    const t = await openBuilder();
    await t.user.type(within(t.preview).getByLabelText("Plate"), "ZZ-1234");
    act(() => store(t).reset());
    const preview = await screen.findByRole("region", { name: "Live preview" });
    expect(await within(preview).findByLabelText("Plate")).toHaveValue("");
  });

  it("critic 2: reopening the builder on a draft with errors still shows a preview", async () => {
    const t = await openBuilder();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    await within(t.preview).findByText("Preview paused: 1 error. Showing the last valid version.");
    await t.user.click(screen.getByRole("link", { name: "Status" }));
    await t.user.click(await screen.findByRole("link", { name: "Admin" }));
    const preview = await screen.findByRole("region", { name: "Live preview" });
    // The panel shows (from the live site config), not only the paused note.
    expect(await within(preview).findByRole("button", { name: "Run query" })).toBeInTheDocument();
    expect(within(preview).getByLabelText("Plate")).toBeInTheDocument();
  });

  it("the builder summary stays its own live region beside the preview", async () => {
    const t = await openBuilder();
    const summary = screen.getByTestId("draft-summary");
    expect(summary).toHaveAttribute("aria-live", "polite");
    expect(t.preview.contains(summary)).toBe(false);
    expect(summary.contains(t.preview)).toBe(false);
  });
});

describe("A4 preview: persona switch and states (M1 P3)", () => {
  const panelOf = (preview: HTMLElement) =>
    preview.querySelector<HTMLElement>(".qm-preview__panel") as HTMLElement;

  it("the persona switch is a group of aria-pressed buttons; Officer only adds the touch layout class", async () => {
    const t = await openBuilder();
    const group = within(t.preview).getByRole("group", { name: "Preview as" });
    const dispatcher = within(group).getByRole("button", { name: "Dispatcher" });
    const officer = within(group).getByRole("button", { name: "Officer" });
    expect(dispatcher).toHaveAttribute("aria-pressed", "true");
    expect(officer).toHaveAttribute("aria-pressed", "false");
    // Buttons, not a radio group or tabs: one Tab stop each, no roving tabindex.
    expect(dispatcher).not.toHaveAttribute("tabindex");
    expect(officer).not.toHaveAttribute("tabindex");
    expect(panelOf(t.preview)).not.toHaveClass("qm-layout--mobile-unit");
    await t.user.type(within(t.preview).getByLabelText("Plate"), "ZZ-1234");
    await t.user.click(officer);
    expect(officer).toHaveAttribute("aria-pressed", "true");
    expect(dispatcher).toHaveAttribute("aria-pressed", "false");
    expect(panelOf(t.preview)).toHaveClass("qm-layout--mobile-unit");
    // The panel is not remounted: what was typed stays.
    expect(within(t.preview).getByLabelText("Plate")).toHaveValue("ZZ-1234");
    await t.user.click(dispatcher);
    expect(panelOf(t.preview)).not.toHaveClass("qm-layout--mobile-unit");
  });

  it("the persona choice is memory only", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const t = await openBuilder();
    await t.user.click(within(t.preview).getByRole("button", { name: "Officer" }));
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    setItem.mockRestore();
  });

  it("a site item selected in the tree shows the empty state; the panel keeps what was typed", async () => {
    const t = await openBuilder();
    await t.user.type(within(t.preview).getByLabelText("Plate"), "ZZ-1234");
    await selectBuilderItem(t.user, "commands");
    expect(
      within(t.preview).getByText("Select a query type or field to preview it."),
    ).toBeInTheDocument();
    expect(panelOf(t.preview)).toHaveAttribute("hidden");
    const nav = await screen.findByRole("navigation", { name: "Configuration items" });
    await t.user.click(within(nav).getByRole("button", { name: /^Vehicle VEH/ }));
    expect(within(t.preview).queryByText("Select a query type or field to preview it.")).toBeNull();
    expect(panelOf(t.preview)).not.toHaveAttribute("hidden");
    expect(within(t.preview).getByLabelText("Plate")).toHaveValue("ZZ-1234");
  });

  it("paused: the last valid preview stays, dimmed and inert, under a banner; never presented as current", async () => {
    const t = await openBuilder();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    const banner = await within(t.preview).findByText(
      "Preview paused: 1 error. Showing the last valid version.",
    );
    // Not a live region of its own: the builder's polite summary is the only announcer.
    expect(banner.closest("[aria-live], [role=status], [role=alert]")).toBeNull();
    expect(within(t.preview).getByRole("button", { name: "Go to the error" })).toBeInTheDocument();
    const panel = panelOf(t.preview);
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveAttribute("data-paused", "true");
    expect(within(panel).getByRole("button", { name: "Vehicle" })).toBeInTheDocument();
    // A valid edit resumes it.
    await edit(t, (d) => ({ ...d, quickAccess: ["VEH", "PER"] }));
    await waitFor(() => expect(within(t.preview).queryByText(/Preview paused/)).toBeNull());
    expect(panelOf(t.preview)).not.toHaveAttribute("inert");
  });

  it("paused: the count is exact, singular and plural", async () => {
    const t = await openBuilder();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE", "NOPE2"] }));
    expect(
      await within(t.preview).findByText(
        "Preview paused: 2 errors. Showing the last valid version.",
      ),
    ).toBeInTheDocument();
  });

  it("paused with a site item selected: the banner stays, and does not claim a version is shown", async () => {
    const t = await openBuilder();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    await selectBuilderItem(t.user, "commands");
    expect(within(t.preview).getByText("Preview paused: 1 error.")).toBeInTheDocument();
    expect(
      within(t.preview).getByText("Select a query type or field to preview it."),
    ).toBeVisible();
    expect(within(t.preview).getByRole("button", { name: "Go to the error" })).toBeInTheDocument();
  });

  it("when the pause ends and the banner held the repaired focus, focus returns to the panel", async () => {
    const t = await openBuilder();
    await t.user.click(within(t.preview).getByLabelText("Plate"));
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    await waitFor(() =>
      expect(within(t.preview).getByRole("button", { name: "Go to the error" })).toHaveFocus(),
    );
    await edit(t, (d) => ({ ...d, quickAccess: ["VEH", "PER"] }));
    await waitFor(() =>
      expect(panelOf(t.preview)).toContainElement(document.activeElement as HTMLElement),
    );
  });
  it("Go to the error selects the first error's item and focuses its control", async () => {
    const t = await openBuilder();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    await t.user.click(await within(t.preview).findByRole("button", { name: "Go to the error" }));
    const editor = screen.getByRole("tabpanel");
    await waitFor(() => expect(editor).toContainElement(document.activeElement as HTMLElement));
    expect(document.activeElement).not.toBe(document.body);
    // The control the error describes: its message sits in the same editor.
    const message = document.activeElement?.getAttribute("aria-describedby")?.split(" ")[0] ?? "";
    expect(editor.querySelector(`[id="${message}"]`)).not.toBeNull();
  });

  it("focus that was inside the preview when it pauses moves to Go to the error (lost-focus repair)", async () => {
    const t = await openBuilder();
    await t.user.click(within(t.preview).getByLabelText("Plate"));
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    await waitFor(() =>
      expect(within(t.preview).getByRole("button", { name: "Go to the error" })).toHaveFocus(),
    );
  });

  it("paused never moves focus that was elsewhere", async () => {
    const t = await openBuilder();
    const raw = screen.getByRole("tab", { name: "Raw JSON" });
    await t.user.click(raw);
    expect(raw).toHaveFocus();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    await within(t.preview).findByText(/Preview paused/);
    expect(raw).toHaveFocus();
  });

  it("loading: with no valid config to show yet the preview is a busy skeleton", async () => {
    // A draft with errors and no cached live config: nothing valid to show.
    const services = testServices();
    render(
      <ServicesProvider services={services}>
        <I18nProvider translator={createTranslator("en", EN_BUNDLE)}>
          <BuilderPreview
            doc={{}}
            labels={{}}
            blocked
            pending={false}
            selected="/queryTypes/0"
            errorCount={2}
            parseError={false}
          />
        </I18nProvider>
      </ServicesProvider>,
    );
    const preview = screen.getByRole("region", { name: "Live preview" });
    const skeleton = within(preview).getByText("Loading the preview").closest("[aria-busy]");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton?.querySelector("[role=status], [aria-live]")).toBeNull();
    expect(preview).toHaveAttribute("aria-busy", "true");
    // Paused with nothing to show: the banner does not claim a last valid version.
    expect(within(preview).getByText("Preview paused: 2 errors.")).toBeInTheDocument();
    expect(within(preview).queryByRole("button", { name: "Go to the error" })).toBeNull();
  });

  it("loading ends when the live config failed: no skeleton, not busy, the banner alone", async () => {
    const services = testServices();
    await services.queryClient
      .fetchQuery({
        queryKey: ["config"],
        queryFn: () => Promise.reject(new Error("down")),
        retry: false,
      })
      .catch(() => undefined);
    render(
      <ServicesProvider services={services}>
        <I18nProvider translator={createTranslator("en", EN_BUNDLE)}>
          <BuilderPreview
            doc={{}}
            labels={{}}
            blocked
            pending={false}
            selected="/queryTypes/0"
            errorCount={1}
            parseError={false}
          />
        </I18nProvider>
      </ServicesProvider>,
    );
    const preview = screen.getByRole("region", { name: "Live preview" });
    expect(within(preview).queryByText("Loading the preview")).toBeNull();
    expect(preview).not.toHaveAttribute("aria-busy");
    expect(within(preview).getByText("Preview paused: 1 error.")).toBeInTheDocument();
  });
});
