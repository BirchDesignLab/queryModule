import { createTranslator } from "@querymodule/client";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";
import { I18nProvider } from "../app/i18n-context.js";
import { leaveGuards } from "../app/leave-guard.js";
import { ServicesProvider } from "../app/services-context.js";
import { findSetting, selectBuilderItem } from "../test/builder-tree.js";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";
import { testServices } from "../test/render-routes.js";
import { configDraftStore } from "./ConfigBuilder.js";
import { LeaveDialog, LeaveGuard } from "./LeaveGuard.js";

beforeAll(preloadAdminRoutes);

// B1 dirty-draft guard: sign-out asks before it wipes a draft with changes, and the browser is
// asked to prompt before a tab close or reload. In-app navigation is not guarded: the draft
// survives it, and a warning that is always clicked through teaches people to click through.

let signOuts = 0;

async function openBuilder() {
  const user = { ...TEST_USER, role: "implementer" };
  signOuts = 0;
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user }),
    ),
    http.post(`${API}/api/v1/auth/sign-out`, () => {
      signOuts++;
      return HttpResponse.json({ success: true });
    }),
  );
  const t = renderRoot({ path: "/admin/config" });
  await screen.findByRole("tab", { name: "Form" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openBuilder>>;

async function makeChange(t: Opened) {
  await selectBuilderItem(t.user, "terminal");
  const input = await findSetting("terminal.delimiter");
  await t.user.clear(input);
  await t.user.type(input, "~");
}
async function signOutViaMenu(t: Opened) {
  await t.user.click(screen.getByRole("button", { name: TEST_USER.email }));
  await t.user.click(screen.getByRole("button", { name: "Sign out" }));
}
const dialog = () => screen.getByRole("dialog", { name: "Sign out with unsaved edits?" });
const stay = () => within(dialog()).getByRole("button", { name: "Stay signed in" });
const leave = () => within(dialog()).getByRole("button", { name: "Sign out" });

describe("dirty-draft guard (B1)", () => {
  it("signing out with no changes just signs out", async () => {
    const t = await openBuilder();
    await signOutViaMenu(t);
    await waitFor(() => expect(signOuts).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("signing out with changes asks first: a dialog that says what is lost, and nothing has happened yet", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    expect(dialog()).toBeInTheDocument();
    expect(dialog()).toHaveAccessibleDescription(/not saved.*discarded.*saved draft stays/i);
    expect(signOuts).toBe(0);
    expect(screen.getByRole("tab", { name: "Form" })).toBeInTheDocument();
    // Focus starts on the safe choice.
    await waitFor(() => expect(stay()).toHaveFocus());
  });

  it("Stay signed in closes it, keeps the session and the draft, and focus is not lost", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    await t.user.click(stay());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(signOuts).toBe(0);
    expect(screen.getByRole("tab", { name: "Form" })).toBeInTheDocument();
    expect(configDraftStore(t.services).getState().undoCount).toBeGreaterThan(0);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("Escape cancels the same way", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    await t.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(signOuts).toBe(0);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("Sign out in the dialog signs out", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    await t.user.click(leave());
    await waitFor(() => expect(signOuts).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focus stays inside the dialog: Tab and Shift+Tab wrap between its two buttons", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    await waitFor(() => expect(stay()).toHaveFocus());
    await t.user.tab();
    expect(leave()).toHaveFocus();
    await t.user.tab();
    expect(stay()).toHaveFocus();
    await t.user.tab({ shift: true });
    expect(leave()).toHaveFocus();
  });

  it("in-app navigation is not guarded: the draft survives it", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await t.user.click(screen.getByRole("link", { name: "Status" }));
    await screen.findByRole("heading", { name: /status/i, level: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(configDraftStore(t.services).getState().undoCount).toBeGreaterThan(0);
  });

  it("undoing back to the live config makes the draft clean again", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await t.user.click(screen.getByRole("button", { name: "Undo" }));
    await signOutViaMenu(t);
    await waitFor(() => expect(signOuts).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the browser's own prompt is asked for while there are changes, and not otherwise", async () => {
    const t = await openBuilder();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await makeChange(t);
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    // Leaving the builder removes the listener (and the sign-out guard).
    await t.user.click(screen.getByRole("link", { name: "Status" }));
    await screen.findByRole("heading", { name: /status/i, level: 1 });
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("a draft reset (a 401, a user change) leaves without asking: the draft is gone", async () => {
    const t = await openBuilder();
    await makeChange(t);
    act(() => t.services.reset.resetAll());
    await waitFor(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it("the dialog is not a live region and does not announce", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    expect(dialog().closest("[aria-live], [role=status], [role=alert]")).toBeNull();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(t.services.announcer.current().polite?.text ?? "").not.toMatch(/sign/i);
  });

  it("the draft's undo keys do nothing inside the dialog", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    const before = configDraftStore(t.services).getState().undoCount;
    expect(fireEvent.keyDown(stay(), { key: "z", ctrlKey: true })).toBe(true);
    expect(configDraftStore(t.services).getState().undoCount).toBe(before);
  });
});

describe("LeaveDialog focus return", () => {
  it("with the opener gone, focus goes to the fallback", async () => {
    const opener = document.createElement("button");
    const fallback = document.createElement("button");
    document.body.append(opener, fallback);
    opener.focus();
    const props = {
      title: "T",
      body: "B",
      stayLabel: "Stay",
      leaveLabel: "Go",
      onStay: () => {},
      onLeave: () => {},
      fallback: () => fallback,
    };
    const view = render(<LeaveDialog open={false} {...props} />);
    view.rerender(<LeaveDialog open {...props} />);
    opener.remove();
    view.rerender(<LeaveDialog open={false} {...props} />);
    expect(fallback).toHaveFocus();
    fallback.remove();
  });
});

describe("LeaveGuard when the dialog goes another way", () => {
  it("I1: a builder that unmounts while asking does not sign the user out", async () => {
    const services = testServices();
    const view = render(
      <ServicesProvider services={services}>
        <I18nProvider translator={createTranslator("en", EN_BUNDLE)}>
          <LeaveGuard dirty />
        </I18nProvider>
      </ServicesProvider>,
    );
    const answer = leaveGuards(services).confirm();
    await screen.findByRole("dialog", { name: "Sign out with unsaved edits?" });
    view.unmount();
    // Not confirmed by the user: the sign-out stays undone, and the next one goes straight through.
    expect(await answer).toBe(false);
    expect(await leaveGuards(services).confirm()).toBe(true);
  });

  it("I2: a dialog the browser closes on its own counts as Stay, so the next sign-out asks again", async () => {
    const t = await openBuilder();
    await makeChange(t);
    await signOutViaMenu(t);
    const first = dialog();
    fireEvent(first, new Event("close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(signOuts).toBe(0);
    await signOutViaMenu(t);
    expect(dialog()).toBeInTheDocument();
    await t.user.click(leave());
    await waitFor(() => expect(signOuts).toBe(1));
  });
});
