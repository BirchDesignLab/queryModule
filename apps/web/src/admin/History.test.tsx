import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { findSetting, selectBuilderItem } from "../test/builder-tree.js";
import {
  API,
  adminConfigBody,
  CLIENT_CONFIG,
  RAW_SITE,
  server,
  TEST_USER,
  versionRow,
} from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";
import { REVOKE_DELAY_MS } from "./HistoryDrawer.js";

const REAL_URL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeAll(preloadAdminRoutes);
afterEach(() => {
  vi.restoreAllMocks();
  // The export test stubs the Blob URL functions: put back what the environment had.
  URL.createObjectURL = REAL_URL.create;
  URL.revokeObjectURL = REAL_URL.revoke;
});

// Task 33 part 2b (#358, BR-001, UX-004): version history, roll back and export. The history is a
// named region opened from the toolbar; roll back confirms (spec 6.2), publishes a new version and
// leaves the draft as it is, so the draft's base is stale and the next save takes the 409 path.

const T0 = Date.UTC(2026, 8, 29, 17, 0, 0);

interface Calls {
  versions: number;
  configGets: number;
  gets: number;
  rollbacks: string[];
  exports: string[];
  puts: { baseVersion: number }[];
}
let calls: Calls;
let live: number;

/** Newest first, as the server answers: a draft on top of the live version 4 (a roll back of 2). */
const VERSIONS = () => [
  versionRow(5, "draft", { baseVersion: 4, createdAt: T0 + 5000 }),
  versionRow(4, "published", { rollbackOf: 2, publishedAt: T0 + 4000 }),
  versionRow(3, "superseded", { publishedAt: T0 + 3000 }),
  versionRow(2, "superseded", { publishedAt: T0 + 2000 }),
  versionRow(1, "superseded", { publishedAt: T0 + 1000 }),
];

type Handlers = {
  /** The admin config GET (live and draft); the default fixture when omitted. */
  adminGet?: () => Response | undefined | Promise<Response | undefined>;
  versions?: () => Response;
  rollback?: () => Response;
  exportDoc?: () => Response | undefined | Promise<Response | undefined>;
};

async function openBuilder(handlers: Handlers = {}) {
  calls = { versions: 0, configGets: 0, gets: 0, rollbacks: [], exports: [], puts: [] };
  live = 4;
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => {
      calls.configGets++;
      return HttpResponse.json(CLIENT_CONFIG);
    }),
    http.get(`${API}/api/v1/admin/config`, async () => {
      calls.gets++;
      return (
        (await handlers.adminGet?.()) ?? HttpResponse.json(adminConfigBody({ liveVersion: live }))
      );
    }),
    http.get(`${API}/api/v1/admin/config/versions`, () => {
      calls.versions++;
      return handlers.versions?.() ?? HttpResponse.json({ versions: VERSIONS() });
    }),
    http.post(`${API}/api/v1/admin/config/versions/:version/rollback`, ({ params }) => {
      calls.rollbacks.push(String(params.version));
      if (handlers.rollback !== undefined) return handlers.rollback();
      live = 5;
      return HttpResponse.json(versionRow(5, "published", { rollbackOf: Number(params.version) }));
    }),
    http.get(`${API}/api/v1/admin/config/versions/:version/export`, async ({ params }) => {
      calls.exports.push(String(params.version));
      return (
        (await handlers.exportDoc?.()) ?? HttpResponse.json({ siteConfig: RAW_SITE, locales: {} })
      );
    }),
    http.post(`${API}/api/v1/admin/config/validate`, () =>
      HttpResponse.json({ errors: [], warnings: [] }),
    ),
    http.put(`${API}/api/v1/admin/config/draft`, async ({ request }) => {
      const body = (await request.json()) as { baseVersion: number };
      calls.puts.push(body);
      if (body.baseVersion !== live)
        return HttpResponse.json(
          { error: { code: "draftConflict", requestId: "r1" } },
          { status: 409 },
        );
      return HttpResponse.json(versionRow(live + 1, "draft"));
    }),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const historyButton = () => screen.getByRole("button", { name: "History" });
const drawer = () => screen.findByRole("region", { name: "Version history" });
const row = (region: HTMLElement, version: number) => {
  const item = within(region)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByText(`Version ${version}`) !== null);
  if (item === undefined) throw new Error(`no row for version ${version}`);
  return item;
};
async function openHistory(t: Opened) {
  await t.user.click(historyButton());
  const region = await drawer();
  await within(region).findByText("Version 5");
  return region;
}
async function setDelimiter(t: Opened, value: string) {
  await selectBuilderItem(t.user, "terminal");
  const input = await findSetting("terminal.delimiter");
  await t.user.clear(input);
  await t.user.type(input, value);
}

