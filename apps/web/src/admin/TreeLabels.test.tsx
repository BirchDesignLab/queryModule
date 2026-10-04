import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { treeRenderStats } from "./BuilderTree.js";
import { configDraftStore } from "./ConfigBuilder.js";
import type { JsonObject } from "./draft.js";

beforeAll(preloadAdminRoutes);
afterEach(() => vi.unstubAllEnvs());

// Item 5: the tree's rows follow the draft's label edits, and a keystroke in one label re-renders
// only the rows that show that label, not every row of a big config.

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

/**
 * Resolves once the tree has stopped rendering (the counters unchanged across a short wait), so a
 * baseline taken after it is not still moving under parallel load (#507 item 23, #441).
 */
const settled = () => {
  let last = "";
  return waitFor(
    () => {
      const now = JSON.stringify(treeRenderStats);
      const same = now === last;
      last = now;
      expect(same).toBe(true);
    },
    { interval: 50, timeout: 5_000 },
  );
};

const nav = () => screen.getByRole("navigation", { name: "Configuration items" });
const store = (t: Opened) => configDraftStore(t.services);
/** The label key of Vehicle's first field, as the draft holds it. */
const plateKey = (t: Opened) => {
  const types = store(t).getState().doc?.queryTypes as { fields: { labelKey: string }[] }[];
  return types[0]?.fields[0]?.labelKey as string;
};
const rowNamed = (name: RegExp) => within(nav()).getByRole("treeitem", { name });

describe("tree rows and draft label edits", () => {
  it("a row shows the draft's text for its label, and goes back to the key when the text is cleared", async () => {
    const t = await openBuilder();
    expect(rowNamed(/^Plate plate\b/)).toBeInTheDocument();
    act(() => store(t).getState().setLabel("en", plateKey(t), "Licence plate"));
    await waitFor(() => expect(rowNamed(/^Licence plate plate\b/)).toBeInTheDocument());
    expect(within(nav()).queryByRole("treeitem", { name: /^Plate plate\b/ })).toBeNull();
    act(() => store(t).getState().setLabel("en", plateKey(t), ""));
    await waitFor(() => expect(rowNamed(/^plate(,|$)/)).toBeInTheDocument());
    act(() => store(t).getState().removeLabel("en", plateKey(t)));
    await waitFor(() => expect(rowNamed(/^Plate plate\b/)).toBeInTheDocument());
  });

  it("search finds a row by its edited text", async () => {
    const t = await openBuilder();
    act(() => store(t).getState().setLabel("en", plateKey(t), "Licence plate"));
    await t.user.type(within(nav()).getByRole("searchbox"), "licence");
    expect(
      await within(nav()).findByRole("treeitem", { name: /^Licence plate plate/ }),
    ).toBeInTheDocument();
    expect(within(nav()).queryByRole("treeitem", { name: /^State\b/ })).toBeNull();
  });

  it("a keystroke in one label re-renders that label's rows, not every row", async () => {
    const t = await openBuilder();
    // A big config: 40 more query types, each with the same fields and labels as Vehicle's.
    const doc = store(t).getState().doc as JsonObject;
    const list = doc.queryTypes as JsonObject[];
    const more = Array.from({ length: 40 }, (_, i) => ({
      ...structuredClone(list[0] as JsonObject),
      code: `Z${i}`,
      labelKey: `zz.type.${i}`,
    }));
    act(() =>
      store(t)
        .getState()
        .setDoc({ ...doc, queryTypes: [...list, ...more] }),
    );
    await waitFor(
      () => expect(store(t).getState().doc?.queryTypes).toHaveLength(list.length + 40),
      {
        timeout: 5_000,
      },
    );
    await settled();
    const key = plateKey(t);
    const before = { ...treeRenderStats };
    for (const text of ["L", "Li", "Lic", "Lice"])
      act(() => store(t).getState().setLabel("en", key, text));
    const rows = treeRenderStats.labels - before.labels;
    // Vehicle's Plate row and the 40 copies share one label key (they were copied whole), but only
    // the open type's rows are on screen: a few rows per keystroke, never the whole tree.
    expect(rows).toBeLessThanOrEqual(4 * 3);
    expect(treeRenderStats.rows).toBe(before.rows);
  });

  it("counts nothing in a production build (import.meta.env.DEV is false)", async () => {
    vi.stubEnv("DEV", false);
    const t = await openBuilder();
    await settled();
    const before = { ...treeRenderStats };
    act(() => store(t).getState().setLabel("en", plateKey(t), "Licence"));
    await waitFor(() => expect(store(t).getState().labels.en?.[plateKey(t)]).toBe("Licence"));
    expect(treeRenderStats).toEqual(before);
    vi.stubEnv("DEV", true);
    act(() => store(t).getState().setLabel("en", plateKey(t), "Licence plate"));
    await waitFor(() => expect(treeRenderStats.labels).toBeGreaterThan(before.labels));
  });
});
