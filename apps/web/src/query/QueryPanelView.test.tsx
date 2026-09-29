import { createDraftStore } from "@querymodule/client";
import { type ClientSiteConfig, resolveShortcuts } from "@querymodule/core/config";
import { ShortcutProvider } from "@querymodule/web-ui";
import { act, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        <ShortcutProvider bindings={resolveShortcuts((props.config ?? CUSTOM).shortcuts)}>
          <QueryPanelView
            config={props.config ?? CUSTOM}
            drafts={drafts}
            mode={props.mode ?? "preview"}
            idPrefix={props.idPrefix ?? "pv"}
          />
        </ShortcutProvider>
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

  const TWO: ClientSiteConfig = {
    ...CUSTOM,
    queryTypes: [
      { ...VEH, code: "ZZQ", labelKey: "custom.zzq.label" },
      { ...VEH, code: "ZZR", labelKey: "custom.zzr.label" },
    ],
    quickAccess: ["ZZQ", "ZZR"],
  };

  it("live control: Alt+2 selects the second type under a ShortcutProvider", async () => {
    const { user } = renderView({ config: TWO, mode: "live" });
    const second = await screen.findByRole("button", { name: "custom.zzr.label" });
    expect(second).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("{Alt>}2{/Alt}");
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("preview: registers no global shortcuts (Alt+2 does nothing, Shift+/ opens no dialog)", async () => {
    const { user } = renderView({ config: TWO });
    const first = await screen.findByRole("button", { name: "custom.zzq.label" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Alt>}2{/Alt}");
    await user.keyboard("{Shift>}/{/Shift}");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "custom.zzr.label" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

describe("ADR-0011 the preview shows what dispatchers see (checker ruling M1, M2)", () => {
  const polite = () => screen.getByTestId("announcer-polite");

  it("M1 preview: Enter with a required field empty shows the errors like live and sends nothing", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.click(await screen.findByRole("button", { name: "Person" }));
    await user.type(screen.getByLabelText(/First name/), "SAMPLE{Enter}");
    const last = screen.getByLabelText(/Last name/);
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(last).toHaveFocus();
    expect(polite()).toHaveTextContent(/field needs attention/);
    expect(submitRecorder.calls).toEqual([]);
  });

  it("M1 preview: a valid Enter never calls the submit controller", async () => {
    const { user, services } = renderView({ config: CLIENT_CONFIG });
    const submit = vi.spyOn(services.submit.getState(), "submit");
    await user.type(await screen.findByLabelText("Plate"), "ZZ-1234{Enter}");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(submit).not.toHaveBeenCalled();
    expect(submitRecorder.calls).toEqual([]);
  });

  it("M1 preview: a click on Submit validates too and sends nothing", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.click(await screen.findByRole("button", { name: "Person" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByLabelText(/Last name/)).toHaveAttribute("aria-invalid", "true");
    expect(submitRecorder.calls).toEqual([]);
  });

  it("M1 preview: terminal Enter lists command problems like live and sends nothing", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.click(await screen.findByRole("button", { name: "Terminal mode" }));
    const command = await screen.findByLabelText("Command");
    await user.clear(command);
    await user.type(command, "XYZ.123{Enter}");
    const list = screen.getByRole("list", { name: "Command problems" });
    expect(within(list).getByText("Unrecognized command XYZ.")).toBeInTheDocument();
    await user.clear(command);
    await user.type(command, "VEH.ZZ-1234{Enter}");
    expect(submitRecorder.calls).toEqual([]);
  });

  const TWO: ClientSiteConfig = {
    ...CUSTOM,
    queryTypes: [
      { ...VEH, code: "ZZQ", labelKey: "custom.zzq.label" },
      { ...VEH, code: "ZZR", labelKey: "custom.zzr.label" },
    ],
    quickAccess: ["ZZQ", "ZZR"],
  };
  const ZZQ_TYPE = { ...VEH, code: "ZZQ", labelKey: "custom.zzq.label" };
  let swap: (next: ClientSiteConfig) => void = () => undefined;
  function Swappable({ drafts }: { drafts: ReturnType<typeof createDraftStore> }) {
    const [config, setConfig] = useState(TWO);
    swap = setConfig;
    return <QueryPanelView config={config} drafts={drafts} mode="preview" idPrefix="sw" />;
  }
  const renderSwappable = () => {
    const drafts = createDraftStore();
    return { ...renderRoutes([{ path: "/", element: <Swappable drafts={drafts} /> }]), drafts };
  };

  it("M2 preview: when the selected type is removed it falls back to the first quick-access type", async () => {
    const { user, drafts } = renderSwappable();
    await user.click(await screen.findByRole("button", { name: "custom.zzr.label" }));
    act(() => swap({ ...TWO, queryTypes: [ZZQ_TYPE], quickAccess: ["ZZQ"] }));
    expect(await screen.findByRole("button", { name: "custom.zzq.label" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(drafts.getState().queryType).toBe("ZZQ");
    expect(screen.getByLabelText("Plate")).toBeInTheDocument();
  });

  it("M2 preview: when the selected type is renamed it falls back to the first quick-access type", async () => {
    const { user } = renderSwappable();
    await user.click(await screen.findByRole("button", { name: "custom.zzr.label" }));
    act(() =>
      swap({
        ...TWO,
        queryTypes: [ZZQ_TYPE, { ...VEH, code: "ZZS", labelKey: "custom.zzs.label" }],
        quickAccess: ["ZZQ", "ZZS"],
      }),
    );
    expect(await screen.findByRole("button", { name: "custom.zzq.label" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "custom.zzs.label" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("design B2 panel head: type heading and the form or terminal switch", () => {
  it("names the current query type in an h2 and follows the type", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    expect(await screen.findByRole("heading", { level: 2, name: "Vehicle query" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Person" }));
    expect(screen.getByRole("heading", { level: 2, name: "Person query" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Vehicle query" })).toBeNull();
  });

  it("the entry mode is a segmented control: Form mode pressed, Terminal mode switches and back", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    const group = await screen.findByRole("group", { name: "Entry mode" });
    const form = within(group).getByRole("button", { name: "Form mode" });
    const terminal = within(group).getByRole("button", { name: "Terminal mode" });
    expect(form).toHaveAttribute("aria-pressed", "true");
    expect(terminal).toHaveAttribute("aria-pressed", "false");
    await user.click(terminal);
    expect(await screen.findByRole("textbox", { name: "Command" })).toBeInTheDocument();
    expect(terminal).toHaveAttribute("aria-pressed", "true");
    expect(form).toHaveAttribute("aria-pressed", "false");
    await user.click(form);
    expect(await screen.findByLabelText("Plate")).toBeInTheDocument();
    expect(form).toHaveAttribute("aria-pressed", "true");
  });
});
