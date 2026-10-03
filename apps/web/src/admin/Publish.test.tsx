import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
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

beforeAll(preloadAdminRoutes);

// Task 33 part 2a (#358, BR-001, UX-004): the builder works on the server draft; save, review and
// publish, with spec 6.2 dialogs. The browser keeps nothing (spec 6.7).

interface Calls {
  puts: { baseVersion: number; document: { siteConfig: Record<string, unknown> } }[];
  validates: unknown[];
  publishes: unknown[];
  gets: number;
  configGets: number;
}
let calls: Calls;

const site = (over: Record<string, unknown>) => ({ ...RAW_SITE, ...over });

type Handlers = {
  get?: () => Response;
  put?: () => Response;
  validate?: () => Response | Promise<Response>;
  publish?: () => Response | Promise<Response>;
};

async function openBuilder(handlers: Handlers = {}) {
  calls = { puts: [], validates: [], publishes: [], gets: 0, configGets: 0 };
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => {
      calls.configGets++;
      return HttpResponse.json(CLIENT_CONFIG);
    }),
    http.get(`${API}/api/v1/admin/config`, () => {
      calls.gets++;
      return handlers.get?.() ?? HttpResponse.json(adminConfigBody());
    }),
    http.put(`${API}/api/v1/admin/config/draft`, async ({ request }) => {
      calls.puts.push((await request.json()) as Calls["puts"][number]);
      return handlers.put?.() ?? HttpResponse.json(versionRow(2, "draft"));
    }),
    http.post(`${API}/api/v1/admin/config/validate`, async ({ request }) => {
      calls.validates.push(await request.json());
      return (await handlers.validate?.()) ?? HttpResponse.json({ errors: [], warnings: [] });
    }),
    http.post(`${API}/api/v1/admin/config/publish`, async ({ request }) => {
      calls.publishes.push(await request.json());
      return (await handlers.publish?.()) ?? HttpResponse.json(versionRow(2, "published"));
    }),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

const doc = (t: Opened) => configDraftStore(t.services).getState().doc;
const delimiter = (t: Opened) =>
  (doc(t)?.terminal as { delimiter?: string } | undefined)?.delimiter;
const status = () => screen.getByTestId("draft-status");
const button = (name: string | RegExp) => screen.getByRole("button", { name });

async function setDelimiter(t: Opened, value: string) {
  await selectBuilderItem(t.user, "terminal");
  const input = await findSetting("terminal.delimiter");
  await t.user.clear(input);
  await t.user.type(input, value);
}

/** The conflict alert (the shared announcer has its own role=alert region, so find it by its text). */
const conflictAlert = () =>
  screen
    .findByText(/newer version was published or saved/)
    .then((el) => el.closest("div") as HTMLElement);

const conflict = () =>
  HttpResponse.json({ error: { code: "draftConflict", requestId: "r1" } }, { status: 409 });

describe("the builder starts from the server (Task 33 part 2a)", () => {
  it("starts from the live document when there is no draft", async () => {
    const t = await openBuilder();
    expect(status()).toHaveTextContent("Draft, based on version 1. No unpublished changes.");
    expect(delimiter(t)).toBe(".");
  });

  it("starts from the server draft when there is one, and counts its changes against live", async () => {
    const t = await openBuilder({
      get: () =>
        HttpResponse.json(
          adminConfigBody({
            draft: { version: 2, siteConfig: site({ terminal: { delimiter: ";" } }) },
          }),
        ),
    });
    expect(delimiter(t)).toBe(";");
    expect(status()).toHaveTextContent("Draft, based on version 1. 1 unpublished change.");
    expect(status()).not.toHaveTextContent("Not saved yet");
  });

  it("an edit shows the changes against live and that it is not saved yet", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    expect(status()).toHaveTextContent(
      "Draft, based on version 1. 1 unpublished change. Not saved yet.",
    );
  });

  it("a failed load shows an error, not an endless loading state", async () => {
    server.use(
      http.get(`${API}/api/v1/admin/config`, () =>
        HttpResponse.json({ error: { code: "internal", requestId: "r1" } }, { status: 500 }),
      ),
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user: { ...TEST_USER, role: "implementer" } }),
      ),
    );
    renderRoot({ path: "/admin/config" });
    expect(await screen.findByText("The site config could not be loaded.")).toBeInTheDocument();
  });
});

