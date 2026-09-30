import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findSetting, selectBuilderItem } from "../test/builder-tree.js";
import { API, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";

beforeAll(preloadAdminRoutes);

// Item 4: the Changes view is read-only, compares the draft with the live config (checked when the
// view opens), groups by query type, list, command and quick access, and opens the entry's item.

let configGets = 0;
let writes: string[] = [];
const onRequest = ({ request }: { request: Request }) => {
  if (request.method !== "GET" && !request.url.includes("/auth/")) writes.push(request.method);
};
server.events.on("request:start", onRequest);
afterEach(() => {
  writes = [];
});

async function openBuilder(
  live: () => Response | Promise<Response> = () => HttpResponse.json(CLIENT_CONFIG),
) {
  const user = { ...TEST_USER, role: "implementer" };
  configGets = 0;
  writes = [];
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.get(`${API}/api/v1/config`, () => {
      configGets++;
      return live();
    }),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

async function setDelimiter(t: Opened, value: string) {
  await selectBuilderItem(t.user, "terminal");
  const input = await findSetting("terminal.delimiter");
  await t.user.clear(input);
  await t.user.type(input, value);
}
const openChanges = (t: Opened) => t.user.click(screen.getByRole("tab", { name: "Changes" }));
const view = () => screen.getByRole("region", { name: "Changes from the live version" });

describe("Changes view (item 4)", () => {
  it("is the third view, and says there is nothing to show when the draft matches live", async () => {
    const t = await openBuilder();
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual([
      "Form",
      "Raw JSON",
      "Changes",
    ]);
    await openChanges(t);
    expect(await screen.findByText("No differences from the live version.")).toBeInTheDocument();
  });

  it("checks the live version when it opens, and ignores the config hash", async () => {
    const t = await openBuilder();
    const before = configGets;
    // The server now serves the same config under a new hash: a version bump is not a change.
    server.use(
      http.get(`${API}/api/v1/config`, () => {
        configGets++;
        return HttpResponse.json({ ...CLIENT_CONFIG, configHash: "f".repeat(64) });
      }),
    );
    await openChanges(t);
    await waitFor(() => expect(configGets).toBeGreaterThan(before));
    expect(await screen.findByText("No differences from the live version.")).toBeInTheDocument();
  });

  it("compares with the live version as it is now, not as it was when the builder opened", async () => {
    const t = await openBuilder();
    server.use(
      http.get(`${API}/api/v1/config`, () =>
        HttpResponse.json({
          ...CLIENT_CONFIG,
          configHash: "e".repeat(64),
          terminal: { delimiter: "|" },
        }),
      ),
    );
    await openChanges(t);
    const group = await screen.findByRole("region", { name: /Terminal settings/ });
    expect(within(group).getByText("|")).toBeInTheDocument();
    expect(within(group).getByText(".")).toBeInTheDocument();
  });

  it("lists a changed setting under its plain name, old and new, with the key in hidden text", async () => {
    const t = await openBuilder();
    await setDelimiter(t, "~");
    await openChanges(t);
    const group = await screen.findByRole("region", { name: /Terminal settings/ });
    const entry = within(group).getByRole("button", { name: /Changed/ });
    expect(entry).toHaveTextContent("Was");
    expect(entry).toHaveTextContent("Now");
    expect(within(entry).getByText("~")).toBeInTheDocument();
    // The key is there for screen readers only.
    const hidden = within(entry).getByText(/terminal delimiter/);
    expect(hidden.closest("span")).toHaveStyle({ position: "absolute" });
  });

  it("groups a field edit under its query type", async () => {
    const t = await openBuilder();
    configDraftStore(t.services)
      .getState()
      .setPath(
        ["queryTypes", 0, "fields", 0, "required"],
        !CLIENT_CONFIG.queryTypes[0]?.fields[0]?.required,
      );
    await openChanges(t);
    const type = await screen.findByRole("region", { name: /Vehicle/ });
    const field = within(type).getByRole("heading", { level: 5 });
    expect(field).toHaveTextContent(/Field/);
    expect(within(type).getByRole("button", { name: /Required/ })).toHaveTextContent(/Was.*Now/);
  });

  it("opens the entry's item in the Form view and puts focus in it", async () => {
    const t = await openBuilder();
    await setDelimiter(t, "~");
    await openChanges(t);
    const entry = await screen.findByRole("button", { name: /Delimiter|delimiter/ });
    await t.user.click(entry);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true"),
    );
    await waitFor(() => {
      const active = document.activeElement;
      expect(active).not.toBe(document.body);
      expect(active?.closest(".qm-builder__editor")).not.toBeNull();
    });
    expect(screen.getByRole("treeitem", { name: /terminal/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("lists draft label texts and the label keys that have no text", async () => {
    const t = await openBuilder();
    const store = configDraftStore(t.services).getState();
    store.setLabel("en", "field.plate.label", "Licence plate");
    store.setPath(["queryTypes", 0, "labelKey"], "query.nothing.here");
    await openChanges(t);
    const labels = await screen.findByRole("region", { name: /^Labels and translations/ });
    expect(within(labels).getByText("Licence plate")).toBeInTheDocument();
    const missing = await screen.findByRole("region", { name: "Labels with no text" });
    expect(within(missing).getByRole("button")).toHaveTextContent(/No text in English/);
    expect(within(missing).getByText("query.nothing.here")).toBeInTheDocument();
  });

  it("is read-only: no request but reads, Publish stays disabled, and there is no live region", async () => {
    const t = await openBuilder();
    await setDelimiter(t, "~");
    const liveRegions = document.querySelectorAll(
      "[aria-live], [role=status], [role=alert]",
    ).length;
    await openChanges(t);
    await screen.findByRole("region", { name: /Terminal settings/ });
    await t.user.click(screen.getByRole("button", { name: /Changed/ }));
    await openChanges(t);
    await screen.findByRole("region", { name: /Terminal settings/ });
    expect(writes).toEqual([]);
    expect(screen.getByRole("button", { name: "Publish" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(view().querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
    expect(document.querySelectorAll("[aria-live], [role=status], [role=alert]")).toHaveLength(
      liveRegions,
    );
  });

  it("says when the live version could not be checked and compares with what it has", async () => {
    const t = await openBuilder();
    await setDelimiter(t, "~");
    server.use(http.get(`${API}/api/v1/config`, () => HttpResponse.error()));
    await openChanges(t);
    expect(await screen.findByText(/could not be checked/)).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Terminal settings/ })).toBeInTheDocument();
  });

  it("keeps the view when a step is undone from it", async () => {
    const t = await openBuilder();
    await setDelimiter(t, "~");
    await openChanges(t);
    await screen.findByRole("region", { name: /Terminal settings/ });
    await t.user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(screen.getByText("No differences from the live version.")).toBeInTheDocument(),
    );
    await act(async () => {});
  });
});
