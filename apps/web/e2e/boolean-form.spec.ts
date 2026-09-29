import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SiteConfigSchema, toClientSiteConfig } from "@querymodule/core/config";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { signIn } from "./helpers.js";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./sites/${name}`, import.meta.url)), "utf8"));
const fixture = SiteConfigSchema.parse(read("boolean-form.json"));
const overlay = read("boolean-form.en.json") as Record<string, string>;

// #309: serve the e2e-only site from this side. The production image and default.json stay untouched.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/config", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const live = (await (await route.fetch()).json()) as { configHash: string };
    return route.fulfill({ json: toClientSiteConfig(fixture, live.configHash) });
  });
  await page.route("**/api/v1/locales/en", async (route) => {
    const live = (await (await route.fetch()).json()) as Record<string, string>;
    return route.fulfill({ json: { ...live, ...overlay } });
  });
});

test("[FR-006, UX-011] a blocked submit marks the checkbox invalid and announces the form-level error", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("Query type").selectOption("CHK");
  const agree = page.getByLabel("Confirm subject details");
  await expect(agree).toHaveAttribute("type", "checkbox");
  await expect(agree).toHaveAttribute("aria-required", "true");
  await expect(agree).not.toHaveAttribute("aria-invalid", "true");

  // A bad value, then a rule hides its field: the error has no field on screen to sit on.
  await page.getByLabel("Reference code").fill("bad value!");
  await page.getByLabel("Mode").selectOption("SKIP");
  await expect(page.getByLabel("Reference code")).toHaveCount(0);

  await page.getByRole("button", { name: "Submit" }).click();

  await expect(agree).toHaveAttribute("aria-invalid", "true");
  const describedBy = await agree.getAttribute("aria-describedby");
  const messageId = (describedBy ?? "").split(" ").find((id) => id.endsWith("-error"));
  expect(messageId).toBeDefined();
  await expect(page.locator(`#${messageId}`)).toHaveText("Confirm subject details is required.");
  await expect(agree).toBeFocused();

  const formError = page.locator(".qm-form-errors .qm-form-error");
  await expect(formError).toHaveText("Reference code is not in the expected format.");
  await expect(page.getByRole("button", { name: "Submit" })).toHaveAccessibleDescription(
    "Reference code is not in the expected format.",
  );
  const polite = page.getByTestId("announcer-polite");
  await expect(polite).toHaveText(/2 fields need attention\./);
  await expect(polite).toHaveText(/Reference code is not in the expected format\./);
  await expectNoSeriousAxeViolations(page);
});
