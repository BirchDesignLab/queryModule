import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
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
    expect(screen.getByRole("heading", { name: "Query Module" })).toHaveFocus();
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
});