describe("the history drawer", () => {
  it("History is an enabled button that opens a named region listing versions newest first", async () => {
    const t = await openBuilder();
    const button = historyButton();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("region", { name: "Version history" })).not.toBeInTheDocument();
    const region = await openHistory(t);
    const names = within(region)
      .getAllByRole("listitem")
      .map((li) => /Version (\d+)/.exec(li.textContent ?? "")?.[1]);
    expect(names).toEqual(["5", "4", "3", "2", "1"]);
    expect(within(region).getByRole("heading", { name: "Version history" })).toBeInTheDocument();
  });

  it("each row shows its status badge, its time, and the roll back it came from; no who and no note", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    expect(row(region, 5)).toHaveTextContent("Draft");
    expect(row(region, 4)).toHaveTextContent("Live");
    expect(row(region, 3)).toHaveTextContent("Previous");
    expect(row(region, 4)).toHaveTextContent("Roll back of version 2");
    expect(row(region, 3)).not.toHaveTextContent(/roll back of/i);
    expect(row(region, 4)).toHaveTextContent("Published");
    expect(row(region, 5)).toHaveTextContent("Created");
    const when = row(region, 4).querySelector("time");
    expect(when?.getAttribute("datetime")).toBe(new Date(T0 + 4000).toISOString());
    // Contract: user ids only and no note, so neither is shown in M1.
    expect(region).not.toHaveTextContent("user-0001");
  });

  it("Escape closes it and focus returns to the History button", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    await t.user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Version history" })).not.toBeInTheDocument(),
    );
    expect(historyButton()).toHaveFocus();
    expect(region).not.toBeInTheDocument();
  });

  it("History again, or Close, closes it too", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    await t.user.click(within(region).getByRole("button", { name: "Close history" }));
    expect(screen.queryByRole("region", { name: "Version history" })).not.toBeInTheDocument();
    expect(historyButton()).toHaveFocus();
  });

  it("9: History names the region it opens with aria-controls", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    expect(region.id).not.toBe("");
    expect(historyButton()).toHaveAttribute("aria-controls", region.id);
    expect(historyButton()).toHaveAttribute("aria-expanded", "true");
  });

  it("8: Save draft reloads the open list", async () => {
    const t = await openBuilder();
    await openHistory(t);
    await setDelimiter(t, ",");
    const versions = calls.versions;
    await t.user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.versions).toBeGreaterThan(versions));
  });

  it("8: Review and publish reloads the open list when it saved the draft", async () => {
    const t = await openBuilder();
    await openHistory(t);
    await setDelimiter(t, ",");
    const versions = calls.versions;
    await t.user.click(screen.getByRole("button", { name: "Review and publish" }));
    await screen.findByRole("dialog", { name: "Review and publish" });
    await waitFor(() => expect(calls.versions).toBeGreaterThan(versions));
  });

  it("a failed load says so and offers Try again", async () => {
    let fail = true;
    const t = await openBuilder({
      versions: () =>
        fail
          ? HttpResponse.json({ error: { code: "internal", requestId: "r1" } }, { status: 500 })
          : HttpResponse.json({ versions: VERSIONS() }),
    });
    await t.user.click(historyButton());
    const region = await drawer();
    expect(
      await within(region).findByText("The version history could not be loaded."),
    ).toBeInTheDocument();
    fail = false;
    await t.user.click(within(region).getByRole("button", { name: "Try again" }));
    expect(await within(region).findByText("Version 5")).toBeInTheDocument();
  });
});

