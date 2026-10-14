import { act, screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import {
  API,
  adminConfigBody,
  CLIENT_CONFIG,
  RAW_MOCK,
  server,
  TEST_USER,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";
import type { JsonObject } from "./draft.js";
import { moveScenario, parseMock } from "./mock-model.js";

beforeAll(preloadAdminRoutes);

// Task 12 (#565; FR-043, FR-044; spec 5.4; CFG-2): the Try a match pane beside the mock editor. The
// admin picks a source and a query type, types values, and sees which scenario of the draft's mock
// the shared matcher picks. Typed values stay in the pane's state: never the draft, Review or storage.
// Synthetic values only (ZZ-####).

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () =>
      HttpResponse.json(adminConfigBody({ mock: RAW_MOCK })),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  const nav = await screen.findByRole("navigation", { name: "Configuration items" });
  const tree = within(nav).getByRole("tree", { name: "Mock responses" });
  await t.user.click(within(tree).getByRole("treeitem", { name: /^Coverage/ }));
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const pane = () => screen.getByRole("region", { name: "Try a match" });

async function tryVehicle(t: Opened, plate: string) {
  const p = within(await screen.findByRole("region", { name: "Try a match" }));
  await t.user.selectOptions(p.getByLabelText("Source"), "stateSource");
  await t.user.selectOptions(p.getByLabelText("Query type"), "VEH");
  const input = p.getByLabelText("Plate");
  await t.user.clear(input);
  await t.user.type(input, plate);
}

describe("Try a match", () => {
  it("typed ZZ-0001 on the state system's Vehicle shows scenario 1 and its STOLEN record", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0001");
    const p = within(pane());
    expect(p.getByText(/^Scenario 1 matches/)).toBeInTheDocument();
    expect(p.getByText(/Plate is ZZ-0001/)).toBeInTheDocument();
    expect(p.getByText("Result: Returns a record")).toBeInTheDocument();
    expect(p.getByTestId("try-payload").textContent).toContain('"status": "STOLEN"');
  });

  it("an unmatched plate shows the default answer", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0099");
    const p = within(pane());
    expect(p.getByText("No scenario matches: the default answers.")).toBeInTheDocument();
    expect(p.getByText("Result: No record")).toBeInTheDocument();
  });

  it("a behaviour scenario shows the behaviour, not a payload", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "FAIL1");
    const p = within(pane());
    expect(p.getByText(/^Scenario 3 matches/)).toBeInTheDocument();
    expect(p.getByText("Result: Source error")).toBeInTheDocument();
    expect(p.queryByTestId("try-payload")).not.toBeInTheDocument();
  });

  it("follows the draft: reordering the scenarios changes the match", async () => {
    const t = await openBuilder();
    await tryVehicle(t, "ZZ-0001");
    expect(within(pane()).getByText(/^Scenario 1 matches/)).toBeInTheDocument();
    const store = configDraftStore(t.services).getState();
    act(() => {
      const parsed = parseMock(store.mock);
      if (!parsed.ok) throw new Error("no mock");
      store.setMock(
        moveScenario(
          parsed.mock,
          { sourceId: "stateSource", response: 0, scenario: 0 },
          2,
        ) as unknown as JsonObject,
      );
    });
    expect(within(pane()).getByText(/^Scenario 3 matches/)).toBeInTheDocument();
  });

  it("typed values never reach the draft, Review or storage", async () => {
    const t = await openBuilder();
    const store = configDraftStore(t.services);
    const before = JSON.stringify([store.getState().doc, store.getState().mock]);
    await tryVehicle(t, "ZZ-0042");
    expect(JSON.stringify([store.getState().doc, store.getState().mock])).toBe(before);
    expect(store.getState().undoCount).toBe(0);
    const stored = [localStorage, sessionStorage].flatMap((s) =>
      Object.keys(s).map((k) => `${k}=${s.getItem(k)}`),
    );
    expect(stored.join("\n")).not.toContain("ZZ-0042");
    await t.user.click(screen.getByRole("tab", { name: /^Changes/ }));
    expect(document.body.textContent).not.toMatch(/ZZ-0042/);
  });
});