describe("save draft", () => {
  it("is aria-disabled with its reason when there is nothing new to save", async () => {
    await openBuilder();
    const save = button("Save draft");
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAccessibleDescription("No new edits to save.");
  });

  it("PUTs the document on the live base, keeps server-only sections, and keeps nothing in the browser", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    await t.user.click(button("Save draft"));
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    const put = calls.puts[0];
    expect(put?.baseVersion).toBe(1);
    expect(put?.document.siteConfig.terminal).toEqual({ delimiter: "," });
    expect(put?.document.siteConfig.auth).toEqual(RAW_SITE.auth);
    await waitFor(() => expect(status()).not.toHaveTextContent("Not saved yet"));
    expect(status()).toHaveTextContent("1 unpublished change.");
    expect(t.services.announcer.current().polite?.text).toBe("Draft saved.");
    expect(button("Save draft")).toHaveAttribute("aria-disabled", "true");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("a 409 draftConflict shows an alert with Load the latest, and the edits stay until confirmed", async () => {
    const t = await openBuilder({ put: conflict });
    await setDelimiter(t, ",");
    await t.user.click(button("Save draft"));
    const alert = await conflictAlert();
    expect(alert).toHaveTextContent(/newer version/i);
    expect(delimiter(t)).toBe(",");
    // Declining the confirm keeps the edits.
    await t.user.click(within(alert).getByRole("button", { name: "Load the latest" }));
    const dialog = await screen.findByRole("dialog", { name: "Load the latest version?" });
    await t.user.click(within(dialog).getByRole("button", { name: "Keep my changes" }));
    expect(delimiter(t)).toBe(",");
    expect(await conflictAlert()).toBeInTheDocument();
  });

  it("Load the latest discards the local changes and reloads from GET /admin/config", async () => {
    let live = adminConfigBody();
    const t = await openBuilder({ put: conflict, get: () => HttpResponse.json(live) });
    await setDelimiter(t, ",");
    await t.user.click(button("Save draft"));
    await t.user.click(
      within(await conflictAlert()).getByRole("button", { name: "Load the latest" }),
    );
    live = adminConfigBody({ liveVersion: 2, siteConfig: site({ terminal: { delimiter: "|" } }) });
    const dialog = await screen.findByRole("dialog", { name: "Load the latest version?" });
    expect(dialog).toHaveTextContent(/discarded/i);
    await t.user.click(within(dialog).getByRole("button", { name: "Discard and load" }));
    await waitFor(() => expect(delimiter(t)).toBe("|"));
    expect(screen.queryByText(/newer version was published or saved/)).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("Draft, based on version 2. No unpublished changes.");
  });
});

describe("review and publish", () => {
  it("replaces the aria-disabled Publish; with no changes it says why", async () => {
    await openBuilder();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    const review = button("Review and publish");
    expect(review).toHaveAttribute("aria-disabled", "true");
    expect(review).toHaveAccessibleDescription(
      "Nothing to publish: the draft matches the live version.",
    );
  });

  it("History stays aria-disabled with its reason until part 2b", async () => {
    await openBuilder();
    const history = button("History");
    expect(history).toHaveAttribute("aria-disabled", "true");
    expect(history).toHaveAccessibleDescription(/version history arrives/i);
  });

  it("server validation errors show at their controls with the count announced, and nothing is published", async () => {
    const t = await openBuilder({
      validate: () =>
        HttpResponse.json({
          errors: [
            {
              level: "error",
              path: "/terminal/delimiter",
              key: "config.schema",
              params: { code: "server-says-no" },
            },
          ],
          warnings: [],
        }),
    });
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    await waitFor(() => expect(calls.validates).toHaveLength(1));
    // The draft is saved first, then validated as saved.
    expect(calls.puts).toHaveLength(1);
    expect(await screen.findByText(/server-says-no/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.publishes).toHaveLength(0);
    expect(screen.getByTestId("draft-summary")).toHaveTextContent("Draft checks: 1 errors");
    expect(t.services.announcer.current().polite?.text).toMatch(/1 error/);
    // The message belongs to the delimiter control.
    const input = await findSetting("terminal.delimiter");
    expect(input).toHaveAccessibleDescription(/server-says-no/);
  });

  it("an edit after the server found errors retires them: the server saw other edits", async () => {
    const t = await openBuilder({
      validate: () =>
        HttpResponse.json({
          errors: [
            {
              level: "error",
              path: "/terminal/delimiter",
              key: "config.schema",
              params: { code: "stale-me" },
            },
          ],
          warnings: [],
        }),
    });
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    expect(await screen.findByText(/stale-me/)).toBeInTheDocument();
    const input = await findSetting("terminal.delimiter");
    await t.user.type(input, ";");
    await waitFor(() => expect(screen.queryByText(/stale-me/)).not.toBeInTheDocument());
  });

  it("opens a dialog that lists the changes, and Publish version n sends the saved draft", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    expect(dialog).toHaveTextContent(/version 2/);
    expect(await within(dialog).findByText(/Terminal settings/)).toBeInTheDocument();
    // The list in the dialog is for reading: no entry opens an item from here.
    expect(within(dialog).queryByRole("button", { name: /Changed/ })).not.toBeInTheDocument();
    expect(calls.publishes).toHaveLength(0);
    const before = calls.gets;
    const configGets = calls.configGets;
    await t.user.click(within(dialog).getByRole("button", { name: "Publish version 2" }));
    await waitFor(() => expect(calls.publishes).toEqual([{ draftVersion: 2 }]));
    // Shown in the builder, and announced once through the shared live region.
    expect(
      (await screen.findAllByText("Published version 2. Dispatchers see it within 15 seconds."))
        .length,
    ).toBeGreaterThan(0);
    expect(t.services.announcer.current().polite?.text).toBe(
      "Published version 2. Dispatchers see it within 15 seconds.",
    );
    // The client config is invalidated and the admin config reloaded.
    await waitFor(() => expect(calls.configGets).toBeGreaterThan(configGets));
    await waitFor(() => expect(calls.gets).toBeGreaterThan(before));
    // Focus returns to the toolbar, on the control that opened the dialog.
    await waitFor(() => expect(button("Review and publish")).toHaveFocus());
  });

  it("a Cancel in the dialog publishes nothing and returns focus to the button", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    await t.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.publishes).toHaveLength(0);
    await waitFor(() => expect(button("Review and publish")).toHaveFocus());
  });

  it("a 409 on publish shows the reload path", async () => {
    const t = await openBuilder({ publish: conflict });
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    await t.user.click(within(dialog).getByRole("button", { name: "Publish version 2" }));
    const alert = await conflictAlert();
    expect(within(alert).getByRole("button", { name: "Load the latest" })).toBeInTheDocument();
  });

  it("a 400 validationFailed on publish shows the errors at their controls", async () => {
    const t = await openBuilder({
      publish: () =>
        HttpResponse.json(
          {
            error: {
              code: "validationFailed",
              requestId: "r1",
              errors: [{ key: "config.schema", params: { path: "/terminal/delimiter" } }],
            },
          },
          { status: 400 },
        ),
    });
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    await t.user.click(within(dialog).getByRole("button", { name: "Publish version 2" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("draft-summary")).toHaveTextContent("Draft checks: 1 errors");
  });

  it("Review and publish is aria-disabled with a reason while the Raw JSON does not parse", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" });
    await t.user.click(area);
    await t.user.keyboard("{Control>}{End}{/Control}xx");
    const review = button("Review and publish");
    await waitFor(() => expect(review).toHaveAttribute("aria-disabled", "true"));
    expect(review).toHaveAccessibleDescription(/Raw JSON/);
    await t.user.click(review);
    expect(calls.puts).toHaveLength(0);
  });

  it("the dialog is labelled and described, and Escape cancels (spec 6.2)", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    expect(dialog).toHaveAccessibleDescription(/dispatchers/i);
    await t.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.publishes).toHaveLength(0);
  });
});

