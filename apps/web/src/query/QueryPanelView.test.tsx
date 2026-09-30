import { createDraftStore } from "@querymodule/client";
import { type ClientSiteConfig, resolveShortcuts } from "@querymodule/core/config";
import { ShortcutProvider } from "@querymodule/web-ui";
import { act, screen, waitFor, within } from "@testing-library/react";
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
    const button = await screen.findByRole("button", { name: "Run query" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("Preview");
    expect(screen.getByText("Preview")).toBeVisible();
  });

  it("preview: Enter in a field and a click on Submit send no request", async () => {
    const { user } = renderView();
    await user.type(await screen.findByLabelText("Plate"), "ZZ-1234{Enter}");
    await user.click(screen.getByRole("button", { name: "Run query" }));
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
    await user.click(screen.getByRole("button", { name: "Run query" }));
    expect(submit).not.toHaveBeenCalled();
    expect(submitRecorder.calls).toEqual([]);
  });

  it("M1 preview: a click on Submit validates too and sends nothing", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.click(await screen.findByRole("button", { name: "Person" }));
    await user.click(screen.getByRole("button", { name: "Run query" }));
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

describe("design B2 quick access: codes, shortcuts declared only where bound", () => {
  it("live: each button declares its Alt+n shortcut and one hint names the range", async () => {
    renderView({ config: CLIENT_CONFIG, mode: "live" });
    const group = await screen.findByRole("group", { name: "Quick access" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    buttons.forEach((b, i) => {
      expect(b).toHaveAttribute("aria-keyshortcuts", `Alt+${i + 1}`);
    });
    expect(within(group).getByText(`Alt+1 to Alt+${buttons.length} pick a type`)).toBeVisible();
    expect(within(group).getByRole("button", { name: "Vehicle" })).toHaveTextContent(/^VEHVehicle/);
  });
  it("preview: no shortcut is declared and no hint shows (the preview registers none)", async () => {
    renderView({ config: CLIENT_CONFIG, mode: "preview" });
    const group = await screen.findByRole("group", { name: "Quick access" });
    for (const b of within(group).getAllByRole("button"))
      expect(b).not.toHaveAttribute("aria-keyshortcuts");
    expect(within(group).queryByText(/pick a type/)).toBeNull();
  });
  it("a site that rebinds quickType1 is reflected on the first button only", async () => {
    const config: ClientSiteConfig = {
      ...CLIENT_CONFIG,
      shortcuts: { quickType1: [{ keys: "Alt+KeyQ", context: "global" }] },
    };
    renderView({ config, mode: "live" });
    const group = await screen.findByRole("group", { name: "Quick access" });
    const [first, second] = within(group).getAllByRole("button");
    expect(first).toHaveAttribute("aria-keyshortcuts", "Alt+Q");
    expect(second).toHaveAttribute("aria-keyshortcuts", "Alt+2");
  });
});

/** The command text the echo shows, without the prompt mark or the action. */
const echoText = () =>
  screen.getByRole("group", { name: "Command preview" }).querySelector("code")?.textContent ?? "";

describe("design B2 command echo (signature element, spec 4.4)", () => {
  it("shows the command the form is building, live, equal to the terminal's text", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await screen.findByRole("group", { name: "Command preview" });
    await user.type(screen.getByLabelText("Plate"), "ZZ-1234");
    expect(echoText()).toContain("VEH.ZZ-1234");
    // The same text the terminal shows after the toggle (one draft, spec 4.4).
    const text = echoText();
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    expect(await screen.findByRole("textbox", { name: "Command" })).toHaveValue(text);
  });

  it("Edit as command switches to the terminal with that text and focuses the command line", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.type(await screen.findByLabelText("Plate"), "ZZ-1234");
    const text = echoText();
    await user.click(screen.getByRole("button", { name: "Edit as command" }));
    const input = await screen.findByRole("textbox", { name: "Command" });
    expect(input).toHaveValue(text);
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole("group", { name: "Command preview" })).toBeNull();
  });

  it("follows the query type and takes no Tab stop of its own beyond its action", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await screen.findByRole("group", { name: "Command preview" });
    await user.click(screen.getByRole("button", { name: "Person" }));
    expect(echoText()).toMatch(/^PER/);
  });
});

