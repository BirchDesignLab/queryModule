import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup } from "@playwright/test";
import { authStatePath, DEMO_EMAILS, e2eUser, seededUser, signInWithForm } from "./helpers.js";

// One form sign-in per demo user per run; every other test reuses the saved session (helpers
// `signIn`). The auth routes allow 100 POSTs per IP per 15 minutes (packages/api auth rate limit).
for (const user of [e2eUser(), ...DEMO_EMAILS.map((email) => seededUser(email))]) {
  setup(`sign in ${user.email}`, async ({ page }) => {
    await signInWithForm(page, user);
    const path = authStatePath(user.email);
    mkdirSync(dirname(path), { recursive: true });
    await page.context().storageState({ path });
  });
}
