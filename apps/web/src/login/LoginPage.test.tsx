import { focusFirstInvalid } from "@querymodule/web-ui";
import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { API, server, TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { renderRoutes } from "../test/render-routes.js";
import { LoginPage } from "./LoginPage.js";

vi.mock("@querymodule/web-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@querymodule/web-ui")>();
  return { ...actual, focusFirstInvalid: vi.fn(actual.focusFirstInvalid) };
});

function renderLogin(clientSupported = true) {
  return renderRoutes(
    [
      { path: "/login", element: <LoginPage clientSupported={clientSupported} /> },
      { path: "/", element: <h1>Home placeholder</h1> },
    ],
    { path: "/login" },
  );
}

describe("BR-002 standalone sign-in screen (spec 5.6, 6.2)", () => {
  it("focuses the heading on arrival and labels both fields as required", async () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "Sign in" })).toHaveFocus();
    expect(screen.getByLabelText(/Email/)).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText(/Password/)).toHaveAttribute("aria-required", "true");
  });

  it("FR-005 empty submit marks both fields, focuses the first and announces the count", async () => {
    const { user } = renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const email = screen.getByLabelText(/Email/);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Email is required.");
    expect(screen.getByLabelText(/Password/)).toHaveAccessibleDescription("Password is required.");
    expect(email).toHaveFocus();
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent("2 fields need attention");
  });

  it("signs in with valid credentials and leaves for home", async () => {
    const { user, services } = renderLogin();
    await user.type(screen.getByLabelText(/Email/), TEST_USER.email);
    await user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Home placeholder" })).toBeInTheDocument();
    expect(services.authStore.getState().user?.email).toBe(TEST_USER.email);
  });

  it("a wrong password shows a generic error, clears the password and announces it", async () => {
    const { user } = renderLogin();
    await user.type(screen.getByLabelText(/Email/), TEST_USER.email);
    await user.type(screen.getByLabelText(/Password/), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Sign-in failed. Check your email and password.", {
        selector: "#login-error",
      }),
    ).toHaveAttribute("id", "login-error");
    expect(screen.getByLabelText(/Password/)).toHaveValue("");
    expect(screen.getByTestId("announcer-polite")).toHaveTextContent(
      "Sign-in failed. Check your email and password.",
    );
  });

  it("shows the limiter wait time", async () => {
    server.use(
      http.post(
        `${API}/api/v1/auth/sign-in/email`,
        () => new HttpResponse(null, { status: 429, headers: { "Retry-After": "60" } }),
      ),
    );
    const { user } = renderLogin();
    await user.type(screen.getByLabelText(/Email/), TEST_USER.email);
    await user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Too many attempts. Try again in 60 seconds.", {
        selector: "#login-error",
      }),
    ).toBeInTheDocument();
  });

  it("an unsupported client keeps submit focusable with aria-disabled and a visible reason", async () => {
    const { user, services } = renderLogin(false);
    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveAccessibleDescription("This app needs an update before you can sign in.");
    let signInCalls = 0;
    server.use(
      http.post(`${API}/api/v1/auth/sign-in/email`, () => {
        signInCalls += 1;
        return HttpResponse.json({ redirect: false, token: "t", user: TEST_USER });
      }),
    );
    await user.type(screen.getByLabelText(/Email/), TEST_USER.email);
    await user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await user.click(submit);
    await user.type(screen.getByLabelText(/Password/), "{Enter}");
    expect(signInCalls).toBe(0);
    expect(services.authStore.getState().status).not.toBe("signedIn");
  });

  it("falls back to focusing the heading when focusFirstInvalid finds nothing to focus", async () => {
    vi.mocked(focusFirstInvalid).mockReturnValueOnce(null);
    const { user } = renderLogin();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { name: "Sign in" })).toHaveFocus();
  });

  it("recovers from a rejected sign-in so the form isn't stuck submitting", async () => {
    server.use(
      http.post(
        `${API}/api/v1/auth/sign-in/email`,
        () => new HttpResponse("not json", { status: 200 }),
      ),
    );
    const { user } = renderLogin();
    await user.type(screen.getByLabelText(/Email/), TEST_USER.email);
    await user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("The service is unavailable. Try again.", {
        selector: "#login-error",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/)).toHaveValue("");
    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit).not.toHaveAttribute("aria-disabled", "true");
  });
});
