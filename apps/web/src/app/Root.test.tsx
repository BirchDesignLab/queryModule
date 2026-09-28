import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { API, server } from "../test/msw-server.js";
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
      await screen.findByRole("heading", { name: "The service is unavailable. Try again." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
