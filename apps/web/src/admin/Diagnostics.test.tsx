import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { selectBuilderItem } from "../test/builder-tree.js";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { API, adminConfigBody, RAW_SITE, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";

beforeAll(preloadAdminRoutes);

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

const summary = () => screen.getByTestId("draft-summary");
const errorCount = (): number =>
  Number(/Draft checks: (\d+) errors/.exec(summary().textContent ?? "")?.[1] ?? Number.NaN);

async function breakCommand(t: Awaited<ReturnType<typeof openBuilder>>) {
  await selectBuilderItem(t.user, "commands");
  // Task 31 part 2: the commands editor (a code with the site delimiter "." is an error).
  const box = (await screen.findByText("Command VEH", { selector: "legend" })).closest("fieldset");
  const input = within(box as HTMLElement).getByLabelText("Code");
  await t.user.clear(input);
  await t.user.type(input, "V.EH");
  return input;
}

describe("config builder diagnostics (Task 33 client half, BR-001, UX-004, NFR-001)", () => {
  // C3: the seeded default site has a baseline of diagnostics, so this checks the announced counts.
  it("the draft check counts are announced in a polite region", async () => {
    await openBuilder();
    await waitFor(() =>
      expect(summary()).toHaveTextContent(/Draft checks: \d+ errors, \d+ warnings/),
    );
    expect(summary()).toHaveAttribute("aria-live", "polite");
  });

  it("an invalid edit shows its diagnostic at the control and in the count; fixing clears both", async () => {
    const t = await openBuilder();
    await waitFor(() => expect(errorCount()).toBeGreaterThanOrEqual(0));
    const base = errorCount();
    const input = await breakCommand(t);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() =>
      expect(
        document.getElementById(input.getAttribute("aria-describedby") ?? ""),
      ).toHaveTextContent(/cannot contain the delimiter ./),
    );
    expect(errorCount()).toBe(base + 1);
    expect(input).toHaveFocus();
    // the section heading and its tree row carry the count too
    expect(
      screen.getByRole("heading", {
        name: /^Terminal commands commands, [1-9]\d* errors?/,
        level: 3,
      }),
    ).toBeInTheDocument();

    await t.user.clear(input);
    await t.user.type(input, "VEH");
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "false"));
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(errorCount()).toBe(base);
  });

  it("the raw tab lists the same diagnostic with its line and the summary stays in sync", async () => {
    const t = await openBuilder();
    await breakCommand(t);
    await waitFor(() => expect(summary()).toHaveTextContent(/Draft checks: [1-9]\d* errors/));
    await t.user.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const area = screen.getByRole("textbox", { name: "Draft JSON" }) as HTMLTextAreaElement;
    const lines = area.value.split("\n");
    const line = lines.findIndex((l) => l.includes('"V.EH"')) + 1;
    expect(line).toBeGreaterThan(0);
    const region = document.getElementById(
      area.getAttribute("aria-describedby") ?? "",
    ) as HTMLElement;
    expect(await within(region).findByText(new RegExp(`^Line ${line}: `))).toBeInTheDocument();
    expect(area).not.toHaveFocus();
  });

  it("the disabled controls stay in the tab order, described by their reason", async () => {
    const t = await openBuilder();
    const save = screen.getByRole("button", { name: "Save draft" });
    const review = screen.getByRole("button", { name: "Review and publish" });
    const history = screen.getByRole("button", { name: "History" });
    history.focus();
    await t.user.tab();
    expect(save).toHaveFocus();
    await t.user.tab();
    expect(review).toHaveFocus();
    expect(save).toHaveAccessibleDescription("No new edits to save.");
    expect(review).toHaveAccessibleDescription(
      "Nothing to publish: the draft matches the live version.",
    );
    expect(history).not.toHaveAttribute("aria-disabled");
  });
});

describe("label checks use the shipped strings, like the server (CFG-5, ADR-0011 item 5, spec 5.8)", () => {
  /**
   * The live site names a label only the live overlay supplies, so the served bundle (shipped plus
   * live overlay) has it. A draft that drops the overlay entry must fail the browser check as it
   * fails the server's at Review: the server reads the shipped files plus the draft's own overlay.
   */
  async function openWith(liveKey: string, overlayText: Record<string, string>, draftOverlay = {}) {
    const siteConfig = { ...RAW_SITE, site: { id: "default", labelKey: liveKey } };
    server.use(
      http.get(`${API}/api/v1/locales/en`, () =>
        HttpResponse.json({ ...EN_BUNDLE, ...overlayText }),
      ),
      http.get(`${API}/api/v1/admin/config`, () =>
        HttpResponse.json(
          adminConfigBody({
            siteConfig,
            liveLocales: { en: overlayText },
            draft: { version: 2, siteConfig, locales: { en: draftOverlay } },
          }),
        ),
      ),
    );
    await openBuilder();
    await waitFor(() => expect(summary()).toHaveTextContent(/Draft checks: \d+ errors/));
  }

  it("removing a label only the live overlay supplies is an error in the browser too", async () => {
    await openWith("custom.liveOnly", { "custom.liveOnly": "Live only" });
    await waitFor(() => expect(errorCount()).toBe(1));
  });

  it("removing an overlay override of a shipped label is fine: the shipped text stays", async () => {
    await openWith("site.default", { "site.default": "Overridden" });
    await waitFor(() => expect(summary()).toHaveTextContent(/Draft checks: \d+ errors/));
    expect(errorCount()).toBe(0);
  });
});
