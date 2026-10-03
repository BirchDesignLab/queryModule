import type { WebSocket } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Task 35 (#362, BR-001, SEC-005): the users half of the M1 exit demo. An admin creates a user, the
// user signs in with the temporary password (forced change), the admin disables them, and their
// session ends. Two browser contexts: the admin and the new user.

// A step that cannot find its element fails in 10 s with its own message, not at the test timeout.
test.use({ actionTimeout: 10_000 });

test("[#362] create, forced password change, disable: the new user's session ends", async ({
  page,
  browser,
}) => {
  // Two contexts, a dialog flow and several axe scans: more than the default 30 s.
  test.setTimeout(90_000);
  // Unique per run, so a rerun against the same database finds only its own row.
  const stamp = Date.now();
  const email = `e2e-temp-${stamp}@example.test`;
  const NAME = `E2E Temp ${stamp}`;
  const NAME_FRAGMENT = new RegExp(`^${NAME}`);
  await signIn(page, seededUser("admin@example.test"));

  // The admin opens Users from the header's Admin link and the console's nav, by keyboard.
  await page.getByRole("link", { name: "Admin" }).press("Enter");
  await page.getByRole("link", { name: "Users and roles" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Users and roles", level: 2 })).toBeFocused();
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  // Create: the dialog, then the temporary password shown once.
  await page.getByRole("button", { name: "Create user" }).press("Enter");
  const create = page.getByRole("dialog", { name: "Create user" });
  await expect(create).toBeVisible();
  await create.getByLabel("Email").fill(email);
  await create.getByLabel("Name").fill(NAME);
  await create.getByLabel("Role").selectOption({ label: "User" });
  await expectNoSeriousAxeViolations(page);
  await create.getByRole("button", { name: "Create" }).press("Enter");
  const reveal = page.getByRole("dialog", { name: `Temporary password for ${NAME}` });
  await expect(reveal).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  const temporary = (await reveal.locator("code").textContent())?.trim() ?? "";
  expect(temporary.length).toBeGreaterThanOrEqual(12);
  await reveal.getByRole("button", { name: "Done" }).press("Enter");
  await expect(reveal).toBeHidden();
  // Shown once: the password is nowhere in the page after the dialog closes.
  await expect(page.locator("body")).not.toContainText(temporary);
  await expect(page.getByRole("row", { name: NAME_FRAGMENT })).toContainText(
    "Must change password",
  );
  await expectNoSeriousAxeViolations(page);

  // The new user, in a second context, signs in with the temporary password.
  const userContext = await browser.newContext();
  const user = await userContext.newPage();
  const sockets: WebSocket[] = [];
  user.on("websocket", (ws) => sockets.push(ws));
  try {
    await user.goto("/");
    await user.getByLabel("Email").fill(email);
    await user.getByLabel("Password").fill(temporary);
    await user.getByRole("button", { name: "Sign in" }).click();
    const change = user.getByRole("heading", { name: "Choose a new password" });
    await expect(change).toBeVisible();
    // Straight to /status: still only the change screen, and no WebSocket ever opens.
    await user.goto("/status");
    await expect(change).toBeVisible();
    await expect(user.getByRole("link", { name: "Status" })).toHaveCount(0);
    await expect(user.getByRole("banner")).toHaveCount(0);
    await user.waitForTimeout(1500);
    expect(sockets).toHaveLength(0);
    await expectNoSeriousAxeViolations(user);

    // The same password is refused; a new one is accepted.
    await user.locator("#change-password-current").fill(temporary);
    await user.locator("#change-password-new").fill(temporary);
    await user.locator("#change-password-confirm").fill(temporary);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.locator("#change-password-new-error")).toHaveText(
      "Choose a password different from the temporary one",
    );
    await expectNoSeriousAxeViolations(user);
    const chosen = `${temporary.slice(0, 20)}-new-A1`;
    await user.locator("#change-password-new").fill(chosen);
    await user.locator("#change-password-confirm").fill(chosen);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(change).toBeHidden();
    // The app is whole again, on the /status page the user had asked for: its header is back and
    // the page connects its socket.
    await expect(user.getByRole("banner")).toBeVisible();
    await expect(user.getByRole("main").getByText(/^Connected\. Heartbeat round trip/)).toBeVisible(
      {
        timeout: 15_000,
      },
    );
    expect(sockets).toHaveLength(1);
    await expectNoSeriousAxeViolations(user);

    // The admin disables the user: confirm dialog, then the session ends (socket closed).
    await page.reload();
    const row = page.getByRole("row", { name: NAME_FRAGMENT });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Disable ${NAME}` }).press("Enter");
    const confirm = page.getByRole("dialog", { name: `Disable ${NAME}?` });
    await expect(confirm).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await confirm.getByRole("button", { name: `Disable ${NAME}` }).press("Enter");
    // The one open session ended (the page text and the live region both carry the message).
    await expect(page.getByText(`${NAME} is disabled. 1 session ended.`).first()).toBeVisible();
    await expect(row).toContainText("Disabled");
    await expect.poll(() => sockets[0]?.isClosed(), { timeout: 15_000 }).toBe(true);
    await expectNoSeriousAxeViolations(page);

    // The disabled user's session is gone: the app asks for a sign-in again, and one is refused.
    await user.goto("/");
    await expect(user.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await user.getByLabel("Email").fill(email);
    await user.getByLabel("Password").fill(chosen);
    await user.getByRole("button", { name: "Sign in" }).click();
    await expect(user.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(user.getByRole("heading", { name: "Query Module", exact: true })).toBeHidden();
    await expectNoSeriousAxeViolations(user);
  } finally {
    await userContext.close();
  }
});
