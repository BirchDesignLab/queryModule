import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { e2eUser, signIn, signOutFromHeader } from "./helpers.js";

test.describe("BR-002 login", () => {
  test("signs in with the seeded user and signs out", { tag: "@smoke" }, async ({ page }) => {
    const user = e2eUser();
    await signIn(page, user, { fresh: true });
    await expect(page.getByRole("button", { name: user.email })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await signOutFromHeader(page);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("UX-004 empty submit marks fields, focuses the first and announces the count", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in" }).click();
    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toBeFocused();
    await expect(email).toHaveAccessibleDescription("Email is required.");
    await expect(page.getByTestId("announcer-polite")).toContainText("2 fields need attention");
    await expectNoSeriousAxeViolations(page);
  });

  test("an unknown account gets the generic failure (the smoke account is never locked)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill("nobody@querymodule.test");
    await page.getByLabel("Password").fill("not-a-real-pass");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Scoped to main: the live announcer (outside main) repeats the same text.
    await expect(
      page.getByRole("main").getByText("Sign-in failed. Check your email and password."),
    ).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveValue("");
  });
});
