import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { API, server, TEST_USER } from "../test/msw-server.js";
import { preloadAdminRoutes } from "../test/preload-admin.js";
import { renderRoot } from "../test/render-root.js";

beforeAll(preloadAdminRoutes);
afterEach(() => vi.restoreAllMocks());

// Task 34 (#359, SEC-005, UX-004): People > Users and roles. One table, row actions that carry the
// user's name, a create dialog that shows the temporary password once, and the guards' messages.

const T0 = Date.UTC(2026, 9, 1, 15, 30, 0);
const SESSION_A = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01";
const SESSION_B = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02";
const SESSION_SELF = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03";
const TEMPORARY = "tmp-Pass-0123456789abcdef";
const LAST_ADMIN_TEXT =
  "At least one enabled admin must remain, and you cannot change your own role or account.";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "user" | "trainingOfficer" | "admin" | "implementer";
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  signInCount: number;
  lastSignInAt: number | null;
  distinctIps: number;
}

const row = (over: Partial<UserRow> & Pick<UserRow, "id" | "email" | "name">): UserRow => ({
  role: "user",
  disabled: false,
  mustChangePassword: false,
  createdAt: T0,
  signInCount: 0,
  lastSignInAt: null,
  distinctIps: 0,
  ...over,
});

const SELF = row({
  id: TEST_USER.id,
  email: TEST_USER.email,
  name: "Test Admin",
  role: "admin",
  signInCount: 12,
  lastSignInAt: T0,
  distinctIps: 2,
});
const ROSE = row({
  id: "user-0002",
  email: "rose.dispatch@querymodule.test",
  name: "Rose Dispatch",
  signInCount: 3,
  lastSignInAt: T0 - 86_400_000,
  distinctIps: 1,
});
const NEWBIE = row({
  id: "user-0003",
  email: "new.hire@querymodule.test",
  name: "New Hire",
  mustChangePassword: true,
});
const GONE = row({
  id: "user-0004",
  email: "gone.user@querymodule.test",
  name: "Gone User",
  disabled: true,
});

interface Calls {
  lists: number;
  roles: { id: string; role: string }[];
  disables: string[];
  creates: unknown[];
  revoked: string[];
  sessionLists: string[];
}
let calls: Calls;
let users: UserRow[];

type Handlers = {
  role?: (id: string, role: string) => Response | undefined;
  disable?: (id: string) => Response | undefined;
  create?: () => Response | undefined;
};

const apiError = (code: string, status: number) =>
  HttpResponse.json({ error: { code, requestId: "r1" } }, { status });

