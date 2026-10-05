import type { MockFile } from "@querymodule/core/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
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
import {
  addScenario,
  parseMock,
  removeScenario,
  setResponseDefault,
  updateScenario,
} from "./mock-model.js";

beforeAll(preloadAdminRoutes);

// Task 3b (#550, CFG-2): mock changes in the Changes view and the publish dialog, and the mock's
// findings in the issues list. Lines carry names and counts, never trigger values or payload
// content (Q2, developer 10-05-26). Synthetic fixtures only.

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
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const edit = (t: Opened, change: (m: MockFile) => MockFile) =>
  act(() => {
    const store = configDraftStore(t.services).getState();
    const parsed = parseMock(store.mock);
    if (!parsed.ok) throw new Error("fixture");
    store.setMock(change(parsed.mock) as Record<string, unknown>);
  });
const openChanges = (t: Opened) => t.user.click(screen.getByRole("tab", { name: "Changes" }));
const view = () => screen.getByRole("region", { name: "Changes from the live version" });

describe("mock changes in the Changes view", () => {
  it("a scenario added, changed and removed are one line each, under Mock responses", async () => {
    const t = await openBuilder();
    edit(t, (m) =>
      removeScenario(
        updateScenario(
          addScenario(m, "nationalSource", 0, { when: { plate: "ZZ-0003" }, behavior: "error" }),
          { sourceId: "stateSource", response: 2, scenario: 0 },
          { when: { serial: "ZZSTOLEN1" }, behavior: "timeout" },
        ),
        { sourceId: "stateSource", response: 0, scenario: 2 },
      ),
    );
    await openChanges(t);
    const group = (
      await screen.findByRole("heading", { level: 4, name: "Mock responses" })
    ).closest("section") as HTMLElement;
    const lines = within(group)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.includes("Scenario 3 added"))).toContain("National system, Vehicle");
    expect(lines.find((l) => l.includes("Scenario 1 changed"))).toContain("State system, Property");
    expect(lines.find((l) => l.includes("Scenario 3 removed"))).toContain("State system, Vehicle");
  });

  it("carries no trigger value and no payload content", async () => {
    const t = await openBuilder();
    edit(t, (m) =>
      addScenario(m, "nationalSource", 0, {
        when: { plate: "ZZ-7777" },
        respond: { remarks: "SECRETWORD" },
      }),
    );
    await openChanges(t);
    await screen.findByRole("heading", { level: 4, name: "Mock responses" });
    expect(view().textContent).not.toContain("ZZ-7777");
    expect(view().textContent).not.toContain("SECRETWORD");
  });

  it("an entry opens its response in the Form view", async () => {
    const t = await openBuilder();
    edit(t, (m) => setResponseDefault(m, "stateSource", 0, { status: "STOLEN" }));
    await openChanges(t);
    await t.user.click(await screen.findByRole("button", { name: /State system, Vehicle/ }));
    expect(await screen.findByRole("heading", { name: /Vehicle/, level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true");
  });

  it("a draft with no mock change shows no Mock responses group", async () => {
    const t = await openBuilder();
    await openChanges(t);
    await screen.findByTestId("diff-empty");
    expect(
      screen.queryByRole("heading", { level: 4, name: "Mock responses" }),
    ).not.toBeInTheDocument();
  });

  it("a mock change alone is not 'no differences'", async () => {
    const t = await openBuilder();
    edit(t, (m) => ({ ...m, siteId: "other" }));
    await openChanges(t);
    await screen.findByRole("heading", { level: 4, name: "Mock responses" });
    expect(screen.queryByTestId("diff-empty")).not.toBeInTheDocument();
  });
});

describe("the mock's findings in the issues list", () => {
  const errorBadge = () => screen.findByRole("button", { name: /Go to the first issue/ });

  it("a fixture finding is counted, and Enter on the issue button focuses its row", async () => {
    const t = await openBuilder();
    edit(t, (m) =>
      setResponseDefault(m, "stateSource", 0, { status: "STOLEN", plate: "REALPLATE1" }),
    );
    const badge = await errorBadge();
    expect(badge).toHaveTextContent(/1 error/);
    badge.focus();
    await t.user.keyboard("{Enter}");
    const plate = await screen.findByLabelText("Value for plate");
    await waitFor(() => expect(plate).toHaveFocus());
    expect(plate).toHaveAttribute("aria-invalid", "true");
  });

  it("a finding inside a closed scenario opens it and focuses the row", async () => {
    const t = await openBuilder();
    edit(t, (m) =>
      updateScenario(
        m,
        { sourceId: "stateSource", response: 0, scenario: 0 },
        {
          when: { plate: "ZZ-0001" },
          respond: { status: "STOLEN", last: "SMITH" },
        },
      ),
    );
    const badge = await errorBadge();
    badge.focus();
    await t.user.keyboard("{Enter}");
    const last = await screen.findByLabelText("Value for last");
    await waitFor(() => expect(last).toHaveFocus());
    expect(last).toHaveAttribute("aria-invalid", "true");
  });

  it("a coverage gap goes to the Missing cell's Add button", async () => {
    const t = await openBuilder();
    edit(t, (m) => {
      const state = m.sources.stateSource;
      if (state === undefined) return m;
      return {
        ...m,
        sources: {
          ...m.sources,
          stateSource: { ...state, responses: state.responses.filter((r) => r.queryType !== "DL") },
        },
      };
    });
    const badge = await errorBadge();
    badge.focus();
    await t.user.keyboard("{Enter}");
    const add = await screen.findByRole("button", {
      name: /Add mock response for State system, Driver's license/,
    });
    await waitFor(() => expect(add).toHaveFocus());
  });
});
