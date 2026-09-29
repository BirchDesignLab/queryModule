import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { SIGN_OUT_PENDING_KEY } from "../platform/sign-out-marker.js";
import { API, PREFERENCES, server, TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";

async function signIn() {
  const t = renderRoot();
  await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
  await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
  await t.user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Query Module" });
  return t;
}

describe("BR-002 signed-in chrome: header on the query panel (D-B4)", () => {
  it("shows the signed-in user in the header and focuses the panel heading", async () => {
    await signIn();
    expect(screen.getByText(`Signed in as ${TEST_USER.email}`)).toBeInTheDocument();
    // Sign-in resolves outside act(), so React commits the panel and runs its focus effect in a
    // later task; findByRole can return in between (focus still on body) under a loaded suite.
    const heading = screen.getByRole("heading", { name: "Query Module" });
    await waitFor(() => expect(heading).toHaveFocus());
  });
  it("D-B4 the header carries the status link, theme select and sign-out, and the panel is at /", async () => {
    await signIn();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Connection status" })).toHaveAttribute(
      "href",
      "/status",
    );
    expect(within(header).getByLabelText("Theme")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Query type")).toBeInTheDocument();
  });
  it("D-B4 the header stays on the status page", async () => {
    const { user } = await signIn();
    await user.click(screen.getByRole("link", { name: "Connection status" }));
    expect(await screen.findByRole("heading", { name: "Connection status" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
  it("UX-002 switches theme without reload", async () => {
    const { user } = await signIn();
    await user.selectOptions(screen.getByLabelText("Theme"), "redShift");
    expect(document.documentElement.dataset.theme).toBe("redShift");
  });
  it("sign-out returns to sign-in and resets preferences", async () => {
    const { user, services } = await signIn();
    await user.selectOptions(screen.getByLabelText("Theme"), "night");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
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
    await user.click(screen.getByRole("button", { name: "Sign out" }));
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
    await user.click(screen.getByRole("button", { name: "Sign out" }));
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
    await first.user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Sign in" });
    first.unmount();
    renderRoot(); // a reload: fresh services, same browser storage
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("alert")).toHaveTextContent(
      "Sign-out failed on the server.",
    );
    expect(screen.queryByRole("heading", { name: "Query Module" })).not.toBeInTheDocument();
    expect(screen.queryByText(`Signed in as ${TEST_USER.email}`)).not.toBeInTheDocument();
  });
  it("#241: a retry that succeeds at boot clears the marker and boots normally", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/sign-out`, () => new HttpResponse(null, { status: 503 }), {
        once: true,
      }),
    );
    const first = await signIn();
    await first.user.click(screen.getByRole("button", { name: "Sign out" }));
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
    await user.selectOptions(screen.getByLabelText("Theme"), "redShift");
    await waitFor(() => expect(puts).toEqual([{ ...PREFERENCES, themeMode: "redShift" }]));
  });
});
