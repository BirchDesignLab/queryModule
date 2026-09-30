import { act, fireEvent, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, it } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { configDraftStore } from "./ConfigBuilder.js";
import { type JsonObject, validateDraft } from "./draft.js";

/**
 * #413 m10: what one keystroke in a label costs as the config grows. Off by default (it is a
 * measurement, not a check); run it with `QM_PERF=1 pnpm --filter @querymodule/web exec vitest run
 * src/admin/LabelCost.test.tsx` and read the table it prints. Numbers are jsdom wall time: compare
 * them with each other, not with a browser.
 */
const RUN = process.env.QM_PERF === "1";

beforeAll(preloadAdminRoutes);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

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

/** The draft with `types` query types: the first one copied under new codes. */
function grow(doc: JsonObject, types: number): JsonObject {
  const list = doc.queryTypes as JsonObject[];
  const base = list[0] as JsonObject;
  const more = Array.from({ length: types - 1 }, (_, i) => ({
    ...structuredClone(base),
    code: `Z${i}`,
  }));
  return { ...doc, queryTypes: [...list, ...more] };
}

describe.skipIf(!RUN)("label keystroke cost by config size (#413 m10)", () => {
  it("prints ms per keystroke in a label, in a setting, and one full validation", async () => {
    const rows: string[] = ["types  fields  label-key  setting-key  validate"];
    for (const types of [1, 20, 60]) {
      const t = await openBuilder();
      const store = configDraftStore(t.services);
      act(() => store.getState().setDoc(grow(store.getState().doc as JsonObject, types + 4)));
      const fields = (
        store.getState().doc as { queryTypes: { fields: unknown[] }[] }
      ).queryTypes.reduce((n, q) => n + q.fields.length, 0);
      const time = (fn: (i: number) => void, n = 15) => {
        const ms: number[] = [];
        for (let i = 0; i < n; i++) {
          const from = performance.now();
          act(() => fn(i));
          ms.push(performance.now() - from);
        }
        return median(ms);
      };
      const label = time((i) => store.getState().setLabel("en", "queryType.VEH", `Vehicle ${i}`));
      const setting = time((i) =>
        store.getState().setPath(["terminal", "delimiter"], i % 2 ? "," : "."),
      );
      const from = performance.now();
      validateDraft(store.getState().doc as JsonObject, store.getState().labels, {});
      const validate = performance.now() - from;
      rows.push(
        `${String(types + 4).padEnd(6)} ${String(fields).padEnd(7)} ${label.toFixed(1).padEnd(9)} ${setting.toFixed(1).padEnd(12)} ${validate.toFixed(1)}`,
      );
      t.unmount();
      fireEvent.keyDown(document.body, { key: "Escape" });
    }
    console.log(`\n${rows.join("\n")}\n`);
  }, 120000);
});