describe("roll back", () => {
  it("is offered on previous versions only: not on the live version, not on a draft", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    for (const v of [1, 2, 3])
      expect(
        within(row(region, v)).getByRole("button", { name: `Roll back to version ${v}` }),
      ).toBeInTheDocument();
    for (const v of [4, 5])
      expect(within(row(region, v)).queryByRole("button", { name: /Roll back/ })).toBeNull();
  });

  it("confirms first: the dialog names the version, says a new version is published and the draft is kept", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    await t.user.click(
      within(row(region, 3)).getByRole("button", { name: "Roll back to version 3" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Roll back to version 3?" });
    expect(dialog).toHaveTextContent(/as a new version/);
    expect(dialog).toHaveTextContent(/draft is left as it is/);
    expect(calls.rollbacks).toEqual([]);
    // Cancel publishes nothing and focus returns to the control that opened it.
    await t.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.rollbacks).toEqual([]);
    expect(
      within(row(region, 3)).getByRole("button", { name: "Roll back to version 3" }),
    ).toHaveFocus();
  });

  it("publishes a new version, toasts it, refetches the client config and the admin config, and keeps the history open", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    const gets = calls.gets;
    const configGets = calls.configGets;
    const versions = calls.versions;
    await t.user.click(
      within(row(region, 2)).getByRole("button", { name: "Roll back to version 2" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Roll back to version 2?" });
    await t.user.click(within(dialog).getByRole("button", { name: "Roll back to version 2" }));
    await waitFor(() => expect(calls.rollbacks).toEqual(["2"]));
    const text =
      "Published version 5 (roll back of version 2). Dispatchers see it within 15 seconds.";
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    expect(t.services.announcer.current().polite?.text).toBe(text);
    await waitFor(() => expect(calls.configGets).toBeGreaterThan(configGets));
    await waitFor(() => expect(calls.gets).toBeGreaterThan(gets));
    await waitFor(() => expect(calls.versions).toBeGreaterThan(versions));
    expect(screen.getByRole("region", { name: "Version history" })).toBeInTheDocument();
  });

  // Q2 (#507 item 6), the real wiring in BuilderBody: when the control that opened a dialog is gone
  // by the time it closes, the roll back dialog falls back to the History button and the others to
  // the selected tab. The opener is removed by hand: nothing in a real flow can unmount a row while
  // a modal dialog is open over it, but the fallback exists for exactly that.
  it("Q2 item 6 wiring: the roll back dialog, its opener gone, returns focus to the History button", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    const opener = within(row(region, 2)).getByRole("button", { name: "Roll back to version 2" });
    await t.user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Roll back to version 2?" });
    opener.remove();
    await t.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(historyButton()).toHaveFocus());
  });

  it("Q2 item 6 wiring: the review dialog, its opener gone, returns focus to the selected tab, not History", async () => {
    const t = await openBuilder();
    await openHistory(t);
    await setDelimiter(t, ",");
    const opener = screen.getByRole("button", { name: "Review and publish" });
    await t.user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    opener.remove();
    await t.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("tab", { selected: true })).toHaveFocus());
    expect(historyButton()).not.toHaveFocus();
  });

  it("leaves the draft as it is: the edit stays, and the next save takes the 409 path", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    const region = await openHistory(t);
    await t.user.click(
      within(row(region, 2)).getByRole("button", { name: "Roll back to version 2" }),
    );
    await t.user.click(
      within(await screen.findByRole("dialog", { name: "Roll back to version 2?" })).getByRole(
        "button",
        { name: "Roll back to version 2" },
      ),
    );
    await waitFor(() => expect(calls.rollbacks).toEqual(["2"]));
    await screen.findAllByText(/Published version 5/);
    const draft = configDraftStore(t.services).getState();
    expect((draft.doc?.terminal as { delimiter?: string } | undefined)?.delimiter).toBe(",");
    await t.user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/newer version was published or saved/)).toBeInTheDocument();
    expect(calls.puts).toEqual([{ baseVersion: 4, document: expect.anything() }]);
  });

  it("a 409 says the live version changed and the list reloads (the 400 case is the next test)", async () => {
    const t = await openBuilder({
      rollback: () =>
        HttpResponse.json({ error: { code: "draftConflict", requestId: "r1" } }, { status: 409 }),
    });
    const region = await openHistory(t);
    await t.user.click(
      within(row(region, 3)).getByRole("button", { name: "Roll back to version 3" }),
    );
    await t.user.click(
      within(await screen.findByRole("dialog", { name: "Roll back to version 3?" })).getByRole(
        "button",
        { name: "Roll back to version 3" },
      ),
    );
    const versions = calls.versions;
    expect(
      await screen.findByText(
        "The live version changed while rolling back. Check the history and try again.",
      ),
    ).toBeInTheDocument();
    // The list on screen is out of date: it reloads, and the history stays open.
    await waitFor(() => expect(calls.versions).toBeGreaterThan(versions));
    expect(screen.getByRole("region", { name: "Version history" })).toBeInTheDocument();
    expect(screen.queryByText(/^Published version/)).not.toBeInTheDocument();
  });

  it("when the live view cannot be reloaded after a roll back, it says so and Load again retries once per click", async () => {
    let failGet = false;
    let release: () => void = () => {};
    let hold: Promise<void> | null = null;
    const t = await openBuilder({
      adminGet: async () => {
        if (hold !== null) await hold;
        return failGet
          ? HttpResponse.json({ error: { code: "internal", requestId: "r1" } }, { status: 500 })
          : undefined;
      },
    });
    const region = await openHistory(t);
    failGet = true;
    await t.user.click(
      within(row(region, 2)).getByRole("button", { name: "Roll back to version 2" }),
    );
    await t.user.click(
      within(await screen.findByRole("dialog", { name: "Roll back to version 2?" })).getByRole(
        "button",
        { name: "Roll back to version 2" },
      ),
    );
    const reason =
      "Done, but the latest version could not be loaded. This draft still shows the older one.";
    expect(await screen.findByText(reason)).toBeInTheDocument();
    // A double click while the reload is in flight asks the server once.
    failGet = false;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gets = calls.gets;
    const retry = screen.getByRole("button", { name: "Load again" });
    await t.user.click(retry);
    await t.user.click(retry);
    release();
    await waitFor(() => expect(screen.queryByText(reason)).not.toBeInTheDocument());
    expect(calls.gets).toBe(gets + 1);
  });

  it("an invalid version cannot be rolled back and says so", async () => {
    const t = await openBuilder({
      rollback: () =>
        HttpResponse.json(
          { error: { code: "validationFailed", requestId: "r1", errors: [] } },
          { status: 400 },
        ),
    });
    const region = await openHistory(t);
    await t.user.click(
      within(row(region, 1)).getByRole("button", { name: "Roll back to version 1" }),
    );
    await t.user.click(
      within(await screen.findByRole("dialog", { name: "Roll back to version 1?" })).getByRole(
        "button",
        { name: "Roll back to version 1" },
      ),
    );
    expect(
      await screen.findByText(
        "Version 1 no longer passes the checks, so it cannot be rolled back.",
      ),
    ).toBeInTheDocument();
  });
});

