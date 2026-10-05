import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import {
  API,
  adminConfigBody,
  CLIENT_CONFIG,
  RAW_MOCK,
  server,
  TEST_USER,
  versionRow,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// Task 2 (#548, CFG-2): a mock-only edit counts as a change, is unsaved, and goes to the server
// with the saved draft. Synthetic fixtures only.

const puts: { baseVersion: number; document: { mock?: Record<string, unknown> } }[] = [];

async function openBuilder() {
  puts.length = 0;
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () =>
      HttpResponse.json(adminConfigBody({ mock: RAW_MOCK })),
    ),
    http.put(`${API}/api/v1/admin/config/draft`, async ({ request }) => {
      puts.push((await request.json()) as (typeof puts)[number]);
      return HttpResponse.json(versionRow(2, "draft"));
    }),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}

const editedMock = () => ({
  ...RAW_MOCK,
  sources: {
    ...(RAW_MOCK.sources as Record<string, { latencyMs: number[] }>),
    stateSource: {
      ...(RAW_MOCK.sources as Record<string, { latencyMs: number[] }>).stateSource,
      latencyMs: [10, 20],
    },
  },
});

describe("a mock edit in the draft", () => {
  it("is one unpublished change, unsaved, until it is saved", async () => {
    const t = await openBuilder();
    const status = () => screen.getByTestId("draft-status");
    expect(status()).toHaveTextContent("No unpublished changes.");
    configDraftStore(t.services).getState().setMock(editedMock());
    await waitFor(() => expect(status()).toHaveTextContent("1 unpublished change."));
    expect(status()).toHaveTextContent("Not saved yet");
  });

  it("Save sends the edited mock with the draft", async () => {
    const t = await openBuilder();
    configDraftStore(t.services).getState().setMock(editedMock());
    await t.user.click(await screen.findByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.document.mock).toEqual(editedMock());
  });

  it("an unedited mock goes back exactly as it came", async () => {
    const t = await openBuilder();
    configDraftStore(t.services).getState().setPath(["terminal", "delimiter"], ";");
    await t.user.click(await screen.findByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.document.mock).toEqual(RAW_MOCK);
  });
});