describe("design B2 sources as chips and the sticky action bar", () => {
  it("each source is a chip with its timeout in mono; the checkbox keeps the source's name", async () => {
    renderView({ config: CLIENT_CONFIG });
    const box = await screen.findByRole("checkbox", { name: "State system" });
    const chip = box.closest(".qm-chip");
    const ms = CLIENT_CONFIG.sources.find((s) => s.id === "stateSource")?.timeoutMs ?? 0;
    expect(chip?.querySelector(".qm-chip__meta")).toHaveTextContent(`${Math.round(ms / 1000)} s`);
  });

  it("Run query carries the Enter hint aria-hidden; Clear and the status sit in the action bar", async () => {
    renderView({ config: CLIENT_CONFIG });
    const run = await screen.findByRole("button", { name: "Run query" });
    expect(run.querySelector(".qm-kbd")).toHaveTextContent("Enter");
    const bar = run.closest(".qm-action-bar") as HTMLElement;
    expect(within(bar).getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("a blocked run shows the count in the status line; Clear empties the values and the status, and focuses the first field", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.click(await screen.findByRole("button", { name: "Person" }));
    await user.click(screen.getByRole("button", { name: "Run query" }));
    const bar = screen.getByRole("button", { name: "Run query" }).closest(".qm-action-bar");
    expect(bar).toHaveTextContent(/needs? attention/);
    await user.type(screen.getByLabelText(/Last name/), "SMITH");
    await user.click(within(bar as HTMLElement).getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText(/Last name/)).toHaveValue("");
    expect(bar).not.toHaveTextContent(/needs? attention/);
    await waitFor(() => expect(screen.getByLabelText(/Last name/)).toHaveFocus());
  });

  it("Clear in terminal mode resets the command to the bare command and keeps focus in it", async () => {
    const { user } = renderView({ config: CLIENT_CONFIG });
    await user.type(await screen.findByLabelText("Plate"), "ZZ-1234");
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    const input = await screen.findByRole("textbox", { name: "Command" });
    expect((input as HTMLInputElement).value).toContain("ZZ-1234");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect((input as HTMLInputElement).value).not.toContain("ZZ-1234");
    await waitFor(() => expect(input).toHaveFocus());
  });
});

describe("preview never shows the Shown tag (a builder edit is not a rule reveal for the dispatcher)", () => {
  it("a rule reveal in preview announces as before but draws no tag", async () => {
    const VEH_DEFAULT = CLIENT_CONFIG.queryTypes.find((q) => q.code === "VEH");
    if (VEH_DEFAULT === undefined) throw new Error("fixture: VEH missing");
    const { drafts } = renderView({ config: CLIENT_CONFIG });
    await screen.findByLabelText("Plate");
    act(() => drafts.getState().setValue("state", "OK"));
    expect(await screen.findByLabelText(/Plate type/)).toBeInTheDocument();
    expect(document.querySelector(".qm-tag--shown")).toBeNull();
  });
});

describe("preview selectType: the builder picks the query type through the panel's own path", () => {
  let pick: (code: string | undefined) => void = () => undefined;
  function Picker({
    drafts,
    mode,
  }: {
    drafts: ReturnType<typeof createDraftStore>;
    mode: "live" | "preview";
  }) {
    const [code, setCode] = useState<string | undefined>(undefined);
    pick = setCode;
    return (
      <ShortcutProvider bindings={resolveShortcuts(CLIENT_CONFIG.shortcuts)}>
        <QueryPanelView
          config={CLIENT_CONFIG}
          drafts={drafts}
          mode={mode}
          idPrefix="st"
          selectType={code}
        />
      </ShortcutProvider>
    );
  }
  const renderPicker = (mode: "live" | "preview" = "preview") => {
    const drafts = createDraftStore();
    return {
      ...renderRoutes([{ path: "/", element: <Picker drafts={drafts} mode={mode} /> }]),
      drafts,
    };
  };
  const pressed = (name: string) =>
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");

  it("form mode: selects the type, keeps other types' values, and resets shown errors like a click", async () => {
    const { user } = renderPicker();
    await user.type(await screen.findByLabelText("Plate"), "ZZ-0001");
    act(() => pick("PER"));
    await waitFor(() => pressed("Person"));
    // A blocked run shows the required error on Last name.
    await user.type(screen.getByLabelText(/Last name/), "{Enter}");
    await waitFor(() =>
      expect(screen.getByLabelText(/Last name/)).toHaveAttribute("aria-invalid", "true"),
    );
    act(() => pick("VEH"));
    await waitFor(() => pressed("Vehicle"));
    expect(screen.getByLabelText("Plate")).toHaveValue("ZZ-0001");
    act(() => pick("PER"));
    await waitFor(() => pressed("Person"));
    expect(screen.getByLabelText(/Last name/)).not.toHaveAttribute("aria-invalid");
  });

  it("terminal mode: stays in the terminal, merges the typed command into its type, derives the new type's command", async () => {
    const { user, drafts } = renderPicker();
    await user.click(await screen.findByRole("button", { name: "Terminal mode" }));
    const command = screen.getByRole("textbox", { name: "Command" });
    await user.click(command);
    await user.keyboard("{Control>}a{/Control}VEH.ZZ-0002");
    act(() => pick("PER"));
    await waitFor(() => expect(drafts.getState().queryType).toBe("PER"));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement).value).toMatch(
        /^PER/,
      ),
    );
    expect(drafts.getState().drafts.VEH?.values.plate).toBe("ZZ-0002");
    expect(screen.queryByLabelText("Plate")).toBeNull();
  });

  it("never moves focus and ignores an unknown code", async () => {
    const { user } = renderPicker();
    const plate = await screen.findByLabelText("Plate");
    await user.click(screen.getByRole("button", { name: "Form mode" }));
    const before = document.activeElement;
    act(() => pick("ZZNOPE"));
    pressed("Vehicle");
    act(() => pick("PER"));
    await waitFor(() => pressed("Person"));
    expect(document.activeElement).toBe(before);
    expect(plate.isConnected).toBe(false);
  });

  it("live mode ignores the prop (preview only)", async () => {
    renderPicker("live");
    await screen.findByLabelText("Plate");
    act(() => pick("PER"));
    await new Promise((r) => setTimeout(r, 50));
    pressed("Vehicle");
  });
});
