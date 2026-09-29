import { act, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";

beforeAll(preloadAdminRoutes);

// Task 31 part 2 PR3b (#388): builder polish.

function asImplementer() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
}

const localeRequests: string[] = [];
const onRequest = ({ request }: { request: Request }) => {
  if (new URL(request.url).pathname === "/api/v1/locales/en") localeRequests.push(request.url);
};

afterEach(() => {
  server.events.removeListener("request:start", onRequest);
  localeRequests.length = 0;
});

describe("builder polish (#388)", () => {
  it("the builder reuses the English bundle bootstrap loaded (no second fetch)", async () => {
    server.events.on("request:start", onRequest);
    asImplementer();
    renderRoot({ path: "/admin/config" });
    await waitFor(() =>
      expect(screen.getByTestId("draft-summary")).toHaveTextContent(/Draft checks: \d+ errors/),
    );
    expect(localeRequests).toHaveLength(1);
  });

  it("opening the config page leaves focus on its section heading, not the console title", async () => {
    asImplementer();
    renderRoot({ path: "/admin/config" });
    const h2 = await screen.findByRole("heading", { name: "Site configuration", level: 2 });
    await waitFor(() => expect(h2).toHaveFocus());
    await waitFor(() =>
      expect(screen.getByTestId("draft-summary")).toHaveTextContent(/Draft checks/),
    );
    expect(h2).toHaveFocus();
  });

  it("the summary says the checks are loading until the bundle arrives, then shows the counts", async () => {
    asImplementer();
    const t = renderRoot({ path: "/" });
    const admin = await screen.findByRole("link", { name: "Admin" });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.get(`${API}/api/v1/locales/en`, async () => {
        await gate;
        return HttpResponse.json(EN_BUNDLE);
      }),
    );
    act(() => t.services.queryClient.removeQueries({ queryKey: ["locale", "en"] }));
    await t.user.click(admin);
    await t.user.click(await screen.findByRole("link", { name: "Site configuration" }));
    expect(await screen.findByText("Checking the draft…")).toBeInTheDocument();
    act(() => release());
    await waitFor(() =>
      expect(screen.getByTestId("draft-summary")).toHaveTextContent(/Draft checks: \d+ errors/),
    );
    expect(screen.queryByText("Checking the draft…")).toBeNull();
  });
});

describe("builder text keys (#388)", () => {
  it("every template-built admin key family has en text", async () => {
    const { flattenBundle } = await import("./draft.js");
    const { KINDS, OPS, EFFECTS, COMPARES } = await import("./RulesEditor.js");
    const { TABS } = await import("./ConfigBuilder.js");
    const en = flattenBundle(EN_BUNDLE);
    const keys = [
      ...KINDS.map((k) => `admin.config.condition.kind.${k}`),
      ...OPS.map((o) => `admin.config.op.${o}`),
      ...EFFECTS.map((e) => `admin.config.effect.${e}`),
      ...COMPARES.map((c) => `admin.config.condition.compare.${c}`),
      ...TABS.map((id) => `admin.config.tab.${id}`),
    ];
    expect(keys.filter((k) => !(k in en))).toEqual([]);
  });
});

describe("per-locale label checks (#388)", () => {
  it("a draft locale without a shipped bundle is checked on its own labels, not English", async () => {
    server.use(http.get(`${API}/api/v1/locales/fr`, () => new HttpResponse(null, { status: 404 })));
    asImplementer();
    const t = renderRoot({ path: "/admin/config" });
    const summary = () => screen.getByTestId("draft-summary");
    const count = () => Number(/(\d+) errors/.exec(summary().textContent ?? "")?.[1]);
    await waitFor(() => expect(summary()).toHaveTextContent(/Draft checks: \d+ errors/));
    const base = count();
    const { configDraftStore } = await import("./ConfigBuilder.js");
    const store = configDraftStore(t.services).getState();
    act(() => store.setPath(["locales"], ["en", "fr"]));
    await waitFor(() => expect(count()).toBeGreaterThan(base));
    // #404 m5: the extra errors are named fr labels, not just a bigger count.
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const raw = screen.getByRole("textbox", { name: "Draft JSON" });
    const list = document.getElementById(raw.getAttribute("aria-describedby") ?? "");
    expect(list?.textContent).toMatch(/has no text in locale fr\./);
    expect(list?.textContent).not.toMatch(/has no text in locale en\./);
  });

  it("#404 m2: a draft locale whose bundle fails with 500 is a load error, not an unshipped locale", async () => {
    server.use(http.get(`${API}/api/v1/locales/fr`, () => new HttpResponse(null, { status: 500 })));
    asImplementer();
    const t = renderRoot({ path: "/admin/config" });
    const summary = () => screen.getByTestId("draft-summary");
    await waitFor(() => expect(summary()).toHaveTextContent(/Draft checks: \d+ errors/));
    const { configDraftStore } = await import("./ConfigBuilder.js");
    act(() => configDraftStore(t.services).getState().setPath(["locales"], ["en", "fr"]));
    await waitFor(() => expect(summary()).toHaveTextContent(/draft checks are unavailable/i));
  });
});
