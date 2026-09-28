import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
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

describe("BR-002 home after sign-in", () => {
  it("shows the signed-in user and focuses the heading", async () => {
    await signIn();
    expect(screen.getByText(`Signed in as ${TEST_USER.email}`)).toBeInTheDocument();
    // Sign-in resolves outside act(), so React commits HomePage and runs its focus effect in a
    // later task; findByRole can return in between (focus still on body) under a loaded suite.
    const heading = screen.getByRole("heading", { name: "Query Module" });
    await waitFor(() => expect(heading).toHaveFocus());
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
  it("shows an error and stays put when sign-out fails, matching LoginPage's pattern", async () => {
    const { user, services } = await signIn();
    services.session.signOut = () => Promise.reject(new Error("network down"));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("The service is unavailable. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Query Module" })).toBeInTheDocument();
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
