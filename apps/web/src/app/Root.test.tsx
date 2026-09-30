import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { SIGN_OUT_PENDING_KEY } from "../platform/sign-out-marker.js";
import { API, META, server, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";

describe("BR-002 boot, auth gate and chrome (spec 5.1, 6.1, 6.5)", () => {
  it("renders live regions before boot and redirects a signed-out user to sign-in", async () => {
    renderRoot();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(document.title).toBe("Query Module");
    expect(document.documentElement.lang).toBe("en");
  });
  it("UX-002 applies an OS-default theme and UX-001 a pointer persona to <html>", async () => {
    renderRoot();
    await screen.findByRole("heading", { name: "Sign in" });
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(document.documentElement.dataset.persona).toBe("dispatch");
  });
  it("shows a retry screen when the API is down and recovers on retry", async () => {
    server.use(
      http.get(`${API}/api/v1/meta`, () => new HttpResponse(null, { status: 503 }), { once: true }),
    );
    const { user } = renderRoot();
    expect(
      await screen.findByRole("heading", {
        name: "Service information is unavailable. Try again.",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
  it("spec 6.4, 10.6: a retry that fails again moves focus to the error heading, not body", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/api/v1/meta`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const { user } = renderRoot();
    const name = "Service information is unavailable. Try again.";
    await screen.findByRole("heading", { name });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBe(2));
    const heading = await screen.findByRole("heading", { name });
    await waitFor(() => expect(heading).toHaveFocus());
  });
  for (const path of ["/", "/status"]) {
    it(`NFR-001: an unsupported client with a live session gets the update gate at ${path}`, async () => {
      server.use(
        http.get(`${API}/api/v1/meta`, () =>
          HttpResponse.json({ ...META, minClientVersion: "99.0.0" }),
        ),
        http.get(`${API}/api/v1/auth/get-session`, () =>
          HttpResponse.json({ session: { id: "s1" }, user: TEST_USER }),
        ),
      );
      renderRoot({ path });
      const gate = await screen.findByRole("heading", { name: "Update required" });
      await waitFor(() => expect(gate).toHaveFocus());
      expect(
        screen.getByText("This app needs an update before you can continue.", { exact: false }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Query Module" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Status", level: 1 })).not.toBeInTheDocument();
    });
  }
  it("#242: sign-out from the update gate ends on the sign-in page", async () => {
    server.use(
      http.get(`${API}/api/v1/meta`, () =>
        HttpResponse.json({ ...META, minClientVersion: "99.0.0" }),
      ),
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user: TEST_USER }),
      ),
    );
    const { user, services } = renderRoot();
    await screen.findByRole("heading", { name: "Update required" });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(services.authStore.getState()).toMatchObject({ status: "signedOut", user: null });
  });
  it("#242: a failed sign-out from the gate gets the #241 handling: notice, retry and marker", async () => {
    server.use(
      http.get(`${API}/api/v1/meta`, () =>
        HttpResponse.json({ ...META, minClientVersion: "99.0.0" }),
      ),
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user: TEST_USER }),
      ),
      http.post(`${API}/api/v1/auth/sign-out`, () => new HttpResponse(null, { status: 503 })),
    );
    const { user } = renderRoot();
    await screen.findByRole("heading", { name: "Update required" });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("alert")).toHaveTextContent(
      "Sign-out failed on the server.",
    );
    expect(screen.getByRole("button", { name: "Retry sign-out" })).toBeInTheDocument();
    expect(localStorage.getItem(SIGN_OUT_PENDING_KEY)).toBe("1");
  });
});
