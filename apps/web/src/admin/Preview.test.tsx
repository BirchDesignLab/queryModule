import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { API, server, submitRecorder, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";
import type { JsonObject } from "./draft.js";

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
  const preview = await screen.findByRole("region", { name: "Dispatcher preview" });
  await within(preview).findByRole("button", { name: "Submit" });
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
    const submit = within(preview).getByRole("button", { name: "Submit" });
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
    await t.user.click(within(t.preview).getByRole("button", { name: "Submit" }));
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
      await within(t.preview).findByText("Preview paused: fix the errors to update it."),
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
      await within(t.preview).findByText("Preview paused: fix the errors to update it."),
    ).toBeInTheDocument();
  });

  it("critic 5: a draft reset clears the preview draft", async () => {
    const t = await openBuilder();
    await t.user.type(within(t.preview).getByLabelText("Plate"), "ZZ-1234");
    act(() => store(t).reset());
    const preview = await screen.findByRole("region", { name: "Dispatcher preview" });
    expect(await within(preview).findByLabelText("Plate")).toHaveValue("");
  });

  it("critic 2: reopening the builder on a draft with errors still shows a preview", async () => {
    const t = await openBuilder();
    await edit(t, (d) => ({ ...d, quickAccess: ["NOPE"] }));
    await within(t.preview).findByText("Preview paused: fix the errors to update it.");
    await t.user.click(screen.getByRole("link", { name: "Status" }));
    await t.user.click(await screen.findByRole("link", { name: "Admin" }));
    const preview = await screen.findByRole("region", { name: "Dispatcher preview" });
    // The panel shows (from the live site config), not only the paused note.
    expect(await within(preview).findByRole("button", { name: "Submit" })).toBeInTheDocument();
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
