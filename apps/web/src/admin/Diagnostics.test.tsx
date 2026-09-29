import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
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
  await t.user.click(await screen.findByText("commands"));
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
    // the section header carries the count too, so a collapsed section is not silent
    const header = screen.getAllByText("commands").find((e) => e.tagName === "SUMMARY");
    expect(header).toHaveTextContent(/Issues: [1-9]/);

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

  it("publish and history are disabled with reason text reachable by keyboard", async () => {
    const t = await openBuilder();
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeDisabled();
    expect(screen.getByRole("button", { name: "History" })).toBeDisabled();
    const reason = document.getElementById(publish.getAttribute("aria-describedby") ?? "");
    expect(reason).toHaveTextContent("Publish and history arrive with the config store");
    // disabled buttons are skipped, so tabbing lands on the reason text
    const tab = screen.getByRole("tab", { name: "Form" });
    tab.focus();
    await t.user.tab({ shift: true });
    expect(reason).toHaveFocus();
  });
});
