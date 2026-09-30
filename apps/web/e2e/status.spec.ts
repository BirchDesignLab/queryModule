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

// Check again (status page): it re-checks the connection and the configuration, the button keeps
// keyboard focus, and the shared polite region gets exactly one message for the whole check.
test("Check again re-checks both, keeps focus on the button and announces once", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Status" }).click();
  await expect(page.getByRole("main").getByText(/^Connected\. Heartbeat round trip/)).toBeVisible({
    timeout: 15_000,
  });
  const button = page.getByRole("button", { name: "Check again" });
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  const configRequests: string[] = [];
  page.on("request", (r) => {
    // The 15 s background refresh sends the same GET, marked X-Background: only the check counts.
    if (r.url().endsWith("/api/v1/config") && r.headers()["x-background"] !== "1")
      configRequests.push(r.url());
  });
  // Count every message the polite region receives from here on (each one remounts its span).
  await page.evaluate(() => {
    const region = document.querySelector('[data-testid="announcer-polite"]');
    const seen: string[] = [];
    (window as unknown as { __announced: string[] }).__announced = seen;
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if ((n.textContent ?? "").trim() !== "") seen.push(n.textContent ?? "");
    }).observe(region as Element, { childList: true, subtree: true, characterData: true });
  });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __announced: string[] }).__announced.length),
    )
    .toBeGreaterThanOrEqual(1);
  // Let any second message arrive before counting: a check ends in exactly one.
  await page.waitForTimeout(500);
  const announced = await page.evaluate(
    () => (window as unknown as { __announced: string[] }).__announced,
  );
  expect(announced.map((m) => m.trim())).toEqual(["Connected, configuration loaded"]);
  expect(configRequests).toHaveLength(1);
  await expect(button).toBeFocused();
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  await expectNoSeriousAxeViolations(page);
});
