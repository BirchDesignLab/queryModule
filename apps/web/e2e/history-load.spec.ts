import { expect, test } from "./fixtures.js";
import { seededUser, signIn } from "./helpers.js";

// Spec 6.8, Q1 (FR-065): sign-in loads the user's request history and fetches the details of its
// returned sources. History is shown quietly: nothing is announced for an old request, not even a
// critical result (spec 6.6). This scenario uses the real list; scenarios that need a clean
// history opt in to an empty one (fixtures.ts) because the e2e database is shared.

test("[Q1] a request sent earlier is listed after a fresh sign-in, quietly", async ({ page }) => {
  const user = seededUser("dispatcher@example.test");
  await signIn(page, user, { fresh: true });
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  await page.getByLabel("Plate", { exact: true }).fill("ZZ-0001");
  const sent = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  expect((await sent).status()).toBe(202);
  const list = page.getByRole("region", { name: "Requests this shift" });
  // Both sources settle before the reload: a source that settles after it is a live result.
  for (const source of ["State system", "National system"]) {
    await expect(list.getByRole("region", { name: `${source}: returned` }).first()).toBeVisible({
      timeout: 8000,
    });
  }

  // The e2e database is shared and this user's earlier scenarios may still have a source in
  // flight: a source that settles after the reload is a live result and is announced. Wait until
  // no request of the list has a pending source, so only history is left to load.
  await expect
    .poll(
      async () => {
        const reply = await page.request.get("/api/v1/queries?limit=50", {
          headers: { "X-Background": "1" },
        });
        const body = (await reply.json()) as {
          requests: { parts: { sources: { status: string }[] }[] }[];
        };
        return body.requests.some((r) =>
          r.parts.some((part) => part.sources.some((src) => src.status === "pending")),
        );
      },
      { timeout: 15_000 },
    )
    .toBe(false);

  // A new page load restores the session; the list comes from the server, not from memory.
  await page.reload();
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  const history = list.getByRole("listitem").first();
  await expect(history).toContainText("Vehicle");
  await expect(history.getByRole("region", { name: "State system: returned" })).toBeVisible({
    timeout: 8000,
  });
  // Quiet: the critical STOLEN result of the old request is not spoken.
  await expect(page.getByTestId("announcer-assertive")).toHaveText("");
  await expect(page.getByTestId("announcer-polite")).not.toContainText("STOLEN");
});
