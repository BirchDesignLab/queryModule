import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

test("NFR-003 authenticated WebSocket heartbeat on the status page (spec 9.3 step 12)", {
  tag: "@smoke",
}, async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Status" }).click();
  await expect(page.getByRole("main").getByText(/^Connected\. Heartbeat round trip/)).toBeVisible({
    timeout: 15_000,
  });
  await expectNoSeriousAxeViolations(page);
});
