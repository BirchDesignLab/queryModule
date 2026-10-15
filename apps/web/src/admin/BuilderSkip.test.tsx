import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { API, adminConfigBody, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";

beforeAll(preloadAdminRoutes);

// Re-walk R18: the builder's tab chain ran to 40 to 70 stops between the tree, the editor and the
// preview. Two skip buttons ahead of the panes jump straight to the editor or the preview.

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () => HttpResponse.json(adminConfigBody())),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}

describe("builder skip controls (R18)", () => {
  it("come before the tree, in tab order: Skip to editor, then Skip to preview", async () => {
    await openBuilder();
    const toEditor = screen.getByRole("button", { name: "Skip to editor" });
    const toPreview = screen.getByRole("button", { name: "Skip to preview" });
    const tree = screen.getByRole("navigation", { name: "Configuration items" });
    expect(
      toEditor.compareDocumentPosition(toPreview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toPreview.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Skip to editor moves focus to the editor pane", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("button", { name: "Skip to editor" }));
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });

  it("Skip to preview moves focus to the preview pane, which keeps its name", async () => {
    const t = await openBuilder();
    await t.user.click(screen.getByRole("button", { name: "Skip to preview" }));
    const preview = document.querySelector<HTMLElement>(".qm-admin__preview");
    expect(preview).not.toBeNull();
    expect(preview).toHaveFocus();
    expect(preview).toHaveAccessibleName();
  });

  it("works from the keyboard with Enter", async () => {
    const t = await openBuilder();
    screen.getByRole("button", { name: "Skip to editor" }).focus();
    await t.user.keyboard("{Enter}");
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });
});
