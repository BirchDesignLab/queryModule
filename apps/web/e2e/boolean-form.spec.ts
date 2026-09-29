import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page, Route } from "@playwright/test";
import { SiteConfigSchema, toClientSiteConfig } from "@querymodule/core/config";
import { expect, expectNoSeriousAxeViolations, test } from "./fixtures.js";
import { chooseQueryType, hexToRgb, signIn } from "./helpers.js";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./sites/${name}`, import.meta.url)), "utf8"));
const fixture = SiteConfigSchema.parse(read("boolean-form.json"));
const overlay = read("boolean-form.en.json") as Record<string, string>;

/** Fetch the live response, failing loudly on a non-2xx so a 401 never hides behind a mock. */
async function liveJson<T>(route: Route): Promise<T> {
  const response = await route.fetch();
  if (!response.ok())
    throw new Error(`live ${route.request().url()} answered ${response.status()}`);
  return (await response.json()) as T;
}

// #309: serve the e2e-only site from this side. The production image and default.json stay untouched.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/config", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const live = await liveJson<{ configHash: string }>(route);
    return route.fulfill({ json: toClientSiteConfig(fixture, live.configHash) });
  });
  await page.route("**/api/v1/locales/en", async (route) => {
    const live = await liveJson<Record<string, string>>(route);
    return route.fulfill({ json: { ...live, ...overlay } });
  });
});

/** CHK with a bad reference code hidden by a rule, so its error has no field on screen. */
async function blockedForm(page: Page): Promise<Locator> {
  await signIn(page);
  await chooseQueryType(page, "CHK");
  // The keyboard pick above makes a later script focus match :focus-visible, whose ring would hide
  // the invalid outline this spec checks. A pointer click resets the modality, as the old select did.
  await page.getByRole("heading", { name: "Query Module", exact: true }).click();
  const agree = page.getByLabel("Confirm subject details");
  await expect(agree).toHaveAttribute("type", "checkbox");
  await expect(agree).toHaveAttribute("aria-required", "true");
  await expect(agree).not.toHaveAttribute("aria-invalid", "true");
  await expect(agree).toHaveCSS("outline-style", "none");
  await page.getByLabel("Reference code").fill("bad value!");
  await page.getByLabel("Mode").selectOption("SKIP");
  await expect(page.getByLabel("Reference code")).toHaveCount(0);
  return agree;
}

test("[FR-006, FR-005] a blocked submit marks the checkbox invalid and announces the form-level error", async ({
  page,
}) => {
  const agree = await blockedForm(page);
  await page.getByRole("button", { name: "Submit" }).click();
  await expectBlocked(page, agree);
});

test("[FR-006, FR-005] the keyboard submit (Ctrl+Enter from the checkbox) blocks the same way", async ({
  page,
}) => {
  const agree = await blockedForm(page);
  // From a non-text control, so native implicit submit cannot mask the shortcut path.
  await agree.focus();
  await page.keyboard.press("Control+Enter");
  await expectBlocked(page, agree);
});

/** The blocked-submit outcome: invalid checkbox with its message, form-level error, announcements. */
async function expectBlocked(page: Page, agree: Locator): Promise<void> {
  await expect(agree).toHaveAttribute("aria-invalid", "true");
  const describedBy = await agree.getAttribute("aria-describedby");
  const messageId = (describedBy ?? "").split(" ").find((id) => id.endsWith("-error"));
  expect(messageId).toBeDefined();
  await expect(page.locator(`#${messageId}`)).toHaveText("Confirm subject details is required.");
  await expect(agree).toBeFocused();
  // The visual cue (styles.css .qm-checkbox input[aria-invalid]): a solid outline in the required token.
  const required = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--qm-field-required"),
  );
  await expect(agree).toHaveCSS("outline-style", "solid");
  await expect(agree).toHaveCSS("outline-color", hexToRgb(required));

  // The form-level error, found the way assistive tech finds it: through the Submit button's
  // aria-describedby, not by class names.
  const submit = page.getByRole("button", { name: "Submit" });
  const ids = ((await submit.getAttribute("aria-describedby")) ?? "").split(" ").filter(Boolean);
  expect(ids.length).toBeGreaterThan(0);
  await expect(page.locator(ids.map((id) => `#${id}`).join(", "))).toHaveText([
    "Reference code is not in the expected format.",
  ]);
  await expect(submit).toHaveAccessibleDescription("Reference code is not in the expected format.");
  const polite = page.getByTestId("announcer-polite");
  await expect(polite).toHaveText(/2 fields need attention\./);
  await expect(polite).toHaveText(/Reference code is not in the expected format\./);
  await expectNoSeriousAxeViolations(page);
}
