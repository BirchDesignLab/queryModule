import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDraftStore } from "@querymodule/client";
import {
  mergeSiteOverlay,
  migrateConfig,
  resolveShortcuts,
  SiteConfigSchema,
  toClientSiteConfig,
} from "@querymodule/core/config";
import { ShortcutProvider } from "@querymodule/web-ui";
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoutes } from "../test/render-routes.js";
import { QueryPanelView } from "./QueryPanelView.js";

// The example-ok site rows of the requirements examples (Track A P3 Tasks 22, 23), rendered through
// the same QueryPanelView as the default site: only the config differs (BR-001). These are the
// component-level twins of the default-site rows in e2e/example-queries.spec.ts (the e2e runner
// serves one site). Values are synthetic (spec 5.4).

// node:path, not new URL(rel, import.meta.url): jsdom's URL breaks the latter (see msw-server.ts).
const sites = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/config/sites");
const read = (name: string): unknown => JSON.parse(readFileSync(join(sites, name), "utf8"));

function resolveSite(overlayName: string | null) {
  const base = migrateConfig(read("default.json"));
  if (!base.ok) throw new Error("config does not migrate");
  if (overlayName === null) {
    return toClientSiteConfig(SiteConfigSchema.parse(base.config), "0".repeat(64));
  }
  const overlay = migrateConfig(read(overlayName));
  if (!overlay.ok) throw new Error("config does not migrate");
  const merged = mergeSiteOverlay(base.config, overlay.config);
  expect(merged.errors).toEqual([]);
  return toClientSiteConfig(SiteConfigSchema.parse(merged.config), "0".repeat(64));
}

const DEFAULT_SITE = resolveSite(null);
const EXAMPLE_OK = resolveSite("example-ok.json");

function renderSite(config: ReturnType<typeof resolveSite>) {
  return renderRoutes([
    {
      path: "/",
      element: (
        <ShortcutProvider bindings={resolveShortcuts(config.shortcuts)}>
          <QueryPanelView
            config={config}
            drafts={createDraftStore()}
            mode="preview"
            idPrefix="ok"
          />
        </ShortcutProvider>
      ),
    },
  ]);
}

const renderExampleOk = () => renderSite(EXAMPLE_OK);

/** The labels of the Property type radios after opening the Property query. */
async function propertyTypeLabels(view: ReturnType<typeof renderSite>) {
  await view.user.click(await screen.findByRole("button", { name: "Property" }));
  const type = await screen.findByRole("group", { name: /Property type/ });
  return within(type)
    .getAllByRole("radio")
    .map((r) => r.closest("label")?.textContent);
}

describe("example-ok site through the shared renderer (BR-001)", () => {
  it("State defaults to OK (site default), so the state-dependent fields start hidden", async () => {
    renderExampleOk();
    expect(await screen.findByLabelText("State")).toHaveValue("OK");
    expect(screen.queryByLabelText("Plate type")).not.toBeInTheDocument();
  });

  it("VEH: a state other than the site default shows Plate type and the site's Tag sticker (FR-008)", async () => {
    const { user } = renderExampleOk();
    const state = await screen.findByLabelText("State");
    await user.selectOptions(state, "TX");
    expect(await screen.findByLabelText(/Plate type/)).toBeRequired();
    expect(screen.getByLabelText(/Plate color/)).toBeRequired();
    expect(screen.getByLabelText("Tag sticker")).toBeInTheDocument();
  });

  it("PRO: the property type list has no Boat, site-narrowed with $remove (FR-031)", async () => {
    // Positive control: the same renderer on the unnarrowed default site does list Boat, so the
    // absence below can only come from the overlay's $remove.
    const control = await propertyTypeLabels(renderSite(DEFAULT_SITE));
    expect(control).toContain("Boat");
    cleanup();
    const labels = await propertyTypeLabels(renderExampleOk());
    expect(labels).toContain("Firearm");
    expect(labels).toContain("Article");
    expect(labels).not.toContain("Boat");
  });

  it("terminal: the site's / delimiter and NAM order last/first/race/sex/dob (FR-052)", async () => {
    const { user } = renderExampleOk();
    await user.click(await screen.findByRole("button", { name: "Person" }));
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    const command = await screen.findByRole("textbox", { name: "Command" });
    expect(screen.getByText(/VEH\/plate\/state/)).toBeInTheDocument();

    await user.clear(command);
    await user.type(command, "NAM/TESTERSON/SAMPLE/W/M/01011901");
    // Back to the form: what the command read is merged into the Person draft.
    await user.click(screen.getByRole("button", { name: "Form mode" }));
    expect(await screen.findByLabelText(/Last name/)).toHaveValue("TESTERSON");
    expect(screen.getByLabelText("First name")).toHaveValue("SAMPLE");
    expect(screen.getByLabelText("Race")).toHaveValue("W");
    expect(screen.getByLabelText("Sex")).toHaveValue("M");
    expect(screen.getByLabelText("Date of birth")).toHaveValue("01011901");
  });
});
