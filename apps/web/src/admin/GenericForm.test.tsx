import { act, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { selectBuilderItem } from "../test/builder-tree.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// #388: generic form edge cases (boolean, number, server-side settings, label overlay ids).

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
const doc = (t: Opened) => configDraftStore(t.services).getState().doc as Record<string, never>;

async function openSection(t: Opened, name: string) {
  if (name !== "queryTypes") await selectBuilderItem(t.user, name);
}

describe("generic form edge cases (#388, UX-004)", () => {
  it("a boolean leaf toggles through its checkbox", async () => {
    const t = await openBuilder();
    await openSection(t, "features");
    await t.user.click(screen.getByLabelText(/ features\.credentials$/));
    expect((doc(t).features as Record<string, boolean>).credentials).toBe(true);
  });

  it("non-numeric text in a number field is flagged and not written", async () => {
    const t = await openBuilder();
    await openSection(t, "delegation");
    const input = screen.getByLabelText(/ delegation\.maxDurationMinutes$/);
    await t.user.type(input, "a");
    expect(input).toHaveValue("480a");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/enter a number/i);
    expect((doc(t).delegation as Record<string, number>).maxDurationMinutes).toBe(480);
    await t.user.type(input, "{Backspace}");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("a source timeout is read-only in the form and says it is a server setting", async () => {
    const t = await openBuilder();
    await openSection(t, "sources");
    const input = screen.getByLabelText(/ sources\.0\.timeoutMs$/);
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAccessibleDescription(/server setting/i);
  });

  it("label overlay controls get id-safe ids for keys with spaces", async () => {
    const t = await openBuilder();
    await openSection(t, "Label text");
    await t.user.type(screen.getByLabelText("Label key (en)"), "odd key");
    await t.user.type(screen.getByLabelText("Label text (en)"), "Odd");
    await t.user.click(screen.getByRole("button", { name: "Add label (en)" }));
    const input = screen.getByLabelText("odd key");
    expect(input.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(input).toHaveValue("Odd");
  });
});

describe("#388 root issues", () => {
  it("issues with no control of their own describe the form", async () => {
    const t = await openBuilder();
    act(() => configDraftStore(t.services).getState().setPath(["sources"], undefined));
    const form = await screen.findByTestId("form-tab");
    await waitFor(() => expect(form).toHaveAccessibleDescription(/^Error:/));
  });
});
