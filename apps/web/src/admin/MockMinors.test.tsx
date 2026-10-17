import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { parseMock } from "./mock-model.js";

beforeAll(preloadAdminRoutes);

// Task 12 (#572, CFG-2; spec 5.4, 6.6): the mock editor minors left from #571 and #577. Synthetic
// fixtures only (ZZ-####, Testerson); no payload value goes into a name or an announcement.

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

const store = (t: Opened) => configDraftStore(t.services).getState();
const draftMock = (t: Opened) => {
  const parsed = parseMock(store(t).mock);
  if (!parsed.ok) throw new Error("the draft's mock is not a mock file");
  return parsed.mock;
};
const mockTree = async () =>
  within(await screen.findByRole("navigation", { name: "Configuration items" })).getByRole("tree", {
    name: "Mock responses",
  });
async function selectRow(user: UserEvent, name: RegExp) {
  const row = within(await mockTree()).getAllByRole("treeitem", { name })[0];
  if (row === undefined) throw new Error(`no tree row ${String(name)}`);
  await user.click(row);
  return row;
}
const scenarioCard = (n: number) => screen.getByRole("group", { name: `Scenario ${n}` });
const editMock = (t: Opened, change: (m: Record<string, unknown>) => void) =>
  act(() => {
    const m = structuredClone(draftMock(t)) as unknown as Record<string, unknown>;
    change(m);
    store(t).setMock(m as JsonObject);
  });
const status = () =>
  [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? "").join(" ");

describe("payload values and keys", () => {
  it("a number value keeps its dot while typing: 1901. on the way to 1901.5", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Mock response: Vehicle, State system VEH/);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    const year = within(scenarioCard(1)).getByLabelText(/^Value for year/);
    await t.user.clear(year);
    await t.user.type(year, "1901.");
    expect(year).toHaveValue("1901.");
    await t.user.type(year, "5");
    expect(year).toHaveValue("1901.5");
    const vehicle = draftMock(t).sources.stateSource?.responses[0]?.scenarios[0]?.respond
      ?.vehicle as Record<string, unknown>;
    expect(vehicle.year).toBe(1901.5);
  });

  it("renaming a key is one undo step, and a refused rename says why", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Mock response: Vehicle, State system VEH/);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    const card = within(scenarioCard(1));
    const key = card
      .getAllByLabelText(/^Key, row \d+$/)
      .find((el) => (el as HTMLInputElement).value === "remarks") as HTMLInputElement;
    const before = store(t).undoCount;
    await t.user.type(key, "Xy");
    expect(store(t).undoCount).toBe(before + 1);
    // A key the group already has: the text stays as typed and a message says why.
    await t.user.clear(key);
    await t.user.type(key, "status");
    expect(key).toHaveValue("status");
    const message = card.getByText("This group already has that key.");
    expect(key).toHaveAttribute("aria-invalid", "true");
    expect(key.getAttribute("aria-describedby")).toContain(message.closest("[id]")?.id);
  });

  it("row ids never collide, even for keys that join to the same text", async () => {
    const t = await openBuilder();
    editMock(t, (m) => {
      const sources = m.sources as Record<string, { responses: { default: unknown }[] }>;
      const per = sources.stateSource?.responses[1];
      if (per !== undefined) per.default = { status: "X", a_b: "1", a: { b: "2" } };
    });
    await selectRow(t.user, /^Mock response: Person, State system/);
    const ids = [...document.querySelectorAll(".qm-mock__payload [id]")].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(4);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe("scenarios and the tree", () => {
  it("undo of a remove does not open another scenario in place of the one that was open", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Mock response: Vehicle, State system VEH/);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 3" }));
    await t.user.click(screen.getByRole("button", { name: "Remove scenario 1" }));
    expect(screen.getByRole("button", { name: "Close scenario 2" })).toBeInTheDocument();
    await t.user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(scenarioCard(3)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Close scenario 2" })).not.toBeInTheDocument();
  });

  it("a deep issue pointer keeps the tree's Tab stop on the row that holds it", async () => {
    const t = await openBuilder();
    editMock(t, (m) => {
      const sources = m.sources as Record<string, { responses: { default: unknown }[] }>;
      const first = sources.stateSource?.responses[0];
      if (first !== undefined) first.default = { status: "STOLEN", plate: "REALPLATE1" };
    });
    await t.user.click(await screen.findByRole("button", { name: /Go to the first issue/ }));
    const tree = await mockTree();
    await waitFor(() => {
      const stop = tree.querySelector('[role="treeitem"][tabindex="0"]');
      expect(stop?.textContent).toMatch(/^Mock response: Vehicle, State system/);
    });
  });

  it("each source has an Add mock response row that opens the source's add form", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Add mock response: State system/);
    expect(await screen.findByRole("button", { name: "Add mock response" })).toBeInTheDocument();
    expect(screen.getByLabelText("Shortest wait")).toBeInTheDocument();
  });
});

