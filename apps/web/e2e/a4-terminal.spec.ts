import type { Page } from "@playwright/test";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

async function openTerminal(page: Page) {
  await signIn(page);
  await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
  // The slash key focuses the terminal from anywhere outside a text input (spec 6.4).
  await expect(page.locator("input:focus, textarea:focus")).toHaveCount(0);
  await page.keyboard.press("Slash");
  const input = page.getByRole("textbox", { name: "Command" });
  await expect(input).toBeFocused();
  // The terminal opens with the current type's command (VEH); replace it (Ctrl+A is never bound).
  await page.keyboard.press("Control+A");
  return input;
}

test("[A4] VEH.ABC123..26 runs with State TX and Year 2026 (FR-050 to FR-056, FR-064)", {
  tag: "@smoke",
}, async ({ page }) => {
  const input = await openTerminal(page);
  await page.keyboard.type("VEH.ABC123..26");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/v1/queries") && r.method() === "POST",
  );
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/queries") && r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");

  const body = (await request).postDataJSON() as {
    queryType: string;
    values: Record<string, unknown>;
  };
  expect(body.queryType).toBe("VEH");
  // Exactly what was typed: the empty state position is left out, so the site default (TX) applies.
  expect(body.values).toEqual({ plate: "ABC123", year: "26" });
  const reply = await response;
  expect(reply.status()).toBe(202);
  const { parts } = (await reply.json()) as { parts: { queryType: string; status: string }[] };
  expect(parts[0]).toMatchObject({ queryType: "VEH", status: "dispatched" });

  await expect(page.getByRole("region", { name: "Last query" })).toBeVisible();
  await expect(input).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});

test("[A4] XYZ.123 gives unrecognized command, tied to the input (FR-055)", async ({ page }) => {
  const input = await openTerminal(page);
  await page.keyboard.type("XYZ.123");
  await page.keyboard.press("Enter");

  const errors = page.getByRole("list", { name: "Command problems" });
  await expect(errors.getByRole("listitem")).toHaveText("Unrecognized command XYZ.");
  const errorsId = await errors.getAttribute("id");
  expect(errorsId).not.toBeNull();
  expect((await input.getAttribute("aria-describedby")) ?? "").toContain(errorsId ?? "");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("XYZ.123");
  await expectNoSeriousAxeViolations(page);
});
