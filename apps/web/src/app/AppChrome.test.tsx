import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGN_OUT_PENDING_KEY } from "../platform/sign-out-marker.js";
import {
  API,
  CLIENT_CONFIG,
  PREFERENCES,
  server,
  TEST_PASSWORD,
  TEST_USER,
} from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";

/** Opens the account disclosure (the header's account button is named by the signed-in email). */
async function openAccount(user: ReturnType<typeof renderRoot>["user"]) {
  await user.click(screen.getByRole("button", { name: TEST_USER.email }));
  return screen.getByRole("group", { name: "Account" });
}

async function signOutViaMenu(user: ReturnType<typeof renderRoot>["user"]) {
  await openAccount(user);
  await user.click(screen.getByRole("button", { name: "Sign out" }));
}

async function signIn() {
  const t = renderRoot();
  await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
  await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
  await t.user.click(screen.getByRole("button", { name: "Sign in" }));
  const heading = await screen.findByRole("heading", { name: "Query Module" });
  // The panel takes focus once it has mounted, in a later task; a disclosure opened before that
  // would lose the focus race and close (its blur handler), so wait for it.
  await waitFor(() => expect(heading).toHaveFocus());
  return t;
}

describe("ADR-0011 item 3 the config refresh runs while signed in (#361)", () => {
  it("AppShell starts it, and unmounting or a reset stops it", async () => {
    const t = renderRoot();
    const start = vi.spyOn(t.services.configRefresh, "start");
    const stop = vi.spyOn(t.services.configRefresh, "stop");
    await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
    await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await t.user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Query Module" });
    // The heading is committed before the passive effects of the same commit have run (a
    // findBy can resolve between the two, seen 4 in 300 locally and on CI): wait for the effect.
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await signOutViaMenu(t.user);
    await screen.findByRole("heading", { name: "Sign in" });
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });
});

describe("sign-in: a slow preferences load does not pull the user back", () => {
  it("a page opened while the preferences load is still pending stays open after it lands", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let served = false;
    server.use(
      http.get(`${API}/api/v1/me/preferences`, async () => {
        await gate;
        served = true;
        return HttpResponse.json(PREFERENCES);
      }),
    );
    const t = renderRoot();
    await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
    await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await t.user.click(screen.getByRole("button", { name: "Sign in" }));
    await t.user.click(await screen.findByRole("link", { name: "Status" }));
    await screen.findByRole("heading", { name: "Connection status" });
    release();
    await waitFor(() => expect(served).toBe(true));
    // Let the sign-in's continuation run (it used to navigate to "/" here).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByRole("heading", { name: "Connection status" })).toBeInTheDocument();
  });
});

describe("spec 6.4 skip link: the first Tab stop of every signed-in page", () => {
  it("is the first link in the document, before the header, and links to the main landmark", async () => {
    await signIn();
    const skip = screen.getByRole("link", { name: "Skip to query" });
    const header = screen.getByRole("banner");
    // Document order: the skip link precedes the header's controls.
    expect(skip.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header.contains(skip)).toBe(false);
    // A real fragment link to the main landmark (the browser moves focus there: see the e2e).
    expect(skip).toHaveAttribute("href", "#qm-main");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "qm-main");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
  it("a fresh load of / with a live session leaves focus at the top: the first Tab is the skip link", async () => {
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user: TEST_USER }),
      ),
    );
    const t = renderRoot({ path: "/" });
    await screen.findByRole("group", { name: "Quick access" });
    expect(screen.getByRole("heading", { name: "Query Module" })).not.toHaveFocus();
    await t.user.tab();
    expect(screen.getByRole("link", { name: "Skip to query" })).toHaveFocus();
  });
  it("right after sign-in the next Tab is the panel head's first control (Form mode), not the header", async () => {
    const t = await signIn();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Query Module" })).toHaveFocus(),
    );
    await screen.findByRole("group", { name: "Quick access" });
    await t.user.tab();
    expect(screen.getByRole("button", { name: "Form mode" })).toHaveFocus();
    await t.user.tab();
    await t.user.tab();
    expect(screen.getByRole("button", { name: "Vehicle" })).toHaveFocus();
  });
  it("Tab from the panel heading reaches a panel control, not the header's status link", async () => {
    const t = await signIn();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Query Module" })).toHaveFocus(),
    );
    await t.user.tab();
    const focused = document.activeElement as HTMLElement;
    expect(screen.getByRole("main").contains(focused)).toBe(true);
  });
  it("on /status it reads Skip to main content and targets that page's main landmark", async () => {
    const t = await signIn();
    await t.user.click(screen.getByRole("link", { name: "Status" }));
    const skip = await screen.findByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveAttribute("href", "#qm-main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "qm-main");
  });
});