/** A response the test releases by hand, to look at the page while a request is in flight. */
function gate() {
  let release: () => void = () => {};
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { open, release };
}

describe("while an action is in flight (round 1: C1, C2, C3)", () => {
  it("C1: Escape and the dialog's cancel event do nothing while the publish is under way", async () => {
    const g = gate();
    const t = await openBuilder({
      publish: async () => {
        await g.open;
        return HttpResponse.json(versionRow(2, "published"));
      },
    });
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    await t.user.click(within(dialog).getByRole("button", { name: "Publish version 2" }));
    await waitFor(() => expect(calls.publishes).toHaveLength(1));
    await t.user.keyboard("{Escape}");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog", { name: "Review and publish" })).toBeInTheDocument();
    expect(configDraftStore(t.services).getState().doc).not.toBeNull();
    g.release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("C2: Save draft says why it is disabled while a check is under way", async () => {
    const g = gate();
    const t = await openBuilder({
      validate: async () => {
        await g.open;
        return HttpResponse.json({ errors: [], warnings: [] });
      },
    });
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const save = await waitFor(() => {
      const b = button("Save draft");
      expect(b).toHaveAttribute("aria-disabled", "true");
      return b;
    });
    expect(save).toHaveAccessibleDescription(/Working/);
    g.release();
    await screen.findByRole("dialog", { name: "Review and publish" });
  });

  it("C2: Save draft says why it is disabled while the Raw JSON does not parse", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    await t.user.click(screen.getByRole("textbox", { name: "Draft JSON" }));
    await t.user.keyboard("{Control>}{End}{/Control}xx");
    const save = button("Save draft");
    await waitFor(() => expect(save).toHaveAttribute("aria-disabled", "true"));
    expect(save).toHaveAccessibleDescription(/Raw JSON/);
    await t.user.click(save);
    expect(calls.puts).toHaveLength(0);
  });

  it("C2: the dialog's buttons say why they do nothing while the publish is under way", async () => {
    const g = gate();
    const t = await openBuilder({
      publish: async () => {
        await g.open;
        return HttpResponse.json(versionRow(2, "published"));
      },
    });
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    await t.user.click(within(dialog).getByRole("button", { name: "Publish version 2" }));
    await waitFor(() => expect(calls.publishes).toHaveLength(1));
    for (const name of ["Cancel", "Publish version 2"]) {
      const b = within(dialog).getByRole("button", { name });
      expect(b).toHaveAttribute("aria-disabled", "true");
      expect(b).toHaveAccessibleDescription(/Publishing/);
    }
    g.release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("C3: the list of changes can be focused and is inside the dialog's Tab order", async () => {
    const t = await openBuilder();
    await setDelimiter(t, ",");
    await t.user.click(button("Review and publish"));
    const dialog = await screen.findByRole("dialog", { name: "Review and publish" });
    const list = within(dialog).getByRole("region", { name: "Changes to publish" });
    expect(list).toHaveAttribute("tabindex", "0");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const publish = within(dialog).getByRole("button", { name: "Publish version 2" });
    expect(cancel).toHaveFocus();
    await t.user.tab({ shift: true });
    expect(list).toHaveFocus();
    await t.user.tab({ shift: true });
    expect(publish).toHaveFocus();
    await t.user.tab();
    expect(list).toHaveFocus();
    await t.user.tab();
    expect(cancel).toHaveFocus();
  });
});
