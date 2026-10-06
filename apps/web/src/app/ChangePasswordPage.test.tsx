import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { FakeSocket } from "../test/fake-socket.js";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";

// #543 (#511, #507 item 17; SEC-005): the page enforces the server's password minimum, the shared
// PASSWORD_MIN_LENGTH from core config, not a copy of it. Raised to 14 here, the page follows.
vi.mock("@querymodule/core/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@querymodule/core/config")>()),
  PASSWORD_MIN_LENGTH: 14,
}));

describe("ChangePasswordPage password minimum (#543)", () => {
  it("with the minimum at 14, refuses 13 characters before sending and says 14", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/api/v1/auth/get-session`, () =>
        HttpResponse.json({ session: { id: "s1" }, user: TEST_USER }),
      ),
      http.get(`${API}/api/v1/config`, () =>
        HttpResponse.json(
          { error: { code: "passwordChangeRequired", requestId: "r1" } },
          { status: 403 },
        ),
      ),
      http.post(`${API}/api/v1/auth/change-password`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ status: true });
      }),
    );
    const t = renderRoot({ path: "/", createSocket: () => new FakeSocket() });
    await screen.findByRole("heading", { name: "Choose a new password", level: 2 });
    const thirteen = "z".repeat(13);
    await t.user.type(screen.getByLabelText(/^Current password/), "temporary-pass-0001");
    await t.user.type(screen.getByLabelText(/^New password/), thirteen);
    await t.user.type(screen.getByLabelText(/^Confirm new password/), thirteen);
    await t.user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByLabelText(/^New password/)).toHaveAccessibleDescription(
      "Use at least 14 characters.",
    );
    expect(bodies).toEqual([]);
  });
});
