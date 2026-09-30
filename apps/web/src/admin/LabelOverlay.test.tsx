import { act, screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { selectBuilderItem } from "../test/builder-tree.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// A-D2 item 2: the Labels and translations screen. Each row's title is the label key in mono, with
// the English text beside it (the one place keys are shown as titles); everything else is plain.

async function openLabels() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  await selectBuilderItem(t.user, "Label text");
  return t;
}

type Opened = Awaited<ReturnType<typeof openLabels>>;
const store = (t: Opened) => configDraftStore(t.services).getState();

/** A locale's ruled section, by its title (never a name query over the whole builder). */
async function section(locale: string): Promise<HTMLElement> {
  const h = await screen.findByText(`Texts for ${locale}`, { selector: "h4" });
  return h.closest(".qm-sect") as HTMLElement;
}

describe("Labels and translations (A-D2 item 2)", () => {
  it("is a ruled section per locale with its own group, and says so when there are no changes", async () => {
    await openLabels();
    const sect = await section("en");
    expect(within(sect).getByRole("group", { name: "Texts for en" })).toBeInTheDocument();
    expect(within(sect).getByText("No text changes yet.")).toBeInTheDocument();
  });

  it("adds a label with plain names, and the new row's title is the key in mono", async () => {
    const t = await openLabels();
    const sect = await section("en");
    await t.user.type(within(sect).getByLabelText("Label key"), "site.custom");
    await t.user.type(within(sect).getByLabelText("Text"), "Custom");
    await t.user.click(within(sect).getByRole("button", { name: "Add label" }));
    expect(store(t).labels).toEqual({ en: { "site.custom": "Custom" } });
    const input = within(sect).getByLabelText("site.custom");
    expect(input).toHaveValue("Custom");
    // The row title is a label around a <code> element: the key, in mono.
    const title = document.querySelector(`label[for="${input.id}"]`);
    expect(title?.querySelector("code")).toHaveTextContent("site.custom");
    expect(within(sect).queryByText("No text changes yet.")).toBeNull();
    // The add form is empty again.
    expect(within(sect).getByLabelText("Label key")).toHaveValue("");
    expect(within(sect).getByLabelText("Text")).toHaveValue("");
  });

  it("Add label stays focusable and gives its reason while the key is empty, and does nothing", async () => {
    const t = await openLabels();
    const sect = await section("en");
    const add = within(sect).getByRole("button", { name: "Add label" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).not.toBeDisabled();
    expect(add).toHaveAccessibleDescription("Enter a label key first.");
    await t.user.click(add);
    expect(store(t).labels).toEqual({});
    await t.user.type(within(sect).getByLabelText("Label key"), "a.b");
    expect(add).not.toHaveAttribute("aria-disabled");
  });

  it("another locale's row shows the English text beside the key, and follows an English edit", async () => {
    const t = await openLabels();
    act(() => {
      store(t).setPath(["locales"], ["en", "fr"]);
      store(t).setLabel("en", "queryType.VEH", "Vehicle");
      store(t).setLabel("fr", "queryType.VEH", "Voiture");
    });
    server.use(http.get(`${API}/api/v1/locales/fr`, () => new HttpResponse(null, { status: 404 })));
    const fr = await section("fr");
    const input = within(fr).getByLabelText("queryType.VEH");
    expect(input).toHaveValue("Voiture");
    expect(input).toHaveAccessibleDescription("English text: Vehicle");
    const en = await section("en");
    // In the English section the input is the English text: no second copy beside the key.
    expect(within(en).getByLabelText("queryType.VEH")).toHaveValue("Vehicle");
    expect(within(en).queryByText(/English text:/)).toBeNull();
    await t.user.clear(within(en).getByLabelText("queryType.VEH"));
    await t.user.type(within(en).getByLabelText("queryType.VEH"), "Car");
    expect(within(fr).getByLabelText("queryType.VEH")).toHaveAccessibleDescription(
      "English text: Car",
    );
  });

  it("a key with no English text says so", async () => {
    const t = await openLabels();
    act(() => {
      store(t).setPath(["locales"], ["en", "fr"]);
      store(t).setLabel("fr", "site.only.fr", "Seulement");
    });
    const fr = await section("fr");
    expect(within(fr).getByLabelText("site.only.fr")).toHaveAccessibleDescription(
      "English text: none",
    );
  });
});
