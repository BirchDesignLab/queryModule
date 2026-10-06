import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { selectBuilderItem } from "../test/builder-tree.js";
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
import { parseMock } from "./mock-model.js";

beforeAll(preloadAdminRoutes);

// Task 4 (#551, CFG-2; spec 5.4): the new query type and new source flows on a mock site. A type
// that asks a mock source with no response shows the gap in the type editor with "Add mock
// response" (a no-record scaffold); a new source offers one no-record response per type that asks it.
// Synthetic fixtures only; no payload value goes into a name or an announcement.

async function openBuilder(mock: Record<string, unknown> | null = RAW_MOCK) {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => HttpResponse.json(CLIENT_CONFIG)),
    http.get(`${API}/api/v1/admin/config`, () =>
      HttpResponse.json(adminConfigBody(mock === null ? {} : { mock })),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const store = (t: Opened) => configDraftStore(t.services).getState();
const draftMock = (t: Opened) => {
  const parsed = parseMock(store(t).mock);
  if (!parsed.ok) throw new Error("the draft's mock is not a mock file");
  return parsed.mock;
};
const typeCount = (t: Opened) => (store(t).doc as { queryTypes: unknown[] }).queryTypes.length;

/** Adds a query type through its button, then gives it a code and the sources it asks. */
async function addType(t: Opened, code: string, sourceIds: string[]) {
  await t.user.click(await screen.findByRole("button", { name: "Add query type" }));
  const at = typeCount(t) - 1;
  act(() => {
    store(t).setPath(["queryTypes", at, "code"], code);
    store(t).setPath(
      ["queryTypes", at, "sources"],
      sourceIds.map((sourceId) => ({ sourceId, selectedByDefault: true })),
    );
  });
  return at;
}
const mockGroup = () => screen.findByRole("group", { name: "Mock responses for this type" });

describe("a new query type on a mock site", () => {
  it("shows each mock source it asks as Missing, with an Add mock response button naming both", async () => {
    const t = await openBuilder();
    await addType(t, "BOAT", ["stateSource", "nationalSource"]);
    const group = within(await mockGroup());
    expect(group.getAllByText("Missing")).toHaveLength(2);
    expect(
      group.getByRole("button", { name: /Add mock response for State system, BOAT/ }),
    ).toBeInTheDocument();
    expect(
      group.getByRole("button", { name: /Add mock response for National system, BOAT/ }),
    ).toBeInTheDocument();
  });

  it("adds a no-record response, clears that gap, and keeps focus in the section", async () => {
    const t = await openBuilder();
    await addType(t, "BOAT", ["stateSource", "nationalSource"]);
    const group = within(await mockGroup());
    await t.user.click(
      group.getByRole("button", { name: /Add mock response for State system, BOAT/ }),
    );
    const added = draftMock(t).sources.stateSource?.responses.find((r) => r.queryType === "BOAT");
    expect(added).toEqual({ queryType: "BOAT", default: { status: "NO RECORD" }, scenarios: [] });
    // The other source is still missing; the one just added is not, and focus did not drop to the page.
    expect(group.getAllByText("Missing")).toHaveLength(1);
    expect(draftMock(t).sources.nationalSource?.responses.some((r) => r.queryType === "BOAT")).toBe(
      false,
    );
    expect(document.body).not.toHaveFocus();
    expect(
      within(await mockGroup()).getByRole("button", { name: /Open mock response/ }),
    ).toHaveFocus();
  });

  it("Open mock response selects the response and puts focus on its heading", async () => {
    const t = await openBuilder();
    await addType(t, "BOAT", ["stateSource"]);
    await t.user.click(
      within(await mockGroup()).getByRole("button", { name: /Add mock response for State system/ }),
    );
    await t.user.click(
      within(await mockGroup()).getByRole("button", {
        name: /Open mock response for State system/,
      }),
    );
    // The type editor is gone; the response's own heading holds focus (never the page).
    await waitFor(() => expect(screen.getByRole("heading", { name: /BOAT/ })).toHaveFocus());
  });

  it("Add all adds one no-record response for each missing source, one undo step", async () => {
    const t = await openBuilder();
    await addType(t, "BOAT", ["stateSource", "nationalSource"]);
    const before = store(t).undoCount;
    await t.user.click(
      within(await mockGroup()).getByRole("button", { name: /Add a no-record response for each/ }),
    );
    expect(draftMock(t).sources.stateSource?.responses.some((r) => r.queryType === "BOAT")).toBe(
      true,
    );
    expect(draftMock(t).sources.nationalSource?.responses.some((r) => r.queryType === "BOAT")).toBe(
      true,
    );
    expect(store(t).undoCount).toBe(before + 1);
    expect(within(await mockGroup()).queryByText("Missing")).not.toBeInTheDocument();
  });

  it("the issue count drops by the gap when it is filled (publish stays blocked until it is)", async () => {
    const t = await openBuilder();
    // A valid type (a copy of Vehicle under a new code): a half-made one has no readable site yet,
    // so the browser raises no coverage finding for it; the panel above still shows its gap.
    act(() => {
      const vehicle = (store(t).doc as { queryTypes: Record<string, unknown>[] }).queryTypes.find(
        (q) => q.code === "VEH",
      );
      store(t).setPath(["queryTypes", typeCount(t)], {
        ...structuredClone(vehicle),
        code: "BOAT",
        sources: [{ sourceId: "stateSource", selectedByDefault: true }],
      });
    });
    await t.user.click(await screen.findByRole("treeitem", { name: /BOAT/ }));
    // The checks run after a pause: wait for the badge, then read it fresh each time.
    await screen.findByRole("button", { name: /\d+ errors?/ });
    const errors = () =>
      Number(
        /(\d+) error/.exec(document.querySelector(".qm-builder__issues")?.textContent ?? "")?.[1],
      );
    const before = errors();
    expect(before).toBeGreaterThan(0);
    await t.user.click(
      within(await mockGroup()).getByRole("button", { name: /Add mock response for State system/ }),
    );
    await waitFor(() => expect(errors()).toBe(before - 1), { timeout: 4000 });
  });

  it("announces the addition with ids and counts only, never a value", async () => {
    const t = await openBuilder();
    await addType(t, "BOAT", ["stateSource"]);
    await t.user.click(
      within(await mockGroup()).getByRole("button", { name: /Add mock response for State system/ }),
    );
    const status = [...document.querySelectorAll('[role="status"]')]
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(status).toMatch(/Mock response added: State system, BOAT\. Default: no record\./);
  });

  it("says what is needed while the type has no code or no source yet, and offers no button", async () => {
    const t = await openBuilder();
    await t.user.click(await screen.findByRole("button", { name: "Add query type" }));
    const group = within(await mockGroup());
    expect(group.getByText(/code and at least one source/i)).toBeInTheDocument();
    expect(group.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  });

  it("an existing type that is fully covered reports that, not a gap", async () => {
    const t = await openBuilder();
    await t.user.click(await screen.findByRole("treeitem", { name: /Vehicle VEH/ }));
    const group = within(await mockGroup());
    expect(group.queryByText("Missing")).not.toBeInTheDocument();
    expect(group.getAllByRole("button", { name: /Open mock response/ })).toHaveLength(2);
  });

  it("does not appear on a site without mock responses", async () => {
    const t = await openBuilder(null);
    await addType(t, "BOAT", ["stateSource"]);
    expect(screen.queryByRole("group", { name: "Mock responses for this type" })).toBeNull();
  });
});

describe("a new source on a mock site", () => {
  async function addSource(t: Opened, id: string, askedBy: string[]) {
    act(() => {
      const doc = store(t).doc as { sources: unknown[]; queryTypes: { code: string }[] };
      store(t).setPath(
        ["sources"],
        [
          ...doc.sources,
          {
            id,
            labelKey: `source.${id}`,
            scope: "state",
            kind: "mock",
            timeoutMs: 10000,
            maxConcurrent: 4,
            requiresCredentials: false,
          },
        ],
      );
      doc.queryTypes.forEach((q, i) => {
        if (!askedBy.includes(q.code)) return;
        const current = (store(t).doc as { queryTypes: { sources: unknown[] }[] }).queryTypes[i];
        store(t).setPath(
          ["queryTypes", i, "sources"],
          [...(current?.sources ?? []), { sourceId: id, selectedByDefault: true }],
        );
      });
    });
    await selectBuilderItem(t.user, "sources");
  }
  const panel = () => screen.findByRole("group", { name: "Mock responses to add" });

  it("offers one no-record response for each query type that asks it, and adds them in one step", async () => {
    const t = await openBuilder();
    await addSource(t, "countySource", ["VEH", "PER"]);
    const before = store(t).undoCount;
    await t.user.click(
      within(await panel()).getByRole("button", {
        name: /Add a no-record response for each query type that asks countySource/,
      }),
    );
    const source = draftMock(t).sources.countySource;
    expect(source?.responses.map((r) => r.queryType).sort()).toEqual(["PER", "VEH"]);
    expect(source?.latencyMs).toEqual([50, 400]);
    for (const r of source?.responses ?? [])
      expect(r).toEqual({
        queryType: r.queryType,
        default: { status: "NO RECORD" },
        scenarios: [],
      });
    expect(store(t).undoCount).toBe(before + 1);
    expect(document.body).not.toHaveFocus();
  });

  it("Open mock source puts focus on the source's heading", async () => {
    const t = await openBuilder();
    await addSource(t, "countySource", ["VEH"]);
    await t.user.click(
      within(await panel()).getByRole("button", { name: /Add a no-record response for each/ }),
    );
    await t.user.click(within(await panel()).getByRole("button", { name: /Open mock source/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /countySource/ })).toHaveFocus(),
    );
  });

  it("says no query type asks the source yet, and offers no button", async () => {
    const t = await openBuilder();
    await addSource(t, "countySource", []);
    const group = within(await panel());
    expect(group.getByText(/No query type asks countySource yet/)).toBeInTheDocument();
    expect(group.queryByRole("button", { name: /Add a no-record response/ })).toBeNull();
  });

  it("shows nothing for sources that already have their responses", async () => {
    const t = await openBuilder();
    await selectBuilderItem(t.user, "sources");
    expect(screen.queryByRole("group", { name: "Mock responses to add" })).toBeNull();
  });
});