describe("BR-002 signed-in chrome: header on the query panel (D-B4, design B1)", () => {
  it("shows the signed-in user on the account button and focuses the panel heading", async () => {
    await signIn();
    expect(
      within(screen.getByRole("banner")).getByRole("button", { name: TEST_USER.email }),
    ).toBeInTheDocument();
    // Sign-in resolves outside act(), so React commits the panel and runs its focus effect in a
    // later task; findByRole can return in between (focus still on body) under a loaded suite.
    const heading = screen.getByRole("heading", { name: "Query Module" });
    await waitFor(() => expect(heading).toHaveFocus());
  });
  it("B1 the header is a banner with the product name, site name, a Main nav and the account button", async () => {
    await signIn();
    const header = screen.getByRole("banner");
    // Its own element, so the officer bar can hide it visually and keep it for screen readers.
    expect(within(header).getByText("Query Module 2.0")).toHaveClass("qm-app-header__name");
    expect(within(header).queryByRole("heading")).toBeNull();
    expect(await within(header).findByText("Default site")).toBeInTheDocument();
    const nav = within(header).getByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Queries", "Status"]);
    expect(within(nav).getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
    expect(within(nav).getByRole("link", { name: "Queries" })).toHaveAttribute("href", "/");
    // The old temporary "Query panel" link is gone: Queries replaces it.
    expect(within(header).queryByRole("link", { name: "Query panel" })).toBeNull();
    expect(await screen.findByRole("group", { name: "Quick access" })).toBeInTheDocument();
  });
  it("B1 Queries is the current page on /, Status on /status", async () => {
    const { user } = await signIn();
    const nav = within(screen.getByRole("banner")).getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Queries" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Status" })).not.toHaveAttribute("aria-current");
    await user.click(within(nav).getByRole("link", { name: "Status" }));
    await screen.findByRole("heading", { name: "Connection status" });
    expect(within(nav).getByRole("link", { name: "Status" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Queries" })).not.toHaveAttribute("aria-current");
    // Queries goes back to the panel.
    await user.click(within(nav).getByRole("link", { name: "Queries" }));
    expect(await screen.findByRole("group", { name: "Quick access" })).toBeInTheDocument();
  });
  it("B1 the account disclosure holds the user, role, theme choice and sign-out, closed until opened", async () => {
    const { user } = await signIn();
    const button = screen.getByRole("button", { name: TEST_USER.email });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-haspopup");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    const panel = await openAccount(user);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", panel.id);
    expect(within(panel).getByText(`Signed in as ${TEST_USER.email}`)).toBeInTheDocument();
    expect(within(panel).getByText("Role: User")).toBeInTheDocument();
    expect(within(panel).getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    // Clicking the button again closes it.
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Account" })).toBeNull();
  });
  it("B1 sign out is reachable by keyboard inside the disclosure", async () => {
    const { user } = await signIn();
    const button = screen.getByRole("button", { name: TEST_USER.email });
    button.focus();
    await user.keyboard("{Enter}");
    const panel = screen.getByRole("group", { name: "Account" });
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    // The design's order: theme, then Keyboard shortcuts, then Sign out.
    expect(within(panel).getByRole("button", { name: "Keyboard shortcuts" })).toHaveFocus();
    await user.tab();
    expect(within(panel).getByRole("button", { name: "Sign out" })).toHaveFocus();
  });
  it("B1 Esc closes the disclosure and returns focus to the account button", async () => {
    const { user } = await signIn();
    const button = screen.getByRole("button", { name: TEST_USER.email });
    const panel = await openAccount(user);
    await user.click(within(panel).getByRole("button", { name: "Night" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Account" })).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
  it("B1 a click outside closes the disclosure", async () => {
    const { user } = await signIn();
    await openAccount(user);
    await user.click(screen.getByRole("main"));
    expect(screen.queryByRole("group", { name: "Account" })).toBeNull();
  });
  it("B1 focus stays on the same theme button when the layout flips to the compact bar", async () => {
    const { user, services } = await signIn();
    const panel = await openAccount(user);
    await user.click(within(panel).getByRole("button", { name: "Night" }));
    expect(within(panel).getByRole("button", { name: "Night" })).toHaveFocus();
    // The persona changes under the open menu (a config landing, a refresh): the dispatch
    // account menu unmounts with focus inside it.
    act(() => services.preferences.getState().setPersonaOverride("mobileUnit"));
    const banner = await waitFor(() => {
      const el = screen.getByRole("banner");
      expect(el).toHaveClass("qm-app-header--compact");
      return el;
    });
    expect(screen.queryByRole("group", { name: "Account" })).toBeNull();
    // The same mode's button in the new bar, not <main> and not <body>.
    expect(within(banner).getByRole("button", { name: "Night" })).toHaveFocus();
  });
  it("B1 the focused button's mode carries, not the pressed one, and nothing is announced", async () => {
    const { user, services } = await signIn();
    const panel = await openAccount(user);
    await user.click(within(panel).getByRole("button", { name: "Night" }));
    // Focus moves to Red shift without pressing it: Night stays the pressed mode.
    within(panel).getByRole("button", { name: "Red shift" }).focus();
    act(() => services.preferences.getState().setPersonaOverride("mobileUnit"));
    const banner = await waitFor(() => {
      const el = screen.getByRole("banner");
      expect(el).toHaveClass("qm-app-header--compact");
      return el;
    });
    const red = within(banner).getByRole("button", { name: "Red shift" });
    expect(red).toHaveFocus();
    expect(red).toHaveAttribute("aria-pressed", "false");
    expect(within(banner).getByRole("button", { name: "Night" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent(/^$/);
  });
  it("B1 the compact icon group is replaced by the account menu: focus goes to the account button", async () => {
    const { user, services } = await signIn();
    act(() => services.preferences.getState().setPersonaOverride("mobileUnit"));
    const banner = await waitFor(() => {
      const el = screen.getByRole("banner");
      expect(el).toHaveClass("qm-app-header--compact");
      return el;
    });
    await user.click(within(banner).getByRole("button", { name: "Day" }));
    expect(within(banner).getByRole("button", { name: "Day" })).toHaveFocus();
    // The full bar keeps the theme inside the closed disclosure, so the group is gone.
    act(() => services.preferences.getState().setPersonaOverride("dispatcher"));
    await waitFor(() =>
      expect(screen.getByRole("banner")).not.toHaveClass("qm-app-header--compact"),
    );
    expect(screen.getByRole("button", { name: TEST_USER.email })).toHaveFocus();
  });
  it("B1 a flip with focus outside the theme buttons leaves focus alone", async () => {
    const { user, services } = await signIn();
    const link = screen.getByRole("link", { name: "Status" });
    link.focus();
    act(() => services.preferences.getState().setPersonaOverride("mobileUnit"));
    await waitFor(() => expect(screen.getByRole("banner")).toHaveClass("qm-app-header--compact"));
    expect(screen.getByRole("link", { name: "Status" })).toHaveFocus();
    void user;
  });
  it("B4 the officer bar: theme as an icon group, the account disclosure without a second theme control", async () => {
    const { user, services } = await signIn();
    act(() => services.preferences.getState().setPersonaOverride("mobileUnit"));
    const banner = await waitFor(() => {
      const el = screen.getByRole("banner");
      expect(el).toHaveClass("qm-app-header--compact");
      return el;
    });
    // Theme sits in the bar as icon buttons named by their label; no select, no inline sign-out.
    const theme = within(banner).getByRole("group", { name: "Theme" });
    expect(
      within(theme)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Match system", "Day", "Night", "Red shift"]);
    expect(within(banner).queryByRole("combobox")).toBeNull();
    expect(within(banner).queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(within(banner).queryByText(/Signed in as/)).toBeNull();
    await user.click(within(theme).getByRole("button", { name: "Red shift" }));
    expect(document.documentElement.dataset.theme).toBe("redShift");
    // The disclosure keeps who, role and sign out, but not a second theme control.
    const panel = await openAccount(user);
    expect(within(panel).getByText(`Signed in as ${TEST_USER.email}`)).toBeInTheDocument();
    expect(within(panel).queryByRole("group", { name: "Theme" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
  it("D-B4 the header stays on the status page", async () => {
    const { user } = await signIn();
    await user.click(screen.getByRole("link", { name: "Status" }));
    expect(await screen.findByRole("heading", { name: "Connection status" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByRole("button", { name: TEST_USER.email }),
    ).toBeInTheDocument();
  });
  it("UX-002 switches theme without reload, from the account menu", async () => {
    const { user } = await signIn();
    const panel = await openAccount(user);
    await user.click(within(panel).getByRole("button", { name: "Red shift" }));
    expect(document.documentElement.dataset.theme).toBe("redShift");
    expect(within(panel).getByRole("button", { name: "Red shift" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("sign-out returns to sign-in and resets preferences", async () => {
    const { user, services } = await signIn();
    const panel = await openAccount(user);
    await user.click(within(panel).getByRole("button", { name: "Night" }));
    await user.click(within(panel).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(services.preferences.getState().themeMode).toBeNull();
  });
  it("SEC-006: a server sign-out failure lands on sign-in with a notice and a retry", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/sign-out`, () => new HttpResponse(null, { status: 503 }), {
        once: true,
      }),
    );
    const { user, services } = await signIn();
    await signOutViaMenu(user);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(services.authStore.getState()).toMatchObject({ status: "signedOut", user: null });
    const notice = within(screen.getByRole("main")).getByRole("alert");
    expect(notice).toHaveTextContent("Sign-out failed on the server.");
    expect(screen.getByRole("button", { name: "Retry sign-out" })).toBeInTheDocument();
  });
  it("SEC-006: a retry that fails keeps the notice; one that succeeds clears it", async () => {
    let failures = 2;
    server.use(
      http.post(`${API}/api/v1/auth/sign-out`, () =>
        failures-- > 0
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ success: true }),
      ),
    );
    const { user } = await signIn();
    await signOutViaMenu(user);
    await user.click(await screen.findByRole("button", { name: "Retry sign-out" }));
    await waitFor(() => expect(failures).toBe(0));
    expect(within(screen.getByRole("main")).getByRole("alert")).toHaveTextContent(
      "Sign-out failed on the server.",
    );
    await user.click(screen.getByRole("button", { name: "Retry sign-out" }));
    await waitFor(() =>
      expect(within(screen.getByRole("main")).queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Retry sign-out" })).not.toBeInTheDocument();
    // The focused retry button is gone; focus goes to the page heading, not body (spec 6.4).
    expect(screen.getByRole("heading", { name: "Sign in" })).toHaveFocus();
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("Signed out.");
  });
  it("#241: after a failed sign-out, a reload never shows the panel for the old user", async () => {
    // The server keeps failing, so the old session (cookie) stays valid on the server.
    server.use(
      http.post(`${API}/api/v1/auth/sign-out`, () => new HttpResponse(null, { status: 503 })),
    );
    const first = await signIn();
    await signOutViaMenu(first.user);
    await screen.findByRole("heading", { name: "Sign in" });
    first.unmount();
    renderRoot(); // a reload: fresh services, same browser storage
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("alert")).toHaveTextContent(
      "Sign-out failed on the server.",
    );
    expect(screen.queryByRole("heading", { name: "Query Module" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEST_USER.email })).not.toBeInTheDocument();
  });
  it("#241: a retry that succeeds at boot clears the marker and boots normally", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/sign-out`, () => new HttpResponse(null, { status: 503 }), {
        once: true,
      }),
    );
    const first = await signIn();
    await signOutViaMenu(first.user);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(localStorage.getItem(SIGN_OUT_PENDING_KEY)).toBe("1");
    first.unmount();
    renderRoot();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(SIGN_OUT_PENDING_KEY)).toBeNull());
    expect(within(screen.getByRole("main")).queryByRole("alert")).not.toBeInTheDocument();
  });
  it("UX-014 loads the saved theme at sign-in", async () => {
    const { services } = await signIn();
    expect(services.preferences.getState().themeMode).toBe(PREFERENCES.themeMode);
  });
  it("UX-014 saves a theme change to the user profile", async () => {
    const puts: unknown[] = [];
    server.use(
      http.put(`${API}/api/v1/me/preferences`, async ({ request }) => {
        const body = await request.json();
        puts.push(body);
        return HttpResponse.json(body);
      }),
    );
    const { user } = await signIn();
    const panel = await openAccount(user);
    await user.click(within(panel).getByRole("button", { name: "Red shift" }));
    await waitFor(() => expect(puts).toEqual([{ ...PREFERENCES, themeMode: "redShift" }]));
  });
});

describe("UX-002 site theme from GET /api/v1/config (spec 6.5, #175)", () => {
  const withSite = (theme: { defaultMode: string; auto: string }, themeMode: string | null) =>
    server.use(
      http.get(`${API}/api/v1/config`, () => HttpResponse.json({ ...CLIENT_CONFIG, theme })),
      http.get(`${API}/api/v1/me/preferences`, () =>
        HttpResponse.json({ ...PREFERENCES, themeMode }),
      ),
    );
  afterEach(() => {
    vi.useRealTimers();
  });
  it("signed out, the OS scheme decides", async () => {
    withSite({ defaultMode: "night", auto: "off" }, null);
    renderRoot();
    await screen.findByLabelText(/Email/);
    expect(document.documentElement.dataset.theme).toBe("day");
  });
  it("with no preference the site default applies after sign-in", async () => {
    withSite({ defaultMode: "night", auto: "off" }, null);
    await signIn();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("night"));
  });
  it("a user preference wins over the site default", async () => {
    withSite({ defaultMode: "night", auto: "off" }, "day");
    await signIn();
    await screen.findByRole("group", { name: "Quick access" });
    expect(document.documentElement.dataset.theme).toBe("day");
  });
  it("a signed-in reload on /status applies the site default without the query panel", async () => {
    withSite({ defaultMode: "night", auto: "off" }, null);
    await signIn();
    const reloaded = renderRoot({ path: "/status" });
    await within(reloaded.container).findByRole("heading", { name: "Connection status" });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("night"));
  });
  it("after sign-out the OS scheme decides again", async () => {
    withSite({ defaultMode: "night", auto: "off" }, null);
    const { user } = await signIn();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("night"));
    await signOutViaMenu(user);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(document.documentElement.dataset.theme).toBe("day");
  });
  it("preference auto with site auto time follows the clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 28, 21, 0));
    withSite({ defaultMode: "day", auto: "time" }, "auto");
    await signIn();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("night"));
  });
  it("D-B1: site default auto with auto time and no preference follows the clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 28, 21, 0));
    withSite({ defaultMode: "auto", auto: "time" }, null);
    await signIn();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("night"));
  });
});

describe("the account menu opens the keyboard shortcut sheet (visual system, app shell)", () => {
  it("on the query panel, Keyboard shortcuts sits before Sign out and opens the sheet only when chosen", async () => {
    const { user } = await signIn();
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    const panel = await openAccount(user);
    const buttons = within(panel)
      .getAllByRole("button")
      .map((b) => b.textContent);
    const item = within(panel).getByRole("button", { name: "Keyboard shortcuts" });
    expect(buttons.indexOf("Keyboard shortcuts")).toBe(buttons.indexOf("Sign out") - 1);
    await user.click(item);
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    // The menu closed; the sheet's opener is the account button.
    expect(screen.queryByRole("group", { name: "Account" })).toBeNull();
  });

  it("closing the sheet returns focus to the account button", async () => {
    const { user } = await signIn();
    await openAccount(user);
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: TEST_USER.email })).toHaveFocus();
  });

  it("focus repair A: the shortcut pressed inside the open menu; closing the sheet lands on the account button, not <body>", async () => {
    const { user } = await signIn();
    const panel = await openAccount(user);
    const night = within(panel).getByRole("button", { name: "Night" });
    night.focus();
    // Shift+/ from inside the menu: the sheet takes the theme button as its opener, then its own
    // focus closes the menu (focus moved outside it), so that opener leaves the page.
    fireEvent.keyDown(night, { code: "Slash", key: "?", shiftKey: true });
    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    // jsdom has no showModal, which is what moves focus into a real modal.
    within(sheet).getByRole("button", { name: "Close" }).focus();
    await waitFor(() => expect(screen.queryByRole("group", { name: "Account" })).toBeNull());
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: TEST_USER.email })).toHaveFocus();
  });

  it("off the panel (Status) there is no sheet to open, so the menu has no such item", async () => {
    const { user } = await signIn();
    await user.click(screen.getByRole("link", { name: "Status" }));
    await screen.findByRole("heading", { name: "Connection status" });
    const panel = await openAccount(user);
    expect(within(panel).queryByRole("button", { name: "Keyboard shortcuts" })).toBeNull();
  });
});