describe("export", () => {
  it("is on every version and downloads <siteId>-v<n>.json from a Blob URL that is revoked", async () => {
    const t = await openBuilder();
    const region = await openHistory(t);
    for (const v of [1, 2, 3, 4, 5])
      expect(
        within(row(region, v)).getByRole("button", { name: `Export version ${v}` }),
      ).toBeInTheDocument();
    const create = vi.fn(() => "blob:fixture-1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    // Only the timer is faked, and the fake clock still follows real time (so MSW and waitFor run);
    // the deferred revoke is then stepped, not waited for.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
    await t.user.click(within(row(region, 3)).getByRole("button", { name: "Export version 3" }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(calls.exports).toEqual(["3"]);
    expect(clicked[0]).toEqual({ download: "default-v3.json", href: "blob:fixture-1" });
    const blob = create.mock.calls[0] as unknown as [Blob];
    expect(blob[0]).toBeInstanceOf(Blob);
    expect(JSON.parse(await blob[0].text())).toEqual({ siteConfig: RAW_SITE, locales: {} });
    // Some engines drop the download if the URL goes at once: it is revoked a moment later.
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith("blob:fixture-1");
    // Nothing is left in the document: no link stays behind.
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("10: a second click while an export is in flight downloads nothing twice", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = await openBuilder({
      exportDoc: async () => {
        await gate;
        return undefined;
      },
    });
    const region = await openHistory(t);
    const create = vi.fn(() => "blob:fixture-2");
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    const button = within(row(region, 3)).getByRole("button", { name: "Export version 3" });
    await t.user.click(button);
    await t.user.click(button);
    release();
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(calls.exports).toEqual(["3"]);
  });

  it("C1: an export of another version while one is in flight is not dropped", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = await openBuilder({
      exportDoc: async () => {
        await gate;
        return undefined;
      },
    });
    const region = await openHistory(t);
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:fixture-3"),
      revokeObjectURL: vi.fn(),
    });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    await t.user.click(within(row(region, 3)).getByRole("button", { name: "Export version 3" }));
    await t.user.click(within(row(region, 2)).getByRole("button", { name: "Export version 2" }));
    release();
    await waitFor(() => expect(clicked).toHaveLength(2));
    expect([...clicked].sort()).toEqual(["default-v2.json", "default-v3.json"]);
    expect([...calls.exports].sort()).toEqual(["2", "3"]);
  });

  it("a failed export says so", async () => {
    const t = await openBuilder({
      exportDoc: () => HttpResponse.json({ error: { code: "notFound" } }, { status: 404 }),
    });
    const region = await openHistory(t);
    await t.user.click(within(row(region, 2)).getByRole("button", { name: "Export version 2" }));
    expect(
      await screen.findByText("Version 2 could not be exported. Try again."),
    ).toBeInTheDocument();
  });
});
