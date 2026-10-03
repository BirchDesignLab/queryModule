import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { FakeSocket } from "../test/fake-socket.js";
import { API, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";

// D-A26, SEC-005, UX-004: an admin-created user holds a temporary password. Any /api/v1 answer
// 403 passwordChangeRequired routes the signed-in user to "Choose a new password"; nothing else
// shows and no WebSocket opens until it is changed.

const TEMPORARY = "temporary-pass-0001";
const CHOSEN = "a-much-better-pass-1";

interface Flow {
  required: boolean;
  bodies: unknown[];
}

async function openRequired(
  change: (flow: Flow, body: { currentPassword: string; newPassword: string }) => Response,
) {
  const flow: Flow = { required: true, bodies: [] };
  const sockets = vi.fn();
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user: TEST_USER }),
    ),
    http.get(`${API}/api/v1/config`, () =>
      flow.required
        ? HttpResponse.json(
            { error: { code: "passwordChangeRequired", requestId: "r1" } },
            { status: 403 },
          )
        : HttpResponse.json(CLIENT_CONFIG),
    ),
    http.post(`${API}/api/v1/auth/change-password`, async ({ request }) => {
      const body = (await request.json()) as { currentPassword: string; newPassword: string };
      flow.bodies.push(body);
      return change(flow, body);
    }),
  );
  const t = renderRoot({
    path: "/",
    createSocket: () => {
      sockets();
      return new FakeSocket();
    },
  });
  await screen.findByRole("heading", { name: "Choose a new password", level: 2 });
  return { ...t, flow, sockets };
}

const fill = async (
  t: Awaited<ReturnType<typeof openRequired>>,
  values: { current?: string; next?: string; confirm?: string },
) => {
  if (values.current !== undefined)
    await t.user.type(screen.getByLabelText(/^Current password/), values.current);
  if (values.next !== undefined)
    await t.user.type(screen.getByLabelText(/^New password/), values.next);
  if (values.confirm !== undefined)
    await t.user.type(screen.getByLabelText(/^Confirm new password/), values.confirm);
};
const submit = (t: Awaited<ReturnType<typeof openRequired>>) =>
  t.user.click(screen.getByRole("button", { name: "Change password" }));

describe("forced password change (D-A26, SEC-005, UX-004)", () => {
  it("shows only the new-password screen: no header, no query panel, no socket; Sign out stays", async () => {
    const t = await openRequired(() => HttpResponse.json({ status: true }));
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Query Module$/ })).toBeNull();
    expect(t.sockets).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Choose a new password" })).toHaveFocus(),
    );
  });

  it("checks the three fields before sending anything, each error at its field", async () => {
    const t = await openRequired(() => HttpResponse.json({ status: true }));
    await submit(t);
    for (const label of [/^Current password/, /^New password/, /^Confirm new password/])
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Current password/)).toHaveFocus();
    await fill(t, { current: TEMPORARY, next: "short", confirm: "other" });
    await submit(t);
    expect(screen.getByLabelText(/^New password/)).toHaveAccessibleDescription(
      "Use at least 12 characters.",
    );
    expect(screen.getByLabelText(/^Confirm new password/)).toHaveAccessibleDescription(
      "The passwords do not match.",
    );
    expect(t.flow.bodies).toEqual([]);
  });

  it("a server 400 for the same password shows the temporary-password message at the new field", async () => {
    const t = await openRequired(() =>
      HttpResponse.json({ error: { code: "validationFailed", requestId: "r1" } }, { status: 400 }),
    );
    await fill(t, { current: TEMPORARY, next: TEMPORARY, confirm: TEMPORARY });
    await submit(t);
    const next = await screen.findByLabelText(/^New password/);
    await waitFor(() =>
      expect(next).toHaveAccessibleDescription(
        "Choose a password different from the temporary one",
      ),
    );
    expect(next).toHaveAttribute("aria-invalid", "true");
    expect(t.flow.bodies).toHaveLength(1);
  });

  it("a wrong current password shows at the current field", async () => {
    const t = await openRequired(() =>
      HttpResponse.json({ code: "INVALID_PASSWORD", message: "x" }, { status: 400 }),
    );
    await fill(t, { current: "not-the-temp-1", next: CHOSEN, confirm: CHOSEN });
    await submit(t);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Current password/)).toHaveAccessibleDescription(
        "The current password is not correct.",
      ),
    );
  });

  it("on success the app reloads its data and continues; the passwords are gone", async () => {
    const t = await openRequired((flow) => {
      flow.required = false;
      return HttpResponse.json({ status: true });
    });
    await fill(t, { current: TEMPORARY, next: CHOSEN, confirm: CHOSEN });
    await submit(t);
    expect(await screen.findByRole("heading", { name: /^Query Module$/ })).toBeInTheDocument();
    expect(t.flow.bodies).toEqual([{ currentPassword: TEMPORARY, newPassword: CHOSEN }]);
    expect(screen.queryByRole("heading", { name: "Choose a new password" })).toBeNull();
    expect(document.body.textContent).not.toContain(CHOSEN);
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Queries" })).toBeVisible();
  });

  it("Sign out works from the screen", async () => {
    const t = await openRequired(() => HttpResponse.json({ status: true }));
    await t.user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in", level: 2 })).toBeInTheDocument();
  });
});
