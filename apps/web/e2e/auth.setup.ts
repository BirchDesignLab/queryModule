import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup } from "@playwright/test";
import { authStatePath, DEMO_EMAILS, e2eUser, seededUser, signInWithForm } from "./helpers.js";

// One form sign-in per demo user per run; every other test reuses the saved session (helpers
// `signIn`). The auth routes allow 100 POSTs per IP per 15 minutes (packages/api auth rate limit).
// Credentials resolve inside each test, so a missing variable fails that sign-in, not collection.
for (const who of ["smoke", ...DEMO_EMAILS] as const) {
  setup(`sign in ${who}`, async ({ page }) => {
    const user = who === "smoke" ? e2eUser() : seededUser(who);
    await signInWithForm(page, user);
    const path = authStatePath(user.email);
    mkdirSync(dirname(path), { recursive: true });
    await page.context().storageState({ path });
    // A session cookie: owner-only, like .dev/secrets.
    chmodSync(path, 0o600);
  });
}
