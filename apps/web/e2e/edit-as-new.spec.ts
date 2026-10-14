import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { liveResponse, seededUser, signIn } from "./helpers.js";

// Edit as new query (#477, ruling #434). A request the server answers 409 (the site configuration
// changed) offers no Retry; it offers "Edit as new query". The administrator's publish is simulated
// the way config-refresh.spec.ts does it: the server keeps one config, so the "published" one is
// the same body with a new hash and the Year field removed from Vehicle. The first query POST is
// answered 409 by the test, which also flips the config the app then refetches.

const NEW_HASH = "e".repeat(64);

interface Setup {
  posts: () => number;
}

async function publishWithoutYearOnTheFirstQuery(page: Page): Promise<Setup> {
  let published = false;
  let posts = 0;
  await page.route("**/api/v1/config", async (route) => {
    const response = await liveResponse(route);
    const body = (await response.json()) as {
      configHash: string;
      queryTypes: { code: string; fields: { key: string }[] }[];
    };
    if (published) {
      body.configHash = NEW_HASH;
      for (const type of body.queryTypes) {
        if (type.code === "VEH") type.fields = type.fields.filter((f) => f.key !== "year");
      }
    }
    await route.fulfill({ response, json: body });
  });
  await page.route("**/api/v1/queries", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    published = true;
    return route.fulfill({
      status: 409,
      json: { error: { code: "configHashMismatch", currentConfigHash: NEW_HASH } },
    });
  });
  return { posts: () => posts };
}

/** Presses Tab until `target` has focus (bounded), the way a keyboard user reaches a control. */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Tab did not reach the control within 40 presses");
}

// The e2e database is shared, and sign-in loads history: these scenarios start from an empty list.
test.use({ emptyQueryList: true });

const PERSONAS = [
  {
    name: "dispatcher",
    email: "dispatcher@example.test",
    viewport: { width: 1366, height: 768 },
    region: "Requests this shift",
    minTarget: 36,
  },
  {
    name: "officer",
    email: "officer@example.test",
    viewport: { width: 1024, height: 768 },
    region: "Last request",
    minTarget: 48,
  },
] as const;

for (const persona of PERSONAS) {
  test.describe(`${persona.name} edit as new query (${persona.viewport.width}x${persona.viewport.height})`, () => {
    test.use({ viewport: persona.viewport });

    test("a 409 row offers Edit as new; by keyboard it loads the kept values, names what was dropped, moves focus to the form, and leaves the row alone", async ({
      page,
    }) => {
      await signIn(page, seededUser(persona.email));
      await expect(page.getByRole("group", { name: "Quick access" })).toBeVisible();
      const sent = await publishWithoutYearOnTheFirstQuery(page);
      const plate = page.getByLabel("Plate", { exact: true });
      await page.getByLabel("Year", { exact: true }).fill("2024");
      await plate.fill("ZZ-0001");
      await plate.press("Enter");

      const region = page.getByRole("region", { name: persona.region });
      const edit = region.getByRole("button", { name: /^Edit as new query: Vehicle ZZ-0001/ });
      await expect(edit).toBeVisible();
      await expect(region.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
      // The publish has reached the form: Year is gone.
      await expect(page.getByLabel("Year", { exact: true })).toHaveCount(0);

      // Control size (visual system): 36 px dispatcher, 48 px officer.
      const box = await edit.boundingBox();
      expect(Math.round(box?.height ?? 0), "target height").toBeGreaterThanOrEqual(
        persona.minTarget,
      );

      // The draft moved on; the action loads what the row kept. Reached and pressed by keyboard.
      await plate.fill("ZZ-0009");
      await tabTo(page, edit);
      await page.keyboard.press("Enter");

      await expect(plate).toHaveValue("ZZ-0001");
      await expect(plate).toBeFocused();
      const note = page.getByTestId("edit-as-new-note");
      await expect(note).toBeVisible();
      await expect(note).toContainText("Year");
      await expect(note).not.toContainText("2024");
      await expect(page.getByTestId("announcer-polite")).toContainText("Year");
      // Nothing was sent; the failed row is history and stays.
      expect(sent.posts()).toBe(1);
      await expect(region.getByRole("listitem")).toHaveCount(1);
      await expect(region.getByRole("listitem")).toContainText("Failed");
      await expect(edit).toBeVisible();
    });
  });
}