async function openUsers(initial: UserRow[] = [SELF, ROSE, NEWBIE, GONE], handlers: Handlers = {}) {
  calls = { lists: 0, roles: [], disables: [], creates: [], revoked: [], sessionLists: [] };
  users = initial;
  const me = { ...TEST_USER, role: "admin" };
  server.use(
    http.get(`${API}/api/v1/auth/get-session`, () =>
      HttpResponse.json({ session: { id: "s1" }, user: me }),
    ),
    http.get(`${API}/api/v1/admin/users`, () => {
      calls.lists++;
      return HttpResponse.json({ users });
    }),
    http.put(`${API}/api/v1/admin/users/:id/role`, async ({ params, request }) => {
      const { role } = (await request.json()) as { role: UserRow["role"] };
      const id = String(params.id);
      calls.roles.push({ id, role });
      const refused = handlers.role?.(id, role);
      if (refused !== undefined) return refused;
      users = users.map((u) => (u.id === id ? { ...u, role } : u));
      return HttpResponse.json(users.find((u) => u.id === id));
    }),
    http.post(`${API}/api/v1/admin/users/:id/disable`, ({ params }) => {
      const id = String(params.id);
      calls.disables.push(id);
      const refused = handlers.disable?.(id);
      if (refused !== undefined) return refused;
      users = users.map((u) => (u.id === id ? { ...u, disabled: true } : u));
      return HttpResponse.json({ user: users.find((u) => u.id === id), sessionsRevoked: 2 });
    }),
    http.post(`${API}/api/v1/admin/users`, async ({ request }) => {
      const body = (await request.json()) as { email: string; name: string; role: UserRow["role"] };
      calls.creates.push(body);
      const refused = handlers.create?.();
      if (refused !== undefined) return refused;
      const made = row({
        id: "user-0100",
        email: body.email,
        name: body.name,
        role: body.role,
        mustChangePassword: true,
      });
      users = [...users, made];
      return HttpResponse.json({ user: made, temporaryPassword: TEMPORARY }, { status: 201 });
    }),
    http.get(`${API}/api/v1/admin/users/:id/sessions`, ({ params }) => {
      calls.sessionLists.push(String(params.id));
      const mine = {
        id: SESSION_SELF,
        createdAt: T0,
        expiresAt: T0 + 1000,
        userAgent: null,
        current: true,
      };
      return HttpResponse.json({
        sessions: [
          { id: SESSION_A, createdAt: T0, expiresAt: T0 + 1000, userAgent: null, current: false },
          { id: SESSION_B, createdAt: T0, expiresAt: T0 + 1000, userAgent: null, current: false },
          ...(params.id === TEST_USER.id ? [mine] : []),
        ],
      });
    }),
    http.delete(`${API}/api/v1/admin/sessions/:sessionId`, ({ params }) => {
      calls.revoked.push(String(params.sessionId));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const t = renderRoot({ path: "/admin/users" });
  await screen.findByRole("heading", { name: "Users and roles", level: 2 });
  await screen.findByRole("table", { name: "Users" });
  return t;
}
type Opened = Awaited<ReturnType<typeof openUsers>>;

const rowOf = (name: string): HTMLElement => {
  const r = within(screen.getByRole("table", { name: "Users" }))
    .getAllByRole("row")
    .find((tr) => within(tr).queryByRole("rowheader", { name }) !== null);
  if (r === undefined) throw new Error(`no row for ${name}`);
  return r;
};
const roleSelect = (name: string) =>
  within(rowOf(name)).getByRole("combobox", { name: `Role for ${name}` });

describe("users table (Task 34, SEC-005, UX-004)", () => {
  it("lists every user: name, email, role, status, last sign-in, sign-ins and a count of addresses", async () => {
    await openUsers();
    const table = screen.getByRole("table", { name: "Users" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      "Name",
      "Email",
      "Role",
      "Status",
      "Last sign-in",
      "Sign-ins",
      "Distinct addresses",
      "Actions",
    ]);
    const rose = within(rowOf("Rose Dispatch"));
    expect(rose.getByText("rose.dispatch@querymodule.test")).toBeInTheDocument();
    expect(roleSelect("Rose Dispatch")).toHaveValue("user");
    expect(rose.getByText("Active")).toBeInTheDocument();
    expect(rose.getByText("3")).toBeInTheDocument();
    expect(rose.getByText("1")).toBeInTheDocument();
    expect(rose.getByText(/2026/).closest("time")).toHaveAttribute(
      "datetime",
      new Date(T0 - 86_400_000).toISOString(),
    );
    // Null last sign-in reads "Never"; the three states are badges with text.
    expect(within(rowOf("New Hire")).getByText("Never")).toBeInTheDocument();
    expect(within(rowOf("New Hire")).getByText("Must change password")).toBeInTheDocument();
    expect(within(rowOf("Gone User")).getByText("Disabled")).toBeInTheDocument();
    expect(roleSelect("Test Admin")).toHaveValue("admin");
    // No IP value anywhere (developer ruling 10-01-26): a count only.
    expect(table.textContent).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("says when the list cannot load and retries", async () => {
    let fail = false;
    const t = await openUsers();
    server.use(
      http.get(`${API}/api/v1/admin/users`, () =>
        fail ? apiError("internal", 500) : HttpResponse.json({ users }),
      ),
    );
    fail = true;
    await t.user.click(screen.getByRole("link", { name: "Site configuration" }));
    await t.user.click(await screen.findByRole("link", { name: "Users and roles" }));
    const alert = (await screen.findByText("Users could not be loaded.")).closest(
      '[role="alert"]',
    ) as HTMLElement;
    fail = false;
    await t.user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Users" })).toBeInTheDocument();
  });
});

describe("role change", () => {
  it("sends the new role for that user and keeps it", async () => {
    const t = await openUsers();
    await t.user.selectOptions(roleSelect("Rose Dispatch"), "trainingOfficer");
    await waitFor(() =>
      expect(calls.roles).toEqual([{ id: "user-0002", role: "trainingOfficer" }]),
    );
    await waitFor(() => expect(roleSelect("Rose Dispatch")).toHaveValue("trainingOfficer"));
    expect(await screen.findByText("Rose Dispatch is now Training officer.")).toBeInTheDocument();
  });

  it("409 lastAdmin shows the reason as a message and the select reverts", async () => {
    const t = await openUsers(undefined, { role: () => apiError("lastAdmin", 409) });
    await t.user.selectOptions(roleSelect("Test Admin"), "user");
    expect(await screen.findByText(LAST_ADMIN_TEXT)).toHaveAttribute("role", "alert");
    expect(roleSelect("Test Admin")).toHaveValue("admin");
  });

  it("any other failure says the role was not changed and the select reverts", async () => {
    const t = await openUsers(undefined, { role: () => apiError("internal", 500) });
    await t.user.selectOptions(roleSelect("Rose Dispatch"), "implementer");
    expect(
      await screen.findByText("The role of Rose Dispatch was not changed. Try again."),
    ).toHaveAttribute("role", "alert");
    expect(roleSelect("Rose Dispatch")).toHaveValue("user");
  });
});

describe("disable (spec 6.2 confirm dialog)", () => {
  const disableButton = (name: string) =>
    within(rowOf(name)).getByRole("button", { name: `Disable ${name}` });

  it("asks first; Cancel leaves the user as is and focus returns to the row action", async () => {
    const t = await openUsers();
    await t.user.click(disableButton("Rose Dispatch"));
    const dialog = await screen.findByRole("dialog", { name: "Disable Rose Dispatch?" });
    expect(dialog).toHaveTextContent(/signed out of every session/);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await t.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.disables).toEqual([]);
    expect(disableButton("Rose Dispatch")).toHaveFocus();
  });

  it("Escape cancels", async () => {
    const t = await openUsers();
    await t.user.click(disableButton("Rose Dispatch"));
    await screen.findByRole("dialog", { name: "Disable Rose Dispatch?" });
    await t.user.keyboard("{Escape}");
    expect(calls.disables).toEqual([]);
    expect(disableButton("Rose Dispatch")).toHaveFocus();
  });

  it("confirming disables the user, announces it and returns focus to the row action", async () => {
    const t = await openUsers();
    await t.user.click(disableButton("Rose Dispatch"));
    const dialog = await screen.findByRole("dialog", { name: "Disable Rose Dispatch?" });
    await t.user.click(within(dialog).getByRole("button", { name: "Disable Rose Dispatch" }));
    await waitFor(() => expect(calls.disables).toEqual(["user-0002"]));
    await waitFor(() => expect(within(rowOf("Rose Dispatch")).getByText("Disabled")).toBeVisible());
    expect(await screen.findByText("Rose Dispatch is disabled. 2 sessions ended.")).toBeVisible();
    // The action is still there, aria-disabled and described by the status, so focus has a home.
    const again = disableButton("Rose Dispatch");
    expect(again).toHaveAttribute("aria-disabled", "true");
    expect(again).toHaveAccessibleDescription("Disabled");
    expect(again).toHaveFocus();
  });

  it("an already disabled user has the action off, with its reason", async () => {
    const t = await openUsers();
    const button = disableButton("Gone User");
    expect(button).toHaveAttribute("aria-disabled", "true");
    await t.user.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.disables).toEqual([]);
  });

  it("409 lastAdmin (the self case too) shows the reason and the user stays active", async () => {
    const t = await openUsers(undefined, { disable: () => apiError("lastAdmin", 409) });
    await t.user.click(disableButton("Test Admin"));
    const dialog = await screen.findByRole("dialog", { name: "Disable Test Admin?" });
    await t.user.click(within(dialog).getByRole("button", { name: "Disable Test Admin" }));
    expect(await screen.findByText(LAST_ADMIN_TEXT)).toHaveAttribute("role", "alert");
    expect(within(rowOf("Test Admin")).getByText("Active")).toBeInTheDocument();
    expect(disableButton("Test Admin")).toHaveFocus();
  });
});

describe("sign out everywhere", () => {
  const signOutButton = (name: string) =>
    within(rowOf(name)).getByRole("button", { name: `Sign out everywhere: ${name}` });

  it("revokes each of the user's sessions and says how many", async () => {
    const t = await openUsers();
    await t.user.click(signOutButton("Rose Dispatch"));
    await waitFor(() => expect(calls.revoked).toEqual([SESSION_A, SESSION_B]));
    expect(calls.sessionLists).toEqual(["user-0002"]);
    expect(await screen.findByText("Rose Dispatch is signed out of 2 sessions.")).toBeVisible();
    expect(signOutButton("Rose Dispatch")).toHaveFocus();
  });

  it("leaves the caller's own current session alone", async () => {
    const t = await openUsers();
    await t.user.click(signOutButton("Test Admin"));
    await waitFor(() => expect(calls.revoked).toEqual([SESSION_A, SESSION_B]));
    expect(calls.revoked).not.toContain(SESSION_SELF);
  });

  it("a failed revoke says so", async () => {
    const t = await openUsers();
    server.use(
      http.delete(`${API}/api/v1/admin/sessions/:sessionId`, () => apiError("internal", 500)),
    );
    await t.user.click(signOutButton("Rose Dispatch"));
    expect(
      await screen.findByText("Rose Dispatch could not be signed out of every session. Try again."),
    ).toHaveAttribute("role", "alert");
  });
});

describe("create user (the temporary password is shown once)", () => {
  const openDialog = async (t: Opened) => {
    await t.user.click(screen.getByRole("button", { name: "Create user" }));
    return screen.findByRole("dialog", { name: "Create user" });
  };
  const fillForm = async (t: Opened, dialog: HTMLElement) => {
    await t.user.type(within(dialog).getByLabelText(/^Email/), "mia.records@querymodule.test");
    await t.user.type(within(dialog).getByLabelText(/^Name/), "Mia Records");
    await t.user.selectOptions(within(dialog).getByLabelText(/^Role/), "trainingOfficer");
  };
  const REVEAL = "Temporary password for Mia Records";

  it("checks the fields first, each error at its field", async () => {
    const t = await openUsers();
    const dialog = await openDialog(t);
    expect(within(dialog).getByLabelText(/^Email/)).toHaveFocus();
    await t.user.click(within(dialog).getByRole("button", { name: "Create" }));
    for (const label of [/^Email/, /^Name/, /^Role/])
      expect(within(dialog).getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    expect(calls.creates).toEqual([]);
  });

  it("Tab wraps inside the dialog and Escape closes the form, returning focus to Create user", async () => {
    const t = await openUsers();
    const dialog = await openDialog(t);
    const create = within(dialog).getByRole("button", { name: "Create" });
    create.focus();
    await t.user.tab();
    expect(within(dialog).getByLabelText(/^Email/)).toHaveFocus();
    await t.user.tab({ shift: true });
    expect(create).toHaveFocus();
    await t.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Create user" })).toHaveFocus();
  });

  it("emailTaken shows at the email field", async () => {
    const t = await openUsers(undefined, {
      create: () =>
        HttpResponse.json(
          {
            error: {
              code: "validationFailed",
              requestId: "r1",
              errors: [{ key: "validation.emailTaken" }],
            },
          },
          { status: 400 },
        ),
    });
    const dialog = await openDialog(t);
    await fillForm(t, dialog);
    await t.user.click(within(dialog).getByRole("button", { name: "Create" }));
    const email = within(dialog).getByLabelText(/^Email/);
    await waitFor(() => expect(email).toHaveAccessibleDescription("That email is already in use."));
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
  });

  it("shows the temporary password once with Copy; it is gone from the DOM, the state and the cache after Done", async () => {
    const t = await openUsers();
    // After setup: userEvent installs its own clipboard stub when the test renders.
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const opener = screen.getByRole("button", { name: "Create user" });
    const dialog = await openDialog(t);
    await fillForm(t, dialog);
    await t.user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(calls.creates).toEqual([
      { email: "mia.records@querymodule.test", name: "Mia Records", role: "trainingOfficer" },
    ]);
    const reveal = await screen.findByRole("dialog", { name: REVEAL });
    expect(reveal).toHaveTextContent(/shown once/);
    expect(within(reveal).getByText(TEMPORARY)).toBeInTheDocument();
    expect(within(reveal).getByRole("button", { name: "Copy password" })).toHaveFocus();
    await t.user.click(within(reveal).getByRole("button", { name: "Copy password" }));
    expect(writeText).toHaveBeenCalledWith(TEMPORARY);
    expect(await screen.findByText("Password copied.")).toBeInTheDocument();
    await t.user.click(within(reveal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain(TEMPORARY);
    expect(JSON.stringify(t.services.queryClient.getQueryCache().getAll())).not.toContain(
      TEMPORARY,
    );
    expect(JSON.stringify(t.services.queryClient.getMutationCache().getAll())).not.toContain(
      TEMPORARY,
    );
    // The list has the new user, who must change the password; focus is back on the opener.
    expect(await screen.findByRole("rowheader", { name: "Mia Records" })).toBeInTheDocument();
    expect(within(rowOf("Mia Records")).getByText("Must change password")).toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("Escape does not close the password dialog (it is shown once); Done does", async () => {
    const t = await openUsers();
    const dialog = await openDialog(t);
    await fillForm(t, dialog);
    await t.user.click(within(dialog).getByRole("button", { name: "Create" }));
    const reveal = await screen.findByRole("dialog", { name: REVEAL });
    await t.user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: REVEAL })).toBeInTheDocument();
    expect(within(reveal).getByText(TEMPORARY)).toBeInTheDocument();
    await t.user.click(within(reveal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain(TEMPORARY);
  });

  it("without a clipboard the dialog says to copy by hand; Cancel closes the form with nothing sent", async () => {
    const t = await openUsers();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    let dialog = await openDialog(t);
    await t.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.creates).toEqual([]);
    dialog = await openDialog(t);
    await fillForm(t, dialog);
    await t.user.click(within(dialog).getByRole("button", { name: "Create" }));
    const reveal = await screen.findByRole("dialog", { name: REVEAL });
    await t.user.click(within(reveal).getByRole("button", { name: "Copy password" }));
    expect(
      await screen.findByText("Copy failed. Select the password and copy it."),
    ).toBeInTheDocument();
  });
});
