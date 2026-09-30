import { createDraftStore } from "@querymodule/client";
import { resolveShortcuts } from "@querymodule/core/config";
import { ShortcutProvider } from "@querymodule/web-ui";
import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { renderRoutes } from "../test/render-routes.js";
import { QueryPanelView } from "./QueryPanelView.js";

// The clock each consumer read, in call order.
const seen = vi.hoisted(() => ({ evaluate: [] as number[], echo: [] as number[] }));

vi.mock("@querymodule/core/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@querymodule/core/rules")>();
  return {
    ...actual,
    evaluateForm: (...args: Parameters<typeof actual.evaluateForm>) => {
      seen.evaluate.push(args[3]?.now ?? Number.NaN);
      return actual.evaluateForm(...args);
    },
  };
});

vi.mock("./form-to-terminal.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./form-to-terminal.js")>();
  return {
    ...actual,
    formToTerminal: (...args: Parameters<typeof actual.formToTerminal>) => {
      seen.echo.push(args[3]);
      return actual.formToTerminal(...args);
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  seen.evaluate.length = 0;
  seen.echo.length = 0;
});

describe("the command echo and the form read one clock (design fold-in, #415 critic)", () => {
  it("the echo is built with the same now the form was evaluated with, on first render and after an edit", async () => {
    let tick = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      tick += 1_000;
      return tick;
    });
    const drafts = createDraftStore();
    renderRoutes([
      {
        path: "/",
        element: (
          <ShortcutProvider bindings={resolveShortcuts(CLIENT_CONFIG.shortcuts)}>
            <QueryPanelView config={CLIENT_CONFIG} drafts={drafts} mode="preview" idPrefix="pv" />
          </ShortcutProvider>
        ),
      },
    ]);
    await screen.findByLabelText("Plate");
    expect(seen.echo.at(-1)).toBe(seen.evaluate.at(-1));
    act(() => drafts.getState().setValue("plate", "ZZ-0001"));
    await screen.findByText("VEH.ZZ-0001", { exact: false });
    expect(seen.echo.at(-1)).toBe(seen.evaluate.at(-1));
  });
});
