import { createDraftStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_CONFIG, submitRecorder } from "../test/msw-server.js";
import { renderRoutes } from "../test/render-routes.js";
import { QueryPanelView } from "./QueryPanelView.js";

const VEH = CLIENT_CONFIG.queryTypes.find((q) => q.code === "VEH");
if (VEH === undefined) throw new Error("fixture: VEH missing");

/** A config whose only type is absent from the default site. */
const CUSTOM: ClientSiteConfig = {
  ...CLIENT_CONFIG,
  queryTypes: [{ ...VEH, code: "ZZQ", labelKey: "custom.zzq.label" }],
  quickAccess: ["ZZQ"],
};

function renderView(
  props: Partial<{ config: ClientSiteConfig; mode: "live" | "preview"; idPrefix: string }> = {},
) {
  const drafts = createDraftStore();
  const view = renderRoutes([
    {
      path: "/",
      element: (
        <QueryPanelView
          config={props.config ?? CUSTOM}
          drafts={drafts}
          mode={props.mode ?? "preview"}
          idPrefix={props.idPrefix ?? "pv"}
        />
      ),
    },
  ]);
  return { ...view, drafts };
}

afterEach(() => {
  submitRecorder.calls = [];
});

describe("BR-001 / ADR-0011 query panel view renders from an injected config", () => {
  it("renders a query type that the default site does not have", async () => {
    renderView();
    expect(await screen.findByRole("button", { name: "custom.zzq.label" })).toBeInTheDocument();
    expect(screen.getByLabelText("Plate")).toBeInTheDocument();
  });

  it("preview: submit is aria-disabled with the visible reason Preview", async () => {
    renderView();
    const button = await screen.findByRole("button", { name: "Submit" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("Preview");
    expect(screen.getByText("Preview")).toBeVisible();
  });

  it("preview: Enter in a field and a click on Submit send no request", async () => {
    const { user } = renderView();
    await user.type(await screen.findByLabelText("Plate"), "ZZ-1234{Enter}");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(submitRecorder.calls).toEqual([]);
  });

  it("preview: terminal Enter sends no request", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.click(await screen.findByRole("button", { name: "Terminal mode" }));
    await user.type(await screen.findByLabelText("Command"), "VEH ZZ-1234{Enter}");
    expect(screen.queryByText("Preview")).toBeInTheDocument();
    expect(submitRecorder.calls).toEqual([]);
  });

  it("preview: registers no global shortcuts (Alt+1 does nothing)", async () => {
    const { user } = renderView({
      config: {
        ...CUSTOM,
        queryTypes: [
          { ...VEH, code: "ZZQ", labelKey: "custom.zzq.label" },
          { ...VEH, code: "ZZR", labelKey: "custom.zzr.label" },
        ],
        quickAccess: ["ZZQ", "ZZR"],
      },
    });
    const first = await screen.findByRole("button", { name: "custom.zzq.label" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Alt>}2{/Alt}");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "custom.zzr.label" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("uses only the injected draft store and resets it on unmount", async () => {
    const { user, drafts, services, unmount } = renderView();
    await user.type(await screen.findByLabelText("Plate"), "ZZ-1234");
    expect(drafts.getState().drafts.ZZQ?.values).toBeDefined();
    expect(services.drafts.getState().queryType).toBeNull();
    unmount();
    expect(drafts.getState().queryType).toBeNull();
    expect(drafts.getState().drafts).toEqual({});
  });

  it("two views with different idPrefix share no element id", async () => {
    const drafts = createDraftStore();
    const other = createDraftStore();
    renderRoutes([
      {
        path: "/",
        element: (
          <>
            <QueryPanelView config={CUSTOM} drafts={drafts} mode="preview" idPrefix="a" />
            <QueryPanelView config={CUSTOM} drafts={other} mode="preview" idPrefix="b" />
          </>
        ),
      },
    ]);
    await screen.findAllByLabelText("Plate");
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    expect(screen.getAllByLabelText("Plate")).toHaveLength(2);
  });
});