// T12-Q4 (#642): gaps left from #571 and #577.
describe("minors: the Add row, a row with two issues, trigger text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the Add mock response row scrolls the form into view and leaves focus where it was", async () => {
    const t = await openBuilder();
    const scroll = vi.fn();
    // jsdom has no scrollIntoView: the component calls it when present.
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    try {
      const row = await selectRow(t.user, /^Add mock response: State system/);
      expect(await screen.findByRole("button", { name: "Add mock response" })).toBeInTheDocument();
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
      expect(row).toHaveFocus();
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("a row with two issues says both in its name", async () => {
    const t = await openBuilder();
    editMock(t, (m) => {
      const sources = m.sources as Record<
        string,
        { responses: { queryType: string; scenarios: { when: Record<string, string> }[] }[] }
      >;
      const first = sources.stateSource?.responses[0];
      if (first === undefined) return;
      // An unknown type (a warning) and a blank trigger beside a filled one (a second warning).
      first.queryType = "ZZOLD";
      const scenario = first.scenarios[0];
      if (scenario !== undefined) scenario.when = { ...scenario.when, other: "" };
    });
    const row = within(await mockTree()).getAllByRole("treeitem", {
      name: /^Mock response: ZZOLD/,
    })[0] as HTMLElement;
    expect(row).toHaveAccessibleName(/, 2 warnings$/);
  });

  it("a number trigger keeps its dot while typing: 1901. on the way to 1901.5", async () => {
    const t = await openBuilder();
    editMock(t, (m) => {
      const sources = m.sources as Record<
        string,
        { responses: { scenarios: { when: unknown }[] }[] }
      >;
      const scenario = sources.stateSource?.responses[0]?.scenarios[0];
      if (scenario !== undefined) scenario.when = { year: 1902 };
    });
    await selectRow(t.user, /^Mock response: Vehicle, State system VEH/);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    const input = within(scenarioCard(1)).getByLabelText("Value for trigger field 1");
    await t.user.clear(input);
    await t.user.type(input, "1901.");
    expect(input).toHaveValue("1901.");
    await t.user.type(input, "5");
    expect(input).toHaveValue("1901.5");
    const when = draftMock(t).sources.stateSource?.responses[0]?.scenarios[0]?.when;
    expect(when).toEqual({ year: 1901.5 });
  });
});

describe("response time", () => {
  it("tabbing from one wait to the other neither announces nor writes; both waits show the order fault", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Mock source: State system/);
    const shortest = await screen.findByLabelText("Shortest wait");
    const longest = screen.getByLabelText("Longest wait");
    await t.user.clear(shortest);
    await t.user.type(shortest, "900");
    await t.user.tab();
    expect(longest).toHaveFocus();
    expect(status()).not.toContain("not valid");
    expect(shortest).toHaveAttribute("aria-invalid", "true");
    expect(longest).toHaveAttribute("aria-invalid", "true");
    await t.user.clear(longest);
    await t.user.type(longest, "1000");
    await t.user.tab();
    expect(draftMock(t).sources.stateSource?.latencyMs).toEqual([900, 1000]);
  });
});

describe("Add all at the Coverage item", () => {
  it("adds a no-record response for every gap in one undo step, announces the count and keeps focus", async () => {
    const t = await openBuilder();
    editMock(t, (m) => {
      const sources = m.sources as Record<string, { responses: { queryType: string }[] }>;
      const state = sources.stateSource;
      if (state !== undefined)
        state.responses = state.responses.filter((r) => r.queryType === "VEH");
    });
    await selectRow(t.user, /^Coverage/);
    const before = store(t).undoCount;
    await t.user.click(await screen.findByRole("button", { name: /^Add all 3 missing responses/ }));
    expect(
      draftMock(t)
        .sources.stateSource?.responses.map((r) => r.queryType)
        .sort(),
    ).toEqual(["DL", "PER", "PRO", "VEH"]);
    expect(store(t).undoCount).toBe(before + 1);
    await waitFor(() => expect(status()).toContain("3 no-record mock responses added."));
    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    await t.user.click(screen.getByRole("button", { name: "Undo" }));
    expect(draftMock(t).sources.stateSource?.responses).toHaveLength(1);
  });
});

describe("orphaned response and blank triggers", () => {
  it("a response whose query type the site no longer has shows the warning at the response", async () => {
    const t = await openBuilder();
    editMock(t, (m) => {
      const sources = m.sources as Record<string, { responses: { queryType: string }[] }>;
      const first = sources.stateSource?.responses[0];
      if (first !== undefined) first.queryType = "ZZOLD";
    });
    await selectRow(t.user, /^Mock response: ZZOLD/);
    const warning = await screen.findByText(/No query type has the code ZZOLD/);
    expect(warning.closest("[data-issue-pointer]")).toHaveAttribute(
      "data-issue-pointer",
      "/mock/sources/stateSource/responses/0",
    );
  });

  it("a blank trigger beside a filled one shows the warning and is not marked invalid", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Mock response: Vehicle, State system VEH/);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    await t.user.click(within(scenarioCard(1)).getByRole("button", { name: "Add trigger field" }));
    const card = within(scenarioCard(1));
    const blank = card
      .getAllByLabelText(/^Value for /)
      .find((el) => (el as HTMLInputElement).value === "") as HTMLInputElement;
    expect(blank).toBeDefined();
    expect(card.getByText(/This blank value never matches/)).toBeInTheDocument();
    expect(blank).not.toHaveAttribute("aria-invalid", "true");
    expect(
      card.queryByText("Enter the value that triggers this scenario."),
    ).not.toBeInTheDocument();
  });

  // BW3 polish (#642, T12-14): a warning is not an error. The blank-trigger note takes the warning
  // class (the severity warning token pair in CSS), leads with the word Warning and keeps its icon,
  // so it never rests on color alone.
  it("the blank-trigger warning has the warning class, not the error class, and says Warning", async () => {
    const t = await openBuilder();
    await selectRow(t.user, /^Mock response: Vehicle, State system VEH/);
    await t.user.click(await screen.findByRole("button", { name: "Edit scenario 1" }));
    await t.user.click(within(scenarioCard(1)).getByRole("button", { name: "Add trigger field" }));
    const note = within(scenarioCard(1))
      .getByText(/This blank value never matches/)
      .closest("p");
    expect(note).not.toBeNull();
    expect(note).toHaveClass("qm-mock__warning");
    expect(note).not.toHaveClass("qm-mock__error");
    expect(note?.textContent).toMatch(/^.?\s*Warning:/);
  });
});
